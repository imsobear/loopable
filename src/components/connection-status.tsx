import { cn } from "@/lib/utils";
import type { ConnectionStatus } from "@/lib/domain.ts";

const LABELS: Record<ConnectionStatus, { text: string; dot: string }> = {
  connected: { text: "Connected", dot: "bg-emerald-500" },
  needs_reauth: { text: "Needs reconnecting", dot: "bg-destructive" },
  error: { text: "Error", dot: "bg-destructive" },
  paused: { text: "Paused", dot: "bg-muted-foreground" },
};

/** A dot and a word: quiet when all is well, red when it is not. */
export function ConnectionStatusBadge({ status }: { status: ConnectionStatus }) {
  const label = LABELS[status] ?? LABELS.error;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs",
        status === "connected" || status === "paused" ? "text-muted-foreground" : "text-destructive",
      )}
    >
      <span className={cn("size-1.5 rounded-full", label.dot)} />
      {label.text}
    </span>
  );
}
