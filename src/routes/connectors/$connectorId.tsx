import { Link, createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, ExternalLink, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { ConnectionSettingsForm } from "@/components/connection-settings-form";
import { ConnectionStatusBadge } from "@/components/connection-status";
import { ConnectorIcon } from "@/components/connector-icon";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { connectorManifest } from "@/connectors/manifests.ts";
import { registrableCallbackUrl } from "@/lib/callback.ts";
import type { ConnectionView } from "@/lib/domain.ts";
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

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Link
        to="/connectors"
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Connectors
      </Link>

      <header className="flex items-start gap-4">
        <ConnectorIcon icon={manifest.icon} accent={manifest.accent} className="size-11" />
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{manifest.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{manifest.tagline}</p>
        </div>
        {state.readiness.ready && canAddAccount ? (
          <Button render={<a href={`/api/connectors/${connectorId}/authorize`} />}>
            {state.connections.length > 0 ? "Add another account" : "Connect"}
          </Button>
        ) : null}
      </header>

      {!state.readiness.ready ? (
        <Alert variant="destructive">
          <AlertTitle>{manifest.name} is not available in this build</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span>{state.readiness.reason}</span>
            {state.readiness.fixHint ? <span>{state.readiness.fixHint}</span> : null}
            {manifest.auth.kind === "oauth_redirect" ? (
              <span className="text-xs">
                Callback URL to register: <code>{registrableCallbackUrl(connectorId)}</code>
              </span>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {state.connections.length === 0 && state.readiness.ready ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No account connected yet.
            {manifest.auth.kind === "oauth_redirect" ? (
              <>
                {" "}
                Connecting opens {manifest.name} and asks for{" "}
                {manifest.auth.scopes.join(", ")}.
              </>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {state.connections.map((connection) => (
        <ConnectionCard key={connection.id} connection={connection} manifest={manifest} />
      ))}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What this connector can do</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <CapabilityList
            title="Signals it watches"
            items={manifest.events.map((event) => ({
              id: event.id,
              name: event.name,
              summary: event.summary,
            }))}
          />
          <Separator />
          <CapabilityList
            title="Actions it can propose"
            note="A rule can write these back on its own."
            items={manifest.actions.map((action) => ({
              id: action.id,
              name: action.name,
              summary: action.summary,
            }))}
          />
          {manifest.docsUrl ? (
            <a
              href={manifest.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              API documentation
              <ExternalLink className="size-3.5" />
            </a>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function CapabilityList({
  title,
  note,
  items,
}: {
  title: string;
  note?: string;
  items: Array<{ id: string; name: string; summary: string }>;
}) {
  return (
    <div>
      <h3 className="text-sm font-medium">{title}</h3>
      {note ? <p className="mt-0.5 text-xs text-muted-foreground">{note}</p> : null}
      <ul className="mt-3 flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.id} className="text-sm">
            <span className="font-medium">{item.name}</span>
            <span className="text-muted-foreground"> — {item.summary}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConnectionCard({
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
    <Card>
      <CardHeader className="flex flex-row items-center gap-3">
        <Avatar>
          <AvatarImage src={connection.avatarUrl ?? undefined} alt={connection.accountLabel} />
          <AvatarFallback>{connection.accountLabel.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{connection.accountLabel}</span>
            <ConnectionStatusBadge status={connection.status} />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {connection.lastSyncedAt
              ? `Last checked ${new Date(connection.lastSyncedAt).toLocaleString()}`
              : "Not checked yet"}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => run("verify")} disabled={busy !== null}>
          <RefreshCw className={busy === "verify" ? "animate-spin" : undefined} />
          Verify
        </Button>
        {broken ? (
          <Button
            size="sm"
            render={<a href={`/api/connectors/${connection.connectorId}/authorize`} />}
          >
            <RotateCcw />
            Reconnect
          </Button>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          onClick={() => run("disconnect")}
          disabled={busy !== null}
        >
          <Trash2 />
          Disconnect
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 border-t pt-5">
        {connection.lastError ? (
          <Alert variant="destructive">
            <AlertDescription>{connection.lastError}</AlertDescription>
          </Alert>
        ) : null}

        {connection.scopes.length > 0 ? (
          <div>
            <h3 className="text-sm font-medium">Granted access</h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {connection.scopes.map((scope) => (
                <Badge key={scope} variant="outline">
                  {scope}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}

        <ConnectionSettingsForm fields={manifest.settings} connection={connection} />
      </CardContent>
    </Card>
  );
}
