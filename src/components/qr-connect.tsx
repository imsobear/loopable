import { useEffect, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { CircleAlert, Loader } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { JsonValue } from "@/lib/domain.ts";
import { beginQrLogin, continueQrLogin } from "@/server/functions/connectors.ts";

const LOOK_EVERY_MS = 2000;

type Code = { image: string; attempt: JsonValue };

/**
 * A login that finishes on a phone.
 *
 * The waiting is the whole component: a code lasts about two minutes, so it
 * has to say plainly whether it is still good, and offer another the moment it
 * is not. A dead square with no explanation is the failure to avoid.
 */
export function QrConnect({
  connectorId,
  note,
  onDone,
}: {
  connectorId: string;
  note: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [code, setCode] = useState<Code | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [expired, setExpired] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** Polling reads this, so a code replaced mid-flight is not polled again. */
  const current = useRef<JsonValue>(null);

  const fetchCode = async () => {
    setLoading(true);
    setExpired(null);
    setHint(null);
    try {
      const started = await beginQrLogin({ data: { connectorId } });
      current.current = started.attempt;
      setCode({ image: started.image, attempt: started.attempt });
    } catch (error) {
      setExpired(error instanceof Error ? error.message : String(error));
      setCode(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchCode();
    // Asking again for the same connector would throw the pending code away.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectorId]);

  useEffect(() => {
    if (!code || expired) return;
    let stop = false;

    const look = async () => {
      while (!stop) {
        await new Promise((resolve) => setTimeout(resolve, LOOK_EVERY_MS));
        if (stop || current.current === null) return;
        try {
          const outcome = await continueQrLogin({
            data: { connectorId, attempt: current.current },
          });
          if (stop) return;
          if (outcome.state === "connected") {
            toast.success(`Connected ${outcome.accountLabel ?? connectorId}`);
            await router.invalidate();
            onDone?.();
            return;
          }
          if (outcome.state === "expired") {
            setExpired(outcome.reason ?? "The code expired before it was scanned.");
            return;
          }
          current.current = outcome.attempt;
          setHint(outcome.hint ?? null);
        } catch (error) {
          // One bad look is not a failed login; the next one usually works.
          if (stop) return;
          setHint(error instanceof Error ? error.message : String(error));
        }
      }
    };

    void look();
    return () => {
      stop = true;
    };
  }, [code, expired, connectorId, router, onDone]);

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-8">
        <p className="max-w-md text-center text-sm text-muted-foreground">{note}</p>

        {expired ? (
          <Alert variant="destructive" className="max-w-md">
            <CircleAlert />
            <AlertDescription>{expired}</AlertDescription>
          </Alert>
        ) : (
          <div className="flex size-[240px] items-center justify-center rounded-lg border bg-white">
            {loading || !code ? (
              <Loader className="size-5 animate-spin text-muted-foreground" />
            ) : (
              <img src={code.image} alt="Scan with WeChat to connect" className="size-[240px]" />
            )}
          </div>
        )}

        <p className="text-sm text-muted-foreground">
          {expired ? "Ask for another and scan it this time." : (hint ?? "Waiting for a scan...")}
        </p>

        <Button variant={expired ? "default" : "outline"} size="sm" onClick={fetchCode} disabled={loading}>
          {expired ? "New code" : "Start over"}
        </Button>
      </CardContent>
    </Card>
  );
}
