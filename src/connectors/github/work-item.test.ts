import { describe, expect, it } from "vitest";
import { parseGithubUrl } from "./work-item.ts";

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
