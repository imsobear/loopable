import { defineManifest } from "../define.ts";

/**
 * Read, and send. Sending is only ever to the address a loop names, and the
 * agent never holds the token; Loopable sends what the agent wrote.
 */
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
];

export const gmailManifest = defineManifest({
  id: "gmail",
  name: "Gmail",
  tagline: "Send a loop's answer as an email from a connected account.",
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
  // Nothing to watch for now: "Tell me about new mail" was one person's
  // inbox, and Loopable is the team's agent. Gmail is somewhere answers go.
  workflows: [],
  actions: [
    {
      id: "gmail.send",
      name: "Send an email",
      summary: "Send the answer as an email from the connected account.",
      target: [
        {
          key: "to",
          kind: "text",
          label: "To",
          help: "One address, or several separated by commas.",
          placeholder: "team@example.com",
        },
        {
          key: "subject",
          kind: "text",
          label: "Subject",
          help: "Empty uses what the run was about.",
          placeholder: "Daily check",
        },
      ],
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
