import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { RefreshCw, RotateCcw } from "lucide-react";
import { ConnectionSettingsForm } from "@/components/connection-settings-form";
import { ConnectionStatusBadge } from "@/components/connection-status";
import { ConnectorIcon } from "@/components/connector-icon";
import { QrConnect } from "@/components/qr-connect";
import { TokenConnect } from "@/components/token-connect";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Empty, List, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { connectionNoun, connectorManifest } from "@/connectors/manifests.ts";
import { registrableCallbackUrl } from "@/lib/callback.ts";
import type { ConnectionView } from "@/lib/domain.ts";
import { ago } from "@/lib/time.ts";
import {
  disconnectConnection,
  getConnectorOverview,
  verifyConnection,
} from "@/server/functions/connectors.ts";

export const Route = createFileRoute("/connectors/$connectorId")({
  loader: async ({ params }) => {
    const manifest = connectorManifest(params.connectorId);
    if (!manifest) throw notFound();
    const overview = await getConnectorOverview();
    const state = overview.find((entry) => entry.connectorId === params.connectorId);
    if (!state) throw notFound();
    return state;
  },
  component: ConnectorDetailPage,
});

function ConnectorDetailPage() {
  const { connectorId } = Route.useParams();
  const state = Route.useLoaderData();
  const manifest = connectorManifest(connectorId)!;
  const canAddAccount =
    manifest.allowsMultipleAccounts || state.connections.length === 0;
  const scans = manifest.auth.kind === "qr_scan";
  const tokens = manifest.auth.kind === "token";
  const [scanning, setScanning] = useState(false);
  const [pasting, setPasting] = useState(false);

  const connectButton =
    state.readiness.ready && canAddAccount ? (
      scans ? (
        <Button onClick={() => setScanning((open) => !open)}>
          {scanning ? "Cancel" : "Connect"}
        </Button>
      ) : tokens ? (
        <Button onClick={() => setPasting((open) => !open)}>{pasting ? "Cancel" : "Add bot"}</Button>
      ) : (
        <Button nativeButton={false} render={<a href={`/api/connectors/${connectorId}/authorize`} />}>
          {state.connections.length > 0 ? "Add account" : "Connect"}
        </Button>
      )
    ) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ to: "/connectors", label: "Connectors" }}
        icon={<ConnectorIcon icon={manifest.icon} accent={manifest.accent} />}
        title={manifest.name}
        description={manifest.tagline}
        actions={connectButton}
      />

      {!state.readiness.ready ? (
        <Alert variant="destructive">
          <AlertTitle>Not available in this build</AlertTitle>
          <AlertDescription className="flex flex-col gap-1">
            <span>{state.readiness.reason}</span>
            {state.readiness.fixHint ? <span>{state.readiness.fixHint}</span> : null}
            {manifest.auth.kind === "oauth_redirect" ? (
              <span className="text-xs">
                Callback URL: <code>{registrableCallbackUrl(connectorId)}</code>
              </span>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {scanning && manifest.auth.kind === "qr_scan" ? (
        <QrConnect connectorId={connectorId} note={manifest.auth.note} onDone={() => setScanning(false)} />
      ) : null}

      {pasting && manifest.auth.kind === "token" ? (
        <TokenConnect
          connectorId={connectorId}
          fields={manifest.auth.fields}
          note={manifest.auth.note}
          helpUrl={manifest.auth.helpUrl}
          onDone={() => setPasting(false)}
        />
      ) : null}

      {state.connections.length > 0 ? (
        <List>
          {state.connections.map((connection) => (
            <ConnectionRow key={connection.id} connection={connection} manifest={manifest} />
          ))}
        </List>
      ) : state.readiness.ready && !scanning && !pasting ? (
        <Empty>
          <span>No {connectionNoun(connectorId)} connected yet.</span>
          {/* The account a redirect signs in as is whichever one the browser
              already holds, so this is the moment to say which it should be. */}
          {manifest.auth.kind === "oauth_redirect" && manifest.auth.note ? (
            <span className="max-w-md text-xs">{manifest.auth.note}</span>
          ) : null}
        </Empty>
      ) : null}

      <div className="grid gap-6 sm:grid-cols-2">
        <CapabilityList
          title="Workflows"
          empty="None yet."
          items={manifest.workflows.map((workflow) => ({
            id: workflow.id,
            name: workflow.name,
            summary: workflow.summary,
          }))}
        />
        <CapabilityList
          title="Writes"
          empty="Nothing. This connector only reads."
          items={manifest.actions.map((action) => ({
            id: action.id,
            name: action.name,
            summary: action.summary,
          }))}
        />
      </div>
    </div>
  );
}

function CapabilityList({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: Array<{ id: string; name: string; summary: string }>;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id}>
              <p className="text-sm">{item.name}</p>
              <p className="text-xs text-muted-foreground">{item.summary}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ConnectionRow({
  connection,
  manifest,
}: {
  connection: ConnectionView;
  manifest: NonNullable<ReturnType<typeof connectorManifest>>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"verify" | "disconnect" | null>(null);
  // Connecting is offered once per connector, so a broken connection needs its
  // own way back to the provider.
  const broken = connection.status === "needs_reauth" || connection.status === "error";

  const run = async (action: "verify" | "disconnect") => {
    setBusy(action);
    try {
      if (action === "verify") {
        const updated = await verifyConnection({ data: { id: connection.id } });
        toast[updated.status === "connected" ? "success" : "error"](
          updated.status === "connected"
            ? `${updated.accountLabel} is reachable`
            : (updated.lastError ?? "This connection is not usable"),
        );
      } else {
        await disconnectConnection({ data: { id: connection.id } });
        toast.success(`Disconnected ${connection.accountLabel}`);
      }
      await router.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4 px-4 py-3">
      <div className="flex items-center gap-3">
        <Avatar className="size-8">
          <AvatarImage src={connection.avatarUrl ?? undefined} alt={connection.accountLabel} />
          <AvatarFallback>{connection.accountLabel.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{connection.accountLabel}</span>
            <ConnectionStatusBadge status={connection.status} />
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {[
              connection.lastSyncedAt ? `Checked ${ago(connection.lastSyncedAt)}` : "Not checked yet",
              connection.scopes.length > 0 ? connection.scopes.join(", ") : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {broken ? (
          <Button
            size="sm"
            nativeButton={false}
            render={<a href={`/api/connectors/${connection.connectorId}/authorize`} />}
          >
            <RotateCcw />
            Reconnect
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={() => run("verify")} disabled={busy !== null}>
          <RefreshCw className={busy === "verify" ? "animate-spin" : undefined} />
          Verify
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (window.confirm(`Disconnect ${connection.accountLabel}?`)) void run("disconnect");
          }}
          disabled={busy !== null}
        >
          Disconnect
        </Button>
      </div>

      {connection.lastError ? (
        <p className="text-xs text-destructive">{connection.lastError}</p>
      ) : null}

      <ConnectionSettingsForm fields={manifest.settings} connection={connection} />
    </div>
  );
}
