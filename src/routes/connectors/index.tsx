import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { toast } from "sonner";
import { ArrowRight, CircleAlert } from "lucide-react";
import { ConnectionStatusBadge } from "@/components/connection-status";
import { ConnectorIcon } from "@/components/connector-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CONNECTOR_MANIFESTS, needsAccount } from "@/connectors/manifests.ts";
import { getConnectorOverview } from "@/server/functions/connectors.ts";

export const Route = createFileRoute("/connectors/")({
  // Keys stay optional so linking to /connectors never has to pass search params.
  validateSearch: (search: Record<string, unknown>) => {
    const result: { connected?: string; error?: string } = {};
    if (typeof search.connected === "string") result.connected = search.connected;
    if (typeof search.error === "string") result.error = search.error;
    return result;
  },
  loader: () => getConnectorOverview(),
  component: ConnectorsPage,
});

function ConnectorsPage() {
  const overview = Route.useLoaderData();
  const { connected, error } = Route.useSearch();
  const navigate = Route.useNavigate();

  // The OAuth callback can only talk back through the URL, so it lands here.
  useEffect(() => {
    if (!connected && !error) return;
    if (connected) toast.success(`Connected as ${connected}`);
    if (error) toast.error(error);
    void navigate({ search: {}, replace: true });
  }, [connected, error, navigate]);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Connectors</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect the services a loop should watch. Credentials stay on this machine.
        </p>
      </header>

      <div className="flex flex-col gap-4">
        {/* A clock offers workflows but no account, and a card whose only
            button is "Set up" would lead nowhere. */}
        {CONNECTOR_MANIFESTS.filter((manifest) => needsAccount(manifest.id)).map((manifest) => {
          const state = overview.find((entry) => entry.connectorId === manifest.id);
          const connections = state?.connections ?? [];
          const readiness = state?.readiness;
          const unavailable = readiness && !readiness.ready ? readiness : null;

          return (
            <Card key={manifest.id}>
              <CardHeader className="flex flex-row items-start gap-4">
                <ConnectorIcon icon={manifest.icon} accent={manifest.accent} />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="font-medium">{manifest.name}</h2>
                    {connections.length > 0 ? (
                      <Badge variant="secondary">
                        {connections.length} account{connections.length > 1 ? "s" : ""}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{manifest.tagline}</p>
                </div>
                <Button variant="outline" render={<Link to="/connectors/$connectorId" params={{ connectorId: manifest.id }} />}>
                  {connections.length > 0 ? "Manage" : "Set up"}
                  <ArrowRight />
                </Button>
              </CardHeader>

              {(connections.length > 0 || unavailable) && (
                <CardContent className="flex flex-col gap-2 border-t pt-4">
                  {unavailable ? (
                    <p className="flex items-start gap-2 text-sm text-muted-foreground">
                      <CircleAlert className="mt-0.5 size-4 shrink-0" />
                      <span>{unavailable.reason}</span>
                    </p>
                  ) : null}
                  {connections.map((connection) => (
                    <div key={connection.id} className="flex items-center gap-3 text-sm">
                      <span className="font-medium">{connection.accountLabel}</span>
                      <ConnectionStatusBadge status={connection.status} />
                      {connection.lastError ? (
                        <span className="truncate text-muted-foreground">{connection.lastError}</span>
                      ) : null}
                    </div>
                  ))}
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
