import { describe, expect, it, vi } from "vitest";

vi.mock("./api.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api.ts")>();
  return {
    ...actual,
    createPullRequest: vi.fn(),
    pullForBranch: vi.fn(),
  };
});

vi.mock("#/server/git.ts", () => ({
  originUrl: vi.fn(),
  pushBranch: vi.fn(),
}));

const { createPullRequest, pullForBranch } = await import("./api.ts");
const { pushBranch } = await import("#/server/git.ts");
const { githubRuntime } = await import("./runtime.ts");

describe("github.open_pull_request", () => {
  it("opens a pull request for a branch already on GitHub, without pushing", async () => {
    vi.mocked(pullForBranch).mockResolvedValue(null);
    vi.mocked(createPullRequest).mockResolvedValue({
      html_url: "https://github.com/acme/web/pull/9",
      number: 9,
    });

    const outcome = await githubRuntime.applyAction!({
      actionId: "github.open_pull_request",
      target: {},
      source: {
        connectorId: "github",
        kind: "issue",
        ref: "acme/web#7",
        title: "Add a cache",
        url: "https://github.com/acme/web/issues/7",
      },
      body: "Add a cache",
      changes: { branch: "loopable/x", base: "main", repo: "acme/web", stat: "1 file changed" },
      credential: { accessToken: "secret-token", expiresAt: Date.now() + 60_000 },
    });

    expect(pushBranch).not.toHaveBeenCalled();
    expect(createPullRequest).toHaveBeenCalledWith(
      "secret-token",
      "acme/web",
      expect.objectContaining({ head: "loopable/x", base: "main" }),
    );
    expect(outcome.url).toBe("https://github.com/acme/web/pull/9");
  });
});
