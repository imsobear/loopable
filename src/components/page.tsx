import { Link, type LinkProps } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * The top of every page: where it sits, what it is called, and what can be
 * done from here. One shape everywhere, so pages differ in what they show
 * rather than in how far the title is from the edge.
 */
export function PageHeader({
  title,
  description,
  back,
  icon,
  actions,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  back?: { label: string } & Pick<LinkProps, "to" | "params" | "search">;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  /** Extra lines under the title, such as a status. */
  children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3">
      {back ? (
        <Link
          to={back.to}
          params={back.params}
          search={back.search}
          className="-ml-1 flex w-fit items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start gap-3">
        {icon}
        <div className="min-w-0 flex-1 basis-56">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          ) : null}
          {children}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

/** A labelled control, with at most one short line of help under it. */
export function Field({
  label,
  htmlFor,
  hint,
  className,
  children,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * One titled block of a form or a detail page. Title on the left and fields
 * on the right on a wide screen, stacked on a narrow one.
 */
export function Section({
  title,
  description,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "grid gap-4 border-t py-6 first:border-t-0 first:pt-0 md:grid-cols-[11rem_1fr] md:gap-8",
        className,
      )}
    >
      <div>
        <h2 className="text-sm font-medium">{title}</h2>
        {description ? (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </section>
  );
}

/** A list of rows inside one bordered box, rather than a stack of cards. */
export function List({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("divide-y overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10", className)}>
      {children}
    </div>
  );
}

/** What a list says when it has nothing in it. */
export function Empty({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
      {children}
      {action}
    </div>
  );
}

/** Tabs that are links, so a tab can be bookmarked and shared. */
export function LinkTabs({
  items,
}: {
  items: Array<{ label: React.ReactNode; active: boolean } & Pick<LinkProps, "to" | "params" | "search">>;
}) {
  return (
    <nav className="flex gap-4 border-b">
      {items.map((item, index) => (
        <Link
          key={index}
          to={item.to}
          params={item.params}
          search={item.search}
          replace
          className={cn(
            "-mb-px flex items-center gap-1.5 border-b-2 pb-2 text-sm transition-colors",
            item.active
              ? "border-foreground font-medium text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
