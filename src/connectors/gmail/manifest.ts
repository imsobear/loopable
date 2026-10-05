import { defineManifest } from "../define.ts";

/**
 * Reading is the whole of it. Gmail has no send scope here on purpose: an
 * agent that can reply as you, to anyone, is a different and much larger thing
 * to agree to than one that reads your inbox and tells you about it.
 */
export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

export const gmailManifest = defineManifest({
  id: "gmail",
  name: "Gmail",
  tagline: "Connect an inbox. There are no Gmail workflows yet.",
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
  // No workflows for now. "Tell me about new mail" was one person's inbox,
  // and Loopable is the team's agent. Connecting still works, so a workflow
  // can come back without asking anyone to sign in again.
  workflows: [],
  // Read-only, so there is nothing to offer. A loop built on Gmail writes
  // through whichever connector it picks.
  actions: [],
  settings: [],
  // The redirect authorizes whichever account the browser is signed in as, so
  // reaching a second one means signing out of Google first.
  allowsMultipleAccounts: false,
  // Mail arrives or it does not. There is nothing to paste and nothing to
  // start, so the page says so rather than offering a box that only errors.
  byHand: { kind: "none" },
});
