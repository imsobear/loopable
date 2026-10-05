import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { toast } from "sonner";
import { ChevronRight, CircleAlert } from "lucide-react";
import { ConnectionStatusBadge } from "@/components/connection-status";
import { ConnectorIcon } from "@/components/connector-icon";
import { List, PageHeader } from "@/components/page";
import { CONNECTOR_MANIFESTS, connectionNoun, needsAccount } from "@/connectors/manifests.ts";
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
      <PageHeader title="Connectors" description="The services loops watch and write to." />

      {/* A clock needs no account, so it has nothing to set up here. */}
      <List>
        {CONNECTOR_MANIFESTS.filter((manifest) => needsAccount(manifest.id)).map((manifest) => {
          const state = overview.find((entry) => entry.connectorId === manifest.id);
          const connections = state?.connections ?? [];
          const readiness = state?.readiness;
          const unavailable = readiness && !readiness.ready ? readiness : null;

          return (
            <Link
              key={manifest.id}
              to="/connectors/$connectorId"
              params={{ connectorId: manifest.id }}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
            >
              <ConnectorIcon icon={manifest.icon} accent={manifest.accent} className="size-8" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{manifest.name}</p>
                {unavailable ? (
                  <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                    <CircleAlert className="size-3 shrink-0" />
                    {unavailable.reason}
                  </p>
                ) : connections.length > 0 ? (
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {connections.map((connection) => (
                      <span key={connection.id} className="flex items-center gap-1.5">
                        {connection.accountLabel}
                        <ConnectionStatusBadge status={connection.status} />
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    No {connectionNoun(manifest.id)} yet
                  </p>
                )}
              </div>
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
          );
        })}
      </List>
    </div>
  );
}
