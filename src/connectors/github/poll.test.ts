import { afterEach, describe, expect, it, vi } from "vitest";
import { isBot, pollGithub, repoFromApiUrl, repoMatches } from "./poll.ts";

describe("repoFromApiUrl", () => {
  it("reads the repository out of a search result", () => {
    expect(repoFromApiUrl("https://api.github.com/repos/acme/web")).toBe("acme/web");
  });

  it("refuses anything that is not a repository url", () => {
    expect(repoFromApiUrl("https://api.github.com/repos/acme/web/pulls/1")).toBeNull();
    expect(repoFromApiUrl("https://example.com/repos/acme/web")).toBeNull();
  });
});

describe("repoMatches", () => {
  it("matches everything when nothing is named", () => {
    expect(repoMatches("acme/web", [])).toBe(true);
  });

  it("matches exactly, ignoring case", () => {
    expect(repoMatches("acme/web", ["acme/web"])).toBe(true);
    expect(repoMatches("Acme/Web", ["acme/web"])).toBe(true);
    expect(repoMatches("acme/api", ["acme/web"])).toBe(false);
  });

  it("matches any of several", () => {
    expect(repoMatches("acme/api", ["acme/web", "acme/api"])).toBe(true);
  });

  it("takes a star for one segment", () => {
    expect(repoMatches("acme/web", ["acme/*"])).toBe(true);
    expect(repoMatches("other/web", ["acme/*"])).toBe(false);
    expect(repoMatches("other/web", ["*/*"])).toBe(true);
    expect(repoMatches("acme/web-ui", ["acme/web-*"])).toBe(true);
  });

  it("does not let a star reach past the owner it names", () => {
    expect(repoMatches("acme/web", ["*"])).toBe(false);
  });

  it("does not treat a dot as a wildcard", () => {
    expect(repoMatches("acme/webx", ["acme/web."])).toBe(false);
  });
});

describe("isBot", () => {
  it("spots both kinds of bot", () => {
    expect(isBot({ login: "dependabot[bot]" })).toBe(true);
    expect(isBot({ login: "renovate", type: "Bot" })).toBe(true);
    expect(isBot({ login: "someone", type: "User" })).toBe(false);
  });
});

type FakePull = { draft?: boolean; changed_files?: number; sha?: string };

/**
 * Stands in for GitHub. Search results and pull requests are the only two
 * things a poll asks for, so the stub only has to know those two shapes.
 */
function givenGithub(options: {
  items: Array<{
    repo: string;
    number: number;
    title?: string;
    draft?: boolean;
    login?: string;
    type?: string;
  }>;
  pulls?: Record<string, FakePull>;
}) {
  const asked: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    asked.push(url);
    const path = url.replace("https://api.github.com", "");
    if (path.startsWith("/search/issues")) {
      return new Response(
        JSON.stringify({
          items: options.items.map((item) => ({
            number: item.number,
            title: item.title ?? `Change ${item.number}`,
            html_url: `https://github.com/${item.repo}/pull/${item.number}`,
            repository_url: `https://api.github.com/repos/${item.repo}`,
            draft: item.draft ?? false,
            user: { login: item.login ?? "someone", type: item.type ?? "User" },
          })),
        }),
        { status: 200 },
      );
    }
    const pull = /^\/repos\/(.+)\/pulls\/(\d+)$/.exec(path);
    if (pull) {
      const fake = options.pulls?.[`${pull[1]}#${pull[2]}`] ?? {};
      return new Response(
        JSON.stringify({
          number: Number(pull[2]),
          title: "Change",
          body: null,
          draft: fake.draft ?? false,
          html_url: `https://github.com/${pull[1]}/pull/${pull[2]}`,
          user: { login: "someone" },
          head: { sha: fake.sha ?? "abc123" },
          base: { ref: "main" },
          changed_files: fake.changed_files ?? 3,
        }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected request: ${url}`);
  });
  return { asked };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pollGithub, review requested", () => {
  const poll = (settings: Record<string, unknown> = {}) =>
    pollGithub({ workflowId: "github.review_requested", settings, accessToken: "token" });

  it("keys on the head commit, so a new push is worth reviewing again", async () => {
    givenGithub({ items: [{ repo: "acme/web", number: 7 }], pulls: { "acme/web#7": { sha: "sha1" } } });
    const [first] = await poll();
    expect(first).toMatchObject({
      key: "acme/web#7@sha1",
      kind: "pull_request",
      ref: "acme/web#7",
      url: "https://github.com/acme/web/pull/7",
    });

    givenGithub({ items: [{ repo: "acme/web", number: 7 }], pulls: { "acme/web#7": { sha: "sha2" } } });
    expect((await poll())[0]!.key).toBe("acme/web#7@sha2");
  });

  it("keeps only the repositories a loop names", async () => {
    givenGithub({
      items: [
        { repo: "acme/web", number: 1 },
        { repo: "other/api", number: 2 },
      ],
    });
    const found = await poll({ repositories: ["acme/*"] });
    expect(found.map((signal) => signal.ref)).toEqual(["acme/web#1"]);
  });

  it("skips bots and drafts without paying for a second request", async () => {
    const github = givenGithub({
      items: [
        { repo: "acme/web", number: 1, login: "dependabot[bot]" },
        { repo: "acme/web", number: 2, draft: true },
        { repo: "acme/web", number: 3 },
      ],
    });
    const found = await poll();
    expect(found.map((signal) => signal.ref)).toEqual(["acme/web#3"]);
    // One search, and one pull request: the two that were LOOPDOUTxKEEP on the
    // search result alone were never fetched.
    expect(github.asked.filter((url) => url.includes("/pulls/"))).toHaveLength(1);
  });

  it("takes drafts and bots when told to", async () => {
    givenGithub({
      items: [
        { repo: "acme/web", number: 1, login: "dependabot[bot]" },
        { repo: "acme/web", number: 2, draft: true },
      ],
      pulls: { "acme/web#2": { draft: true } },
    });
    const found = await poll({ ignoreDrafts: false, ignoreBots: false });
    expect(found.map((signal) => signal.ref)).toEqual(["acme/web#1", "acme/web#2"]);
  });

  it("holds a pull request that is too big rather than dropping it", async () => {
    givenGithub({
      items: [
        { repo: "acme/web", number: 1 },
        { repo: "acme/web", number: 2 },
      ],
      pulls: { "acme/web#1": { changed_files: 80 }, "acme/web#2": { changed_files: 4 } },
    });
    // Somebody asked for this review. It is still reported, with the reason it
    // will not happen on its own, so it can be seen and run on purpose.
    const found = await poll({ maxChangedFiles: "50" });
    expect(found.map((signal) => [signal.ref, signal.hold])).toEqual([
      ["acme/web#1", "80 files changed, over this loop's 50"],
      ["acme/web#2", undefined],
    ]);
  });

  it("holds nothing when the limit is off", async () => {
    givenGithub({
      items: [{ repo: "acme/web", number: 1 }],
      pulls: { "acme/web#1": { changed_files: 800 } },
    });
    const found = await poll({ maxChangedFiles: "0" });
    expect(found.map((signal) => signal.hold)).toEqual([undefined]);
  });

  it("treats a missing setting as the workflow's default rather than as off", async () => {
    givenGithub({
      items: [
        { repo: "acme/web", number: 1, login: "dependabot[bot]" },
        { repo: "acme/web", number: 2 },
      ],
    });
    // A loop saved before ignoreBots existed still has to skip bots.
    expect((await poll({ repositories: [] })).map((signal) => signal.ref)).toEqual(["acme/web#2"]);
  });

  it("only becomes a draft after being fetched, and is still skipped", async () => {
    givenGithub({
      items: [{ repo: "acme/web", number: 1, draft: false }],
      pulls: { "acme/web#1": { draft: true } },
    });
    expect(await poll()).toEqual([]);
  });
});

describe("pollGithub, issue assigned", () => {
  it("keys on the issue alone, so one plan is written per issue", async () => {
    givenGithub({ items: [{ repo: "acme/web", number: 4, title: "Add export" }] });
    const found = await pollGithub({
      workflowId: "github.issue_assigned",
      settings: {},
      accessToken: "token",
    });
    expect(found).toEqual([
      {
        key: "acme/web#4",
        kind: "issue",
        ref: "acme/web#4",
        title: "Add export",
        url: "https://github.com/acme/web/pull/4",
      },
    ]);
  });
});

describe("pollGithub, anything else", () => {
  it("says so rather than returning nothing", async () => {
    await expect(
      pollGithub({ workflowId: "github.made_up", settings: {}, accessToken: "token" }),
    ).rejects.toThrow(/cannot watch for github.made_up/);
  });
});
