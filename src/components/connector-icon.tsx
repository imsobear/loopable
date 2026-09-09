import { Mail, MessageCircle, Plug, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-2.65-.89-2.65-2.5 0-.77.27-1.4.72-1.9-.07-.18-.31-.9.07-1.87 0 0 .59-.19 1.93.72a6.5 6.5 0 0 1 1.76-.24c.6 0 1.2.08 1.76.24 1.34-.91 1.93-.72 1.93-.72.38.97.14 1.69.07 1.87.45.5.72 1.13.72 1.9 0 1.62-.88 2.3-2.66 2.5.28.24.52.71.52 1.44 0 1.03-.01 1.87-.01 2.13 0 .21.15.46.55.38A7.99 7.99 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

/**
 * Manifests name their icon as a string so no connector ships a component into
 * the client bundle. Names resolve here, explicitly, to keep the bundle from
 * pulling in a whole icon set.
 */
const ICONS: Record<string, LucideIcon | typeof GithubMark> = {
  Github: GithubMark,
  Mail,
  MessageCircle,
  Plug,
};

export function ConnectorIcon({
  icon,
  accent,
  className,
}: {
  icon: string;
  accent: string;
  className?: string;
}) {
  const Icon = ICONS[icon] ?? Plug;
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-lg",
        accent,
        className,
      )}
    >
      <Icon className="size-5" />
    </span>
  );
}
