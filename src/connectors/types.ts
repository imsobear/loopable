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

import type { JsonValue } from "#/lib/domain.ts";

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
    };

export type TokenField = {
  key: string;
  label: string;
  placeholder?: string;
  secret: boolean;
  optional?: boolean;
};

/** A signal the connector can observe. Drives the rules UI. */
export type EventDescriptor = {
  id: string;
  name: string;
  summary: string;
  /**
   * Which conditions a rule can narrow this event by. Declared here because
   * "repositories" and "drafts" are GitHub's words, and the rules table has no
   * business knowing them.
   */
  conditions?: SettingField[];
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
 * A rule worth suggesting for this connector. Templates are offered, never
 * created behind a person's back.
 */
export type RuleTemplate = {
  id: string;
  name: string;
  summary: string;
  eventId: string;
  actionId: string;
  instruction: string;
  conditions: Record<string, JsonValue>;
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
  events: EventDescriptor[];
  actions: ActionDescriptor[];
  settings: SettingField[];
  ruleTemplates: RuleTemplate[];
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

/** What a rule is acting on, resolved from a link or, later, from a signal. */
export type WorkItem = {
  kind: "pull_request" | "issue";
  repo: string;
  number: number;
  title: string;
  url: string;
  /** Files the agent should read before it writes anything. */
  context: Array<{ name: string; body: string }>;
};

export type ActionOutcome = {
  /** Where the write landed, so a person can go and look at it. */
  url: string;
};

export type ConnectorRuntime = {
  readiness(): Promise<Readiness>;
  /** Turn a link a person pasted into something a rule can act on. */
  resolveWorkItem?(input: { url: string; credential: unknown }): Promise<WorkItem>;
  /** Carry out one of the manifest's actions. This is the part that writes. */
  applyAction?(input: {
    actionId: string;
    item: WorkItem;
    body: string;
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
    /** Re-read the account to prove a stored credential still works. */
    identity(credential: unknown): Promise<IdentityResult>;
    revoke?(credential: unknown): Promise<void>;
  };
};

export type Connector = {
  manifest: ConnectorManifest;
  runtime: ConnectorRuntime;
};
