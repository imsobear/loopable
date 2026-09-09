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

import type { ConnectionSettings, JsonValue, WorkItemKind } from "#/lib/domain.ts";
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

/** What form an answer takes, and so what can be done with it. */
export type AnswerShape = "text" | "review";

/** Something the connector can do to the outside world, on a loop's behalf. */
export type ActionDescriptor = {
  id: string;
  name: string;
  summary: string;
  /**
   * What this needs to know about where to write.
   *
   * Empty is the ordinary case and means the answer goes back to whatever
   * triggered the loop, which for most of the work there is to do is the only
   * sensible place: a review belongs on the pull request it is about. A field
   * appears here for the actions that can write somewhere else, and is filled
   * in when the trigger is on another service entirely and so has nothing in
   * it that this connector could write to.
   */
  target: SettingField[];
  /**
   * The shapes of answer this can carry as they are. A review reaching an
   * action that can only post text is flattened into it rather than refused,
   * because a review read as prose still says everything it found.
   */
  accepts: AnswerShape[];
};

/**
 * A configurable field, rendered generically as a form. Used both for
 * per-connection settings and for the conditions on a loop.
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
 * agent that, write the answer there. A loop is one instance of a workflow
 * with its knobs set.
 *
 * The prompt lives here rather than on the loop because "review a pull
 * request" is a problem the connector should solve once and get right, instead
 * of every person rediscovering it in an empty box. A loop may add to it, and
 * most never will.
 */
export type WorkflowDescriptor = {
  id: string;
  name: string;
  summary: string;
  /** What arrives, as a sentence a loop card can read back. */
  trigger: string;
  /**
   * The same thing exactly, in whatever the service itself understands. Shown
   * so that "when your review is requested" can be checked rather than taken
   * on trust, and read by the connector when it polls, so what a loop says it
   * watches for cannot drift from what it asks.
   *
   * Absent when there is no query to show: a stream of messages is not
   * something one can be written for, and an invented one shown as if it were
   * real is worse than saying nothing.
   */
  watches?: string;
  /** What gets written, as a sentence. */
  writes: string;
  /**
   * Where the agent runs. "temp" is a scratch directory holding the context
   * files and nothing else, which is right for judging a diff. "folder" is a
   * directory the loop names, for work that has to read the code around it;
   * the loop supplies it under the `folder` setting.
   */
  runsIn?: "temp" | "folder";
  /** The knobs a loop may set, in the connector's own words. */
  settings: SettingField[];
  /** Owned here. A loop's guidance is appended, never substituted. */
  prompt: string;
  guidancePlaceholder?: string;
  /**
   * What shape the answer takes. "text" is one block of prose to post;
   * "review" is a summary plus findings that get attached to lines.
   */
  answer: AnswerShape;
  /** Which action a loop starts out carrying the answer with. */
  actionId: string;
  /**
   * Which connector that action belongs to, when it is not this one.
   *
   * Most workflows answer where they read, and leave this alone. Some cannot:
   * a connector that only reads has nowhere to put an answer, and a workflow
   * whose entire point is to tell you about something somewhere you are
   * actually looking has to name that somewhere to be any use on the day it
   * is turned on. It is still only a starting point, and a loop may point
   * anywhere once it exists.
   */
  actionConnectorId?: ConnectorId;
  /**
   * What that action should be told about where to write. Against the
   * action's own `target` fields, and needed when the action's default cannot
   * apply: "whoever asked" means nothing to a loop that no person started.
   */
  actionTarget?: ConnectionSettings;
  /**
   * How long a new loop should leave between looks, when looking as often as
   * the engine does is the wrong pace for this workflow. A starting point like
   * the rest of these, and the loop's own once it exists.
   *
   * Worth setting where arriving one at a time is the problem rather than the
   * point: a workflow that weighs a batch to decide what deserves an agent has
   * no batch to weigh if it is handed each item the moment it lands.
   */
  pollEveryMs?: number;
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

/** What a loop is acting on, resolved from a link or from a signal. */
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
  /**
   * Whatever the write will need and cannot look up again: the token that says
   * which conversation a reply belongs to, and the like. Set when the item is
   * resolved and handed back untouched at `applyAction`.
   */
  carry?: JsonValue;
};

export type ActionOutcome = {
  /** Where the write landed, so a person can go and look at it. */
  url: string;
};

/**
 * What the answer is about, handed to whichever action writes it.
 *
 * Less than the work item, on purpose. An action can always say what the work
 * was and link to it, but `ref` and `carry` were written by the connector the
 * source came from and mean nothing outside it. `connectorId` is what makes
 * that checkable: an action reading either of those has to find its own name
 * here first, and ask the loop where to write when it does not.
 */
export type ActionSource = WorkItemRef & {
  connectorId: ConnectorId;
  title: string;
  url: string;
  carry?: JsonValue;
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
 * The key is what stops a loop acting twice, so it has to change exactly when
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
  /**
   * A few words of what is inside, when the connector already has them. Not
   * for display: the title is what gets shown. This is for deciding whether
   * the work is worth doing before paying an agent to find out, so it is only
   * worth filling when it comes free with what the poll already fetched.
   */
  preview?: string;
  /**
   * What the connector saw, for sources that cannot be read twice. A pull
   * request can be fetched again from its URL an hour later; a message is
   * handed over once and is gone from the stream, so what it said has to be
   * kept here or it is lost between noticing it and acting on it.
   */
  payload?: JsonValue;
};

export type ConnectorRuntime = {
  readiness(): Promise<Readiness>;
  /**
   * Whether this connector recognises a link, answered without any network
   * call, so a typo fails while the person is still looking at the box rather
   * than becoming a queued task that fails a second later.
   */
  identifyLink?(url: string): WorkItemRef | null;
  /**
   * Turn a link a person pasted, or what a poll kept, into something a loop
   * can act on. `payload` is whatever this connector put on the signal, and is
   * null for a task that came from a pasted link.
   */
  resolveWorkItem?(input: {
    url: string;
    payload: JsonValue | null;
    credential: unknown;
  }): Promise<WorkItem>;
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
    /**
     * Whatever this connector returned last time, or null on a first look.
     * Kept per loop rather than per account: a stream hands each message over
     * once, so two loops sharing one position would divide the messages
     * between them instead of each seeing all of them.
     */
    cursor: JsonValue | null;
  }): Promise<{ signals: Signal[]; cursor?: JsonValue }>;
  /** Carry out one of the manifest's actions. This is the part that writes. */
  applyAction?(input: {
    actionId: string;
    /**
     * Where to write, as the loop set it, against the action's own `target`
     * fields. Empty means the answer goes back to the source.
     */
    target: Record<string, unknown>;
    /** What the answer is about, and where it came from. */
    source: ActionSource;
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
