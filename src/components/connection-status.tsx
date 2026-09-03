import { Badge } from "@/components/ui/badge";
import type { ConnectionStatus } from "@/lib/domain.ts";

const LABELS: Record<
  ConnectionStatus,
  { text: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  connected: { text: "Connected", variant: "default" },
  needs_reauth: { text: "Needs reconnecting", variant: "destructive" },
  error: { text: "Error", variant: "destructive" },
  paused: { text: "Paused", variant: "secondary" },
};

export function ConnectionStatusBadge({ status }: { status: ConnectionStatus }) {
  const label = LABELS[status] ?? LABELS.error;
  return <Badge variant={label.variant}>{label.text}</Badge>;
}
