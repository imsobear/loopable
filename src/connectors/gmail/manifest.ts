import { defineManifest } from "../define.ts";
import type { SettingField } from "../types.ts";

/**
 * Read, and send. Sending is only ever to the connected account itself, the
 * way a bot answers whoever asked it; the agent never holds the token.
 */
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
];

/** Gmail's own search, added to what the trigger already asks. */
const extraQuery: SettingField = {
  key: "extraQuery",
  kind: "text",
  label: "Only mail matching",
  help: "Gmail search terms, such as from:billing@vendor.com or subject:invoice.",
  placeholder: "from:alerts@example.com",
};

/**
 * Whether a quiet mailbox stays quiet. Without it every receipt costs a run.
 * The triage itself lives in the dispatcher and reads this key.
 */
const needsMeOnly: SettingField = {
  key: "needsMeOnly",
  kind: "boolean",
  label: "Skip mail that needs nothing",
  help: "A quick look first decides which mail asks for something. The rest is kept, not run.",
  default: true,
};

/** A cost limit rather than a filter: anything past it is seen on the next look. */
const perPoll: SettingField = {
  key: "maxPerPoll",
  kind: "select",
  label: "At most, per check",
  options: [
    { value: "3", label: "3 emails" },
    { value: "10", label: "10 emails" },
    { value: "25", label: "25 emails" },
  ],
  default: "10",
};

const skipOwn: SettingField = {
  key: "skipOwn",
  kind: "boolean",
  label: "Skip mail sent from this account",
  default: true,
};

export const gmailManifest = defineManifest({
  id: "gmail",
  name: "Gmail",
  tagline: "Start a loop when an email arrives, or email an answer to the connected account.",
  docsUrl: "https://developers.google.com/gmail/api/guides",
  icon: "Gmail",
  // Gmail's own red, now that the mark is Gmail's own too. A near miss on a
  // colour people know is more noticeable than a different colour entirely.
  accent: "bg-[#ea4335] text-white",
  auth: {
    kind: "oauth_redirect",
    scopes: GMAIL_SCOPES,
    needsAppRegistration: true,
  },
  triggers: [
    {
      id: "gmail.new_mail",
      when: "An email arrives",
      trigger: "an email arrives in the connected inbox",
      // A day's window rather than "unread": reading a mail on your phone
      // should not decide whether the loop ever saw it. What stops a mail
      // being handled twice is its id, not its state.
      watches: "in:inbox newer_than:1d",
      // The mail is the whole of the work, handed over as a file.
      runsIn: "temp",
      settings: [extraQuery, needsMeOnly, perPoll, skipOwn],
      answer: "text",
      // Kept in Inbox until a loop says where it should go.
      actionConnectorId: "schedule",
      actionId: "schedule.record",
      // Mail turns up one piece at a time, and deciding what deserves a run
      // needs several to compare.
      pollEveryMs: 30 * 60_000,
    },
  ],
  // No ready-made job: what to do with mail is the team's to say, in a
  // custom loop.
  workflows: [],
  actions: [
    {
      id: "gmail.send",
      name: "Email this account",
      summary:
        "Send the answer to the connected account's own inbox, in the same thread when it started from an email there.",
      target: [],
      // A review sent here reads as prose, with file and line written in.
      accepts: ["text"],
    },
  ],
  settings: [],
  // The redirect authorizes whichever account the browser is signed in as, so
  // reaching a second one means signing out of Google first.
  allowsMultipleAccounts: false,
  // Mail arrives or it does not. There is nothing to paste and nothing to
  // start, so the page says so rather than offering a box that only errors.
  byHand: { kind: "none" },
});
