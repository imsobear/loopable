import { defineManifest } from "../define.ts";
import type { SettingField } from "../types.ts";

/**
 * Reading is the whole of it. Gmail has no send scope here on purpose: an
 * agent that can reply as you, to anyone, is a different and much larger thing
 * to agree to than one that reads your inbox and tells you about it.
 */
export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

/**
 * Gmail's own search, appended to what the workflow already asks. This is the
 * setting that makes the difference between a useful loop and a firehose, so
 * it leads.
 */
const extraQuery: SettingField = {
  key: "extraQuery",
  kind: "text",
  label: "Narrow it down",
  help: "Gmail search terms, added to the query above. For example: from:bank.example.com, or subject:invoice, or -from:notifications@github.com.",
  placeholder: "from:boss@example.com",
};

/**
 * A cap on how many mails one look can turn into runs, which is a cost limit
 * rather than a filter: every mail past it is still noticed on the next poll,
 * because nothing has marked it as dealt with.
 */
const perPoll: SettingField = {
  key: "maxPerPoll",
  kind: "select",
  label: "At most, per look",
  help: "Each mail costs a full agent run. A quiet mailbox never reaches this; a busy one should be narrowed above rather than raised here.",
  options: [
    { value: "3", label: "3 messages" },
    { value: "10", label: "10 messages" },
    { value: "25", label: "25 messages" },
  ],
  default: "10",
};

const skipOwn: SettingField = {
  key: "skipOwn",
  kind: "boolean",
  label: "Skip mail I sent",
  help: "Your own messages show up in threads you are part of, and being told about what you just sent is not useful.",
  default: true,
};

const TELL_ME_PROMPT = [
  "Read the email in EMAIL.md and tell me what it says.",
  "",
  "You are writing a phone notification, not a summary document. Two or three",
  "sentences. No headings, no bullet lists, no preamble like \"this email is\".",
  "Lead with who it is from and what they want.",
  "",
  "Say plainly if it needs something from me and by when. If there is a",
  "deadline, an amount of money, a date, or a link I have to act on, include it",
  "exactly as written rather than describing it.",
  "",
  "If it is an automated notification, a newsletter, or otherwise needs nothing",
  "from me, say so in one line and stop.",
].join("\n");

export const gmailManifest = defineManifest({
  id: "gmail",
  name: "Gmail",
  tagline: "Read new mail and have an agent tell you what matters.",
  docsUrl: "https://developers.google.com/gmail/api/guides",
  icon: "Mail",
  accent: "bg-red-600 text-white",
  auth: {
    kind: "oauth_redirect",
    scopes: GMAIL_SCOPES,
    needsAppRegistration: true,
  },
  workflows: [
    {
      id: "gmail.new_mail",
      name: "Tell me about new mail",
      summary: "Reads mail as it arrives and sends you a short account of it somewhere you look.",
      trigger: "mail arrives in your inbox",
      // A day's window rather than "unread": reading a mail on your phone
      // should not decide whether the loop ever saw it. What stops a mail
      // being handled twice is its id, not its state, so re-seeing yesterday's
      // costs nothing and a poller that was off for an hour misses nothing.
      watches: "in:inbox newer_than:1d",
      writes: "a message telling you what arrived",
      // Nothing to check out: the mail is the whole of the work, and it is
      // handed over as a file.
      runsIn: "temp",
      settings: [extraQuery, perPoll, skipOwn],
      prompt: TELL_ME_PROMPT,
      guidancePlaceholder:
        "What you care about in your mail. For example: I only need to know about anything involving money or a deadline.",
      answer: "text",
      // Gmail cannot write, so this answers on WeChat, which is the point of
      // the workflow rather than an accident of it: mail you are already
      // reading in Gmail does not need telling about. `source` would mean
      // nothing here, since no chat started this.
      actionConnectorId: "wechat",
      actionId: "wechat.reply",
      actionTarget: { to: "me" },
    },
  ],
  // Read-only, so there is nothing to offer. A loop built on Gmail writes
  // through whichever connector it picks.
  actions: [],
  settings: [],
  // The redirect authorizes whichever account the browser is signed in as, so
  // reaching a second one means signing out of Google first.
  allowsMultipleAccounts: false,
});
