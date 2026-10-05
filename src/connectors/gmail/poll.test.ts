import { afterEach, describe, expect, it, vi } from "vitest";
import { pollGmail, queryFor } from "./poll.ts";

describe("queryFor", () => {
  it("asks what the workflow says it watches", () => {
    expect(queryFor("gmail.new_mail", {})).toBe("in:inbox newer_than:1d");
  });

  it("appends what the loop added", () => {
    expect(queryFor("gmail.new_mail", { extraQuery: "from:bank.example.com" })).toBe(
      "in:inbox newer_than:1d from:bank.example.com",
    );
  });

  it("ignores an empty box rather than asking a query with a space on the end", () => {
    expect(queryFor("gmail.new_mail", { extraQuery: "   " })).toBe("in:inbox newer_than:1d");
  });

  it("refuses a workflow it does not have", () => {
    expect(() => queryFor("gmail.nonsense", {})).toThrow(/cannot watch/);
  });
});

type FakeMail = { id: string; from: string; subject?: string };

/**
 * Stands in for Gmail. A poll lists ids and then asks for the headers of each,
 * so those are the only two shapes the stub needs to know.
 */
function givenGmail(mails: FakeMail[]) {
  const asked: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    asked.push(url);
    const path = url.replace("https://gmail.googleapis.com/gmail/v1/users/me", "");
    if (path.startsWith("/messages?")) {
      // Gmail leaves the key out entirely when nothing matches, which is the
      // case worth reproducing rather than an empty array.
      const body = mails.length > 0 ? { messages: mails.map(({ id }) => ({ id })) } : {};
      return new Response(JSON.stringify(body), { status: 200 });
    }
    const one = /^\/messages\/([^?]+)/.exec(path);
    if (one) {
      const mail = mails.find((entry) => entry.id === one[1]);
      if (!mail) throw new Error(`no such message: ${one[1]}`);
      return new Response(
        JSON.stringify({
          id: mail.id,
          payload: {
            headers: [
              { name: "From", value: mail.from },
              { name: "Subject", value: mail.subject ?? "Something" },
            ],
          },
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

const poll = (settings: Record<string, unknown> = {}) =>
  pollGmail({
    workflowId: "gmail.new_mail",
    settings,
    accessToken: "token",
    emailAddress: "me@example.com",
  });

describe("pollGmail", () => {
  it("turns each message into a signal keyed by its id", async () => {
    givenGmail([{ id: "18f0", from: "Jane <jane@example.com>", subject: "Lunch?" }]);
    const signals = await poll();
    expect(signals).toEqual([
      {
        key: "mail#18f0",
        kind: "email",
        ref: "mail#18f0",
        title: "Jane: Lunch?",
        url: "https://mail.google.com/mail/u/0/#all/18f0",
        payload: { messageId: "18f0" },
      },
    ]);
  });

  it("answers with nothing when the mailbox has nothing matching", async () => {
    givenGmail([]);
    expect(await poll()).toEqual([]);
  });

  /**
   * The key is the id and nothing else, which is what stops a mail being
   * acted on twice. Reading or filing it must not look like new work.
   */
  it("keys on the message alone, not on anything that can change about it", async () => {
    givenGmail([{ id: "18f0", from: "jane@example.com" }]);
    const [first] = await poll();
    const [again] = await poll();
    expect(first!.key).toBe(again!.key);
  });

  it("skips your own mail by default, and keeps it when asked", async () => {
    givenGmail([
      { id: "a", from: "Me <me@example.com>" },
      { id: "b", from: "jane@example.com" },
    ]);
    expect((await poll()).map((signal) => signal.ref)).toEqual(["mail#b"]);
    expect((await poll({ skipOwn: false })).map((signal) => signal.ref)).toEqual([
      "mail#a",
      "mail#b",
    ]);
  });

  it("asks Gmail for no more than the loop's limit", async () => {
    const { asked } = givenGmail([{ id: "a", from: "jane@example.com" }]);
    await poll({ maxPerPoll: "3" });
    expect(asked[0]).toContain("maxResults=3");
  });

  // A loop saved before a setting existed has it missing rather than false,
  // and must behave as though the default had been there all along.
  it("falls back to the workflow's defaults for anything unset", async () => {
    const { asked } = givenGmail([{ id: "a", from: "me@example.com" }]);
    expect(await poll({})).toEqual([]);
    expect(asked[0]).toContain("maxResults=10");
  });

  it("sends the loop's extra terms to Gmail rather than filtering afterwards", async () => {
    const { asked } = givenGmail([{ id: "a", from: "jane@example.com" }]);
    await poll({ extraQuery: "from:jane@example.com" });
    expect(decodeURIComponent(asked[0]!)).toContain("in:inbox newer_than:1d from:jane@example.com");
  });

  it("refuses a workflow it does not have", async () => {
    givenGmail([]);
    await expect(
      pollGmail({
        workflowId: "gmail.nonsense",
        settings: {},
        accessToken: "token",
        emailAddress: "me@example.com",
      }),
    ).rejects.toThrow(/cannot watch/);
  });
});
