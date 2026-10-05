import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api.ts")>();
  return {
    ...actual,
    getProfile: vi.fn(async () => ({ emailAddress: "team@example.com" })),
    getMessage: vi.fn(async () => ({
      id: "m1",
      threadId: "t1",
      payload: {
        headers: [
          { name: "Subject", value: "Invoice overdue" },
          { name: "Message-ID", value: "<abc@mail>" },
        ],
      },
    })),
    sendMessage: vi.fn(async () => ({ id: "sent1" })),
  };
});

const { sendMessage } = await import("./api.ts");
const { gmailRuntime } = await import("./runtime.ts");

const credential = { accessToken: "token", expiresAt: Date.now() + 60_000 };
const decode = (raw: string) =>
  Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

beforeEach(() => vi.mocked(sendMessage).mockClear());

describe("gmail.send", () => {
  it("emails the connected account, not anyone the loop names", async () => {
    await gmailRuntime.applyAction!({
      actionId: "gmail.send",
      target: {},
      source: { connectorId: "schedule", kind: "occurrence", ref: "daily", title: "Daily check", url: "" },
      body: "All fine.",
      credential,
    });

    const [, raw, threadId] = vi.mocked(sendMessage).mock.calls[0]!;
    expect(decode(raw)).toContain("To: team@example.com\r\n");
    expect(decode(raw)).toContain("Subject: Daily check\r\n");
    expect(threadId).toBeUndefined();
  });

  it("answers in the thread of the email that started the run", async () => {
    await gmailRuntime.applyAction!({
      actionId: "gmail.send",
      target: {},
      source: { connectorId: "gmail", kind: "email", ref: "mail#m1", title: "Invoice overdue", url: "" },
      body: "Paid on Friday.",
      credential,
    });

    const [, raw, threadId] = vi.mocked(sendMessage).mock.calls[0]!;
    expect(threadId).toBe("t1");
    expect(decode(raw)).toContain("Subject: Re: Invoice overdue\r\n");
    expect(decode(raw)).toContain("In-Reply-To: <abc@mail>\r\n");
  });
});
