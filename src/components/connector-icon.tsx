import { Clock, Plug, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Each service's own mark, rather than something that resembles what it does.
 * An envelope stands for mail in general; the Gmail mark stands for the
 * account this connector is signed in to, which is what the icon is doing on
 * the page. Drawn as single monochrome paths so they take the accent's
 * foreground colour and sit at the same weight beside each other, which is
 * what a full-colour logo dropped in next to these would break.
 *
 * Paths are the vendors' own marks as published by Simple Icons (CC0).
 */
type Mark = (props: { className?: string }) => React.ReactElement;

function mark(viewBox: string, d: string): Mark {
  return function Mark({ className }) {
    return (
      <svg viewBox={viewBox} fill="currentColor" aria-hidden className={className}>
        <path d={d} />
      </svg>
    );
  };
}

const GithubMark = mark(
  "0 0 16 16",
  "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-2.65-.89-2.65-2.5 0-.77.27-1.4.72-1.9-.07-.18-.31-.9.07-1.87 0 0 .59-.19 1.93.72a6.5 6.5 0 0 1 1.76-.24c.6 0 1.2.08 1.76.24 1.34-.91 1.93-.72 1.93-.72.38.97.14 1.69.07 1.87.45.5.72 1.13.72 1.9 0 1.62-.88 2.3-2.66 2.5.28.24.52.71.52 1.44 0 1.03-.01 1.87-.01 2.13 0 .21.15.46.55.38A7.99 7.99 0 0 0 16 8c0-4.42-3.58-8-8-8Z",
);

const GmailMark = mark(
  "0 0 24 24",
  "M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-.904.732-1.636 1.636-1.636h.749L12 10.907l9.615-7.086h.749c.904 0 1.636.732 1.636 1.636Z",
);

const WechatMark = mark(
  "0 0 24 24",
  "M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 4.882-2.235 7.621-1.552-.983-3.29-4.269-5.653-8.163-5.653zm-2.877 3.63a1.09 1.09 0 0 1 1.089 1.089 1.09 1.09 0 0 1-1.089 1.09 1.09 1.09 0 0 1-1.089-1.09 1.09 1.09 0 0 1 1.09-1.089zm5.807 0a1.09 1.09 0 0 1 1.089 1.089 1.09 1.09 0 0 1-1.09 1.09 1.09 1.09 0 0 1-1.088-1.09 1.09 1.09 0 0 1 1.089-1.089zm5.463 3.573C13.008 9.39 9.9 12.06 9.9 15.354c0 1.874 1.017 3.582 2.67 4.834a.492.492 0 0 1 .177.554l-.324 1.235c-.016.058-.04.117-.04.177 0 .136.108.246.242.246a.271.271 0 0 0 .14-.045l1.586-.928a.72.72 0 0 1 .597-.082c.786.226 1.633.336 2.517.336 4 0 7.245-2.741 7.245-6.122 0-3.38-3.245-6.121-7.245-6.121zm-2.203 3.026a.908.908 0 0 1 .907.907.908.908 0 0 1-.907.908.908.908 0 0 1-.908-.908.908.908 0 0 1 .908-.907zm4.839 0a.908.908 0 0 1 .907.907.908.908 0 0 1-.907.908.908.908 0 0 1-.908-.908.908.908 0 0 1 .908-.907z",
);

/**
 * Manifests name their icon as a string so no connector ships a component into
 * the client bundle. Names resolve here, explicitly, to keep the bundle from
 * pulling in a whole icon set.
 */
const ICONS: Record<string, LucideIcon | Mark> = {
  Github: GithubMark,
  Gmail: GmailMark,
  Wechat: WechatMark,
  // Not a service's mark: a clock is the thing itself rather than a stand-in
  // for somewhere you have an account.
  Clock,
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
