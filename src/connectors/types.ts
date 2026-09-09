/**
 * The connector contract.
 *
 * Every connector is a folder under src/connectors that exports two things:
 *
 *   manifest.ts  pure data, safe to import from the browser. Everything the UI
 *                needs to render a connector it has never heard of.
 *   runtime.ts   server-only behaviour: authorizing, reading signals, writing
 *                back. Only ever imported from server functions.
 *
 * Adding a connector must not require touching any page.
 */

import type { JsonValue, WorkItemKind } from "#/lib/domain.ts";
import type { Commentable, Finding } from "#/lib/review.ts";

export type ConnectorId = string;

/** How a user connects an account. The UI renders from this, so the set is closed. */
export type AuthDescriptor =
  | {
      kind: "oauth_redirect";
      /** Shown before sending the user off to the provider. */
      scopes: string[];
      /** This install needs an app registration before anyone can connect. */
      needsAppRegistration: boolean;
    }
  | {
      kind: "token";
      fields: TokenField[];
      /** Where the user creates the token. */
      helpUrl?: string;
    }
  | {
      kind: "qr_scan";
      /** What the person is about to bind, since a scan says less than a consent screen. */
      note: string;
    };

export type TokenField = {
  key: string;
  label: string;
  placeholder?: string;
  secret: boolean;
  optional?: boolean;
};

/** Something the connector can do to the outside world, on a rule's behalf. */
export type ActionDescriptor = {
  id: string;
  name: string;
  summary: string;
};

/**
 * A configurable field, rendered generically as a form. Used both for
 * per-connection settings and for the conditions on a rule.
 */
export type SettingField =
  | { key: string; kind: "boolean"; label: string; help?: string; default: boolean }
  | { key: string; kind: "text"; label: string; help?: string; placeholder?: string }
  | { key: string; kind: "string_list"; label: string; help?: string; placeholder?: string }
  | {
      key: string;
      kind: "select";
      label: string;
      help?: string;
      options: Array<{ value: string; label: string }>;
      default: string;
    };

/**
 * A whole job, named the way a person would name it: watch for this, ask an
 * agent that, write the answer there. A rule is one instance of a workflow
 * with its knobs set.
 *
 * The prompt lives here rather than on the rule because "review a pull
 * request" is a problem the connector should solve once and get right, instead
 * of every person rediscovering it in an empty box. A rule may add to it, and
 * most never will.
 */
export type WorkflowDescriptor = {
  id: string;
  name: string;
  summary: string;
  /** What arrives, as a sentence a rule card can read back. */
  trigger: string;
  /**
   * The same thing exactly, in whatever the service itself understands. Shown
   * so that "when your review is requested" can be checked rather than taken
   * on trust, and read by the connector when it polls, so what a rule says it
   * watches for cannot drift from what it asks.
   */
  watches: string;
  /** What gets written, as a sentence. */
  writes: string;
  /** The knobs a rule may set, in the connector's own words. */
  settings: SettingField[];
  /** Owned here. A rule's guidance is appended, never substituted. */
  prompt: string;
  guidancePlaceholder?: string;
  /**
   * What shape the answer takes. "text" is one block of prose to post;
   * "review" is a summary plus findings that get attached to lines.
   */
  answer: "text" | "review";
  /** Which action carries the answer back. Not a choice a rule makes. */
  actionId: string;
};

export type ConnectorManifest = {
  id: ConnectorId;
  name: string;
  /** One line, shown on the connector card. */
  tagline: string;
  docsUrl?: string;
  /** Lucide icon name, so the client bundle carries no connector assets. */
  icon: string;
  /** Tailwind class for the card icon tile. */
  accent: string;
  auth: AuthDescriptor;
  workflows: WorkflowDescriptor[];
  actions: ActionDescriptor[];
  settings: SettingField[];
  /** Connecting more than one account of this connector is meaningful. */
  allowsMultipleAccounts: boolean;
};

/** The account a credential belongs to, as shown in the UI. */
export type ConnectorAccount = {
  id: string;
  label: string;
  url?: string;
  avatarUrl?: string;
  scopes?: string[];
};

export type AuthResult = {
  credential: unknown;
  account: ConnectorAccount;
};

export type IdentityResult = {
  account: ConnectorAccount;
  /**
   * Set only when reading the identity renewed the credential, so the caller
   * stores it instead of refreshing again on every read.
   */
  renewedCredential?: unknown;
};

/** Whether this install can offer the connector at all. */
export type Readiness = { ready: true } | { ready: false; reason: string; fixHint?: string };

export type StartAuthorizationContext = {
  /** Absolute callback URL this server will receive, provider must allow it. */
  redirectUri: string;
  state: string;
};

export type CompleteAuthorizationContext = {
  redirectUri: string;
  code: string;
  verifier: string;
};

/**
 * A login finished on a phone rather than in the browser.
 *
 * `attempt` is the connector's own business and travels back and forth through
 * the page untouched, because these codes live about two minutes and holding
 * them on the server would lose every login in progress to a reload. Nothing
 * secret goes in it: whatever identifies the code is on screen already, in the
 * code itself.
 */
export type QrChallenge = {
  attempt: JsonValue;
  /** What the QR code should contain. Rendering is the caller's business. */
  encode: string;
  /** Roughly how long the provider will honour it, so the page can offer another. */
  expiresInMs: number;
};

export type QrOutcome =
  | { state: "pending"; attempt: JsonValue; hint?: string }
  | { state: "expired"; reason?: string }
  | { state: "confirmed"; result: AuthResult };

/** What a rule is acting on, resolved from a link or from a signal. */
export type WorkItem = WorkItemRef & {
  title: string;
  url: string;
  /** Files the agent should read before it writes anything. */
  context: Array<{ name: string; body: string }>;
  /**
   * Which lines of which files a comment can be attached to. Absent when the
   * connector cannot say, in which case nothing is anchored rather than
   * anchored on a guess.
   */
  commentable?: Commentable;
};

export type ActionOutcome = {
  /** Where the write landed, so a person can go and look at it. */
  url: string;
};

/**
 * What a link points at, as far as can be told without asking the service.
 *
 * `ref` names the thing within its connector and nothing more: a pull request
 * is `owner/name#12`, a chat is whoever is on the other end of it. Only the
 * connector that wrote a ref reads it again, so the shape is its own business.
 * Everything in between treats it as an opaque label that is stable for the
 * life of the thing and short enough to show someone.
 */
export type WorkItemRef = {
  kind: WorkItemKind;
  ref: string;
};

/**
 * One thing a workflow is watching for, as it stands right now.
 *
 * The key is what stops a rule acting twice, so it has to change exactly when
 * the thing deserves a fresh run and not otherwise: a new commit on a pull
 * request is worth reviewing again, another comment on it is not.
 */
export type Signal = WorkItemRef & {
  key: string;
  title: string;
  url: string;
  /**
   * Why this should not be run on its own, when it should not be. Something a
   * connector recognises but cannot do well is held rather than dropped: a
   * review that was asked for and then silently never happened is a worse
   * answer than one that says the pull request was too big to read.
   *
   * A held signal can still be run deliberately, which is the difference
   * between this and the settings that filter things out entirely.
   */
  hold?: string;
};

export type ConnectorRuntime = {
  readiness(): Promise<Readiness>;
  /**
   * Whether this connector recognises a link, answered without any network
   * call, so a typo fails while the person is still looking at the box rather
   * than becoming a queued task that fails a second later.
   */
  identifyLink?(url: string): WorkItemRef | null;
  /** Turn a link a person pasted into something a rule can act on. */
  resolveWorkItem?(input: { url: string; credential: unknown }): Promise<WorkItem>;
  /**
   * Everything matching this workflow at this moment. Asked repeatedly, so it
   * answers with the present state rather than with what has changed: working
   * out what is new is the caller's job, and only the caller knows what it has
   * already acted on.
   */
  poll?(input: {
    workflowId: string;
    settings: Record<string, unknown>;
    credential: unknown;
  }): Promise<Signal[]>;
  /** Carry out one of the manifest's actions. This is the part that writes. */
  applyAction?(input: {
    actionId: string;
    item: WorkItem;
    body: string;
    /** Anchored comments, already checked against the diff by the caller. */
    comments?: Finding[];
    credential: unknown;
  }): Promise<ActionOutcome>;
  auth: {
    /** Required when auth.kind is "oauth_redirect". */
    startAuthorization?(ctx: StartAuthorizationContext): Promise<{
      redirectUrl: string;
      verifier: string;
    }>;
    completeAuthorization?(ctx: CompleteAuthorizationContext): Promise<AuthResult>;
    /** Required when auth.kind is "token". */
    connectWithFields?(fields: Record<string, string>): Promise<AuthResult>;
    /** Both required when auth.kind is "qr_scan". */
    startQrLogin?(): Promise<QrChallenge>;
    pollQrLogin?(attempt: JsonValue): Promise<QrOutcome>;
    /** Re-read the account to prove a stored credential still works. */
    identity(credential: unknown): Promise<IdentityResult>;
    revoke?(credential: unknown): Promise<void>;
  };
};

export type Connector = {
  manifest: ConnectorManifest;
  runtime: ConnectorRuntime;
};
