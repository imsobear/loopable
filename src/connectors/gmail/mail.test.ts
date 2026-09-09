import { describe, expect, it } from "vitest";
import {
  addressOf,
  attachmentNames,
  bodyText,
  headerOf,
  htmlToText,
  mailContext,
  senderName,
  summarise,
} from "./mail.ts";
import type { GmailMessage, MessagePart } from "./api.ts";

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64url");

function message(payload: MessagePart, over: Partial<GmailMessage> = {}): GmailMessage {
  return { id: "18f0", payload, ...over };
}

function headers(entries: Record<string, string>) {
  return Object.entries(entries).map(([name, value]) => ({ name, value }));
}

describe("addressOf and senderName", () => {
  it("splits a normal From header", () => {
    expect(addressOf("Some One <one@example.com>")).toBe("one@example.com");
    expect(senderName("Some One <one@example.com>")).toBe("Some One");
  });

  it("copes with a bare address", () => {
    expect(addressOf("one@example.com")).toBe("one@example.com");
    expect(senderName("one@example.com")).toBe("one@example.com");
  });

  it("unquotes a name that needed quoting", () => {
    expect(senderName('"Doe, Jane" <jane@example.com>')).toBe("Doe, Jane");
  });

  // Gmail is inconsistent about case in headers and the address is compared
  // against the connected mailbox to spot your own mail.
  it("lowercases the address so it can be compared", () => {
    expect(addressOf("One@Example.COM")).toBe("one@example.com");
  });
});

describe("headerOf", () => {
  it("finds a header whatever case it arrived in", () => {
    const mail = message({ headers: headers({ "suBJect": "Hello" }) });
    expect(headerOf(mail, "Subject")).toBe("Hello");
  });

  it("answers with nothing rather than undefined when it is absent", () => {
    expect(headerOf(message({}), "Subject")).toBe("");
  });
});

describe("bodyText", () => {
  it("reads a simple text message", () => {
    const mail = message({ mimeType: "text/plain", body: { data: b64("Hello there") } });
    expect(bodyText(mail)).toBe("Hello there");
  });

  it("prefers the text part over the html one", () => {
    const mail = message({
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: b64("Plain words") } },
        { mimeType: "text/html", body: { data: b64("<p>Marked up</p>") } },
      ],
    });
    expect(bodyText(mail)).toBe("Plain words");
  });

  it("falls back to the html when there is no text part", () => {
    const mail = message({
      mimeType: "multipart/alternative",
      parts: [{ mimeType: "text/html", body: { data: b64("<p>Only markup</p>") } }],
    });
    expect(bodyText(mail)).toBe("Only markup");
  });

  it("reaches parts nested inside a mixed message", () => {
    const mail = message({
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [{ mimeType: "text/plain", body: { data: b64("Buried but readable") } }],
        },
      ],
    });
    expect(bodyText(mail)).toBe("Buried but readable");
  });

  // A text attachment has a body like any other part, and reading it as the
  // message would replace the mail with whatever was attached to it.
  it("does not mistake an attachment for the body", () => {
    const mail = message({
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "text/plain", body: { data: b64("The actual message") } },
        {
          mimeType: "text/plain",
          filename: "notes.txt",
          body: { attachmentId: "x1", data: b64("Attached notes") },
        },
      ],
    });
    expect(bodyText(mail)).toBe("The actual message");
  });

  it("uses the snippet when there is nothing readable at all", () => {
    const mail = message({ mimeType: "image/png", body: { attachmentId: "a" } }, {
      snippet: "A picture",
    });
    expect(bodyText(mail)).toBe("A picture");
  });
});

describe("htmlToText", () => {
  it("keeps the words and the line breaks", () => {
    expect(htmlToText("<p>One</p><p>Two</p>")).toBe("One\nTwo");
    expect(htmlToText("One<br>Two")).toBe("One\nTwo");
  });

  it("drops scripts and styles rather than reading them out", () => {
    expect(htmlToText("<style>p{color:red}</style><p>Words</p>")).toBe("Words");
    expect(htmlToText("<script>alert(1)</script>Words")).toBe("Words");
  });

  it("unescapes the entities a reader would notice", () => {
    expect(htmlToText("<p>Fish &amp; chips &lt;yes&gt;</p>")).toBe("Fish & chips <yes>");
  });

  it("marks list items so a list still reads as one", () => {
    expect(htmlToText("<ul><li>One</li><li>Two</li></ul>")).toBe("- One\n- Two");
  });
});

describe("attachmentNames", () => {
  it("names them without fetching them", () => {
    const mail = message({
      parts: [
        { mimeType: "text/plain", body: { data: b64("hi") } },
        { filename: "invoice.pdf", body: { attachmentId: "a1" } },
      ],
    });
    expect(attachmentNames(mail)).toEqual(["invoice.pdf"]);
  });
});

describe("summarise", () => {
  it("leads with who it is from", () => {
    const mail = message({
      headers: headers({ From: "Jane <jane@example.com>", Subject: "Lunch?" }),
    });
    expect(summarise(mail)).toBe("Jane: Lunch?");
  });

  it("says so rather than showing an empty subject", () => {
    const mail = message({ headers: headers({ From: "jane@example.com" }) });
    expect(summarise(mail)).toBe("jane@example.com: (no subject)");
  });

  it("cuts a long one", () => {
    const mail = message({
      headers: headers({ From: "Jane <jane@example.com>", Subject: "x".repeat(200) }),
    });
    expect(summarise(mail)).toHaveLength(120);
    expect(summarise(mail).endsWith("…")).toBe(true);
  });
});

describe("mailContext", () => {
  it("puts the headers above the body, as one file", () => {
    const mail = message({
      mimeType: "text/plain",
      headers: headers({
        From: "Jane <jane@example.com>",
        To: "me@example.com",
        Subject: "Invoice 42",
        Date: "Tue, 8 Sep 2026 10:00:00 +0000",
      }),
      body: { data: b64("Please pay by Friday.") },
    });
    const file = mailContext(mail);
    expect(file.name).toBe("EMAIL.md");
    expect(file.body).toContain("# Invoice 42");
    expect(file.body).toContain("From: Jane <jane@example.com>");
    expect(file.body).toContain("Date: Tue, 8 Sep 2026 10:00:00 +0000");
    expect(file.body).toContain("Please pay by Friday.");
  });

  it("says an attachment exists and that it is not included", () => {
    const mail = message({
      headers: headers({ From: "jane@example.com", Subject: "Invoice" }),
      parts: [
        { mimeType: "text/plain", body: { data: b64("See attached.") } },
        { filename: "invoice.pdf", body: { attachmentId: "a1" } },
      ],
    });
    expect(mailContext(mail).body).toContain("Attachments (not included here): invoice.pdf");
  });

  it("cuts a mail that would otherwise fill the context window", () => {
    const mail = message({
      mimeType: "text/plain",
      headers: headers({ From: "list@example.com", Subject: "Digest" }),
      body: { data: b64("word ".repeat(20_000)) },
    });
    const body = mailContext(mail).body;
    expect(body).toContain("[cut here: the message is longer than this]");
    expect(body.length).toBeLessThan(21_000);
  });

  it("says so rather than handing over an empty file", () => {
    const mail = message({ headers: headers({ From: "a@b.c", Subject: "Nothing" }) });
    expect(mailContext(mail).body).toContain("(this message has no readable text)");
  });
});
