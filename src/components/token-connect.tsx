import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TokenField } from "@/connectors/types.ts";
import { connectWithToken } from "@/server/functions/connectors.ts";

/**
 * A secret someone already has, pasted once.
 *
 * The token reaches this form and is sent to the server; it is never written
 * back. There is no consent screen and no account login.
 */
export function TokenConnect({
  connectorId,
  fields,
  note,
  helpUrl,
  onDone,
}: {
  connectorId: string;
  fields: TokenField[];
  note?: string;
  helpUrl?: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((field) => [field.key, ""])),
  );
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const result = await connectWithToken({ data: { connectorId, fields: values } });
      toast.success(`Connected ${result.accountLabel ?? connectorId}`);
      await router.invalidate();
      onDone?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 py-6">
        {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
        {helpUrl ? (
          <a
            href={helpUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Open the app dashboard
          </a>
        ) : null}
        {fields.map((field) => (
          <div key={field.key} className="flex flex-col gap-1.5">
            <Label htmlFor={`token-${field.key}`}>{field.label}</Label>
            <Input
              id={`token-${field.key}`}
              type={field.secret ? "password" : "text"}
              autoComplete="off"
              spellCheck={false}
              placeholder={field.placeholder}
              value={values[field.key] ?? ""}
              onChange={(event) =>
                setValues((prev) => ({ ...prev, [field.key]: event.target.value }))
              }
            />
          </div>
        ))}
        <div>
          <Button onClick={save} disabled={saving}>
            {saving ? "Connecting..." : "Connect"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
