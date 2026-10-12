import { LoopableMark } from "@/components/brand";
import { Button } from "@/components/ui/button";

/** Where `/api/auth/signin` should come back to, as a query string. */
export function signInHref(next?: string): string {
  return next ? `/api/auth/signin?next=${encodeURIComponent(next)}` : "/api/auth/signin";
}

/** Sign in with GitHub, the only way in. */
export function SignInPanel({ next, error }: { next?: string; error?: string }) {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
        <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <LoopableMark className="size-6" />
        </span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Sign in to Loopable</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Workflows for the coding agent you already have.
          </p>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button size="lg" className="w-full" nativeButton={false} render={<a href={signInHref(next)} />}>
          Sign in with GitHub
        </Button>
      </div>
    </main>
  );
}
