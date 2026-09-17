import { beforeEach, describe, expect, it, vi } from "vitest";
import { getIssue, getPull, getRepo, listPullFiles } from "./api.ts";
import { githubRef, parseGithubRef, parseGithubUrl, resolveWorkItem } from "./work-item.ts";

vi.mock("./api.ts", () => ({
  getPull: vi.fn(),
  listPullFiles: vi.fn(),
  getIssue: vi.fn(),
  getRepo: vi.fn(),
}));

describe("githubRef", () => {
  it("survives the round trip that a write depends on", () => {
    for (const [repo, number] of [
      ["acme/web", 1],
      ["acme/web.js", 4321],
      ["Acme-Corp/under_score", 7],
    ] as const) {
      expect(parseGithubRef(githubRef(repo, number))).toEqual({ repo, number });
    }
  });

  it("refuses anything it did not write, rather than guessing a repository", () => {
    // A ref belongs to the connector that made it. Reading someone else's as
    // if it were a repository and a number is how a write lands in the wrong
    // place, so this is loud instead.
    for (const ref of ["acme/web", "#12", "acme/web#", "wechat:o9cq808@im.wechat", ""]) {
      expect(() => parseGithubRef(ref), ref).toThrow(/Not a GitHub ref/);
    }
  });
});

describe("parseGithubUrl", () => {
  it("reads a pull request link", () => {
    expect(parseGithubUrl("https://github.com/acme/web/pull/123")).toEqual({
      repo: "acme/web",
      kind: "pull_request",
      number: 123,
    });
  });

  it("reads an issue link", () => {
    expect(parseGithubUrl("https://github.com/acme/web/issues/7")).toEqual({
      repo: "acme/web",
      kind: "issue",
      number: 7,
    });
  });

  it("accepts what a person actually pastes", () => {
    const cases = [
      "  https://github.com/acme/web/pull/9  ",
      "https://github.com/acme/web/pull/9/files",
      "https://github.com/acme/web/pull/9#discussion_r1",
      "http://github.com/acme/web/pull/9",
      "github.com/acme/web/pull/9",
    ];
    for (const input of cases) {
      expect(parseGithubUrl(input), input).toMatchObject({ repo: "acme/web", number: 9 });
    }
  });

  it("refuses links that are not a pull request or issue", () => {
    const cases = [
      "https://github.com/acme/web",
      "https://github.com/acme/web/commit/abc123",
      "https://gitlab.com/acme/web/pull/1",
      "not a url",
      "",
    ];
    for (const input of cases) {
      expect(parseGithubUrl(input), input).toBeNull();
    }
  });

  it("refuses a host that merely ends with github.com", () => {
    const cases = [
      "https://notgithub.com/acme/web/pull/1",
      "https://github.com.evil.test/acme/web/pull/1",
      "https://evil.test/https://github.com/acme/web/pull/1",
    ];
    for (const input of cases) {
      expect(parseGithubUrl(input), input).toBeNull();
    }
  });
});

const getPullMock = vi.mocked(getPull);
const listPullFilesMock = vi.mocked(listPullFiles);
const getIssueMock = vi.mocked(getIssue);
const getRepoMock = vi.mocked(getRepo);

describe("resolveWorkItem", () => {
  beforeEach(() => {
    getPullMock.mockReset();
    listPullFilesMock.mockReset();
    getIssueMock.mockReset();
    getRepoMock.mockReset();
  });

  it("names a clone for the agent and keeps the diff for anchoring", async () => {
    getPullMock.mockResolvedValue({
      number: 12,
      title: "Cache the manifest",
      body: "So we stop hitting the network.",
      draft: false,
      html_url: "https://github.com/acme/web/pull/12",
      user: { login: "ada" },
      head: { sha: "abc123" },
      base: { ref: "main" },
      changed_files: 1,
    });
    listPullFilesMock.mockResolvedValue([
      {
        filename: "src/a.ts",
        status: "modified",
        additions: 1,
        deletions: 0,
        patch: "@@ -1,1 +1,2 @@\n const a = 1;\n+const b = 2;\n",
      },
    ]);

    const item = await resolveWorkItem("https://github.com/acme/web/pull/12", "token");

    expect(item.checkout).toEqual({
      url: "https://github.com/acme/web.git",
      ref: "pull/12/head",
      sha: "abc123",
      base: "main",
      repo: "acme/web",
    });
    expect(item.commentable?.["src/a.ts"]).toContain(2);
    expect(item.context.map((file) => file.name)).toEqual(["PULL_REQUEST.md"]);
    expect(item.context[0]!.body).toContain("Cache the manifest");
    expect(item.context[0]!.body).toContain("Clone: https://github.com/acme/web.git");
    expect(item.context[0]!.body).toContain("src/a.ts");
    expect(item.context.some((file) => file.name === "CHANGES.md")).toBe(false);
    expect(JSON.stringify(item)).not.toContain("token");
  });

  it("clones the default branch for an issue, still without a token", async () => {
    getIssueMock.mockResolvedValue({
      number: 7,
      title: "Add a cache",
      body: "Please.",
      html_url: "https://github.com/acme/web/issues/7",
      user: { login: "ada" },
    });
    getRepoMock.mockResolvedValue({
      default_branch: "main",
      clone_url: "https://github.com/acme/web.git",
      full_name: "acme/web",
    });

    const item = await resolveWorkItem("https://github.com/acme/web/issues/7", "token");

    expect(item.checkout).toEqual({
      url: "https://github.com/acme/web.git",
      ref: "main",
      base: "main",
      repo: "acme/web",
    });
    expect(item.context.map((file) => file.name)).toEqual(["ISSUE.md"]);
    expect(item.context[0]!.body).toContain("Clone: https://github.com/acme/web.git");
    expect(JSON.stringify(item)).not.toContain("token");
  });
});
