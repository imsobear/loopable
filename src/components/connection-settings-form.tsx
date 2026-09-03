import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { SettingField } from "@/connectors/types.ts";
import type { ConnectionSettings, ConnectionView } from "@/lib/domain.ts";
import { saveConnectionSettings } from "@/server/functions/connectors.ts";

type Values = ConnectionSettings;

function initialValues(fields: SettingField[], stored: Values): Values {
  const values: Values = {};
  for (const field of fields) {
    const current = stored[field.key];
    switch (field.kind) {
      case "boolean":
        values[field.key] = typeof current === "boolean" ? current : field.default;
        break;
      case "string_list":
        values[field.key] = Array.isArray(current) ? current : [];
        break;
      case "select":
        values[field.key] = typeof current === "string" ? current : field.default;
        break;
      default:
        values[field.key] = typeof current === "string" ? current : "";
    }
  }
  return values;
}

/** Renders a connector's settings from its manifest, so no page knows the fields. */
export function ConnectionSettingsForm({
  fields,
  connection,
}: {
  fields: SettingField[];
  connection: ConnectionView;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Values>(() => initialValues(fields, connection.settings));
  const [saving, setSaving] = useState(false);

  if (fields.length === 0) return null;

  const set = (key: string, value: Values[string]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const save = async () => {
    setSaving(true);
    try {
      await saveConnectionSettings({ data: { id: connection.id, settings: values } });
      await router.invalidate();
      toast.success("Settings saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {fields.map((field) => (
        <div key={field.key} className="flex flex-col gap-2">
          {field.kind === "boolean" ? (
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor={field.key}>{field.label}</Label>
                {field.help ? (
                  <p className="mt-1 text-xs text-muted-foreground">{field.help}</p>
                ) : null}
              </div>
              <Switch
                id={field.key}
                checked={Boolean(values[field.key])}
                onCheckedChange={(checked) => set(field.key, checked)}
              />
            </div>
          ) : (
            <>
              <Label htmlFor={field.key}>{field.label}</Label>
              {field.help ? <p className="text-xs text-muted-foreground">{field.help}</p> : null}
              {field.kind === "string_list" ? (
                <Textarea
                  id={field.key}
                  rows={4}
                  placeholder={field.placeholder}
                  value={(values[field.key] as string[]).join("\n")}
                  onChange={(event) =>
                    set(
                      field.key,
                      event.target.value
                        .split("\n")
                        .map((line) => line.trim())
                        .filter(Boolean),
                    )
                  }
                />
              ) : field.kind === "select" ? (
                <Select
                  value={values[field.key] as string}
                  onValueChange={(value) => set(field.key, value)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {field.options.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id={field.key}
                  placeholder={field.placeholder}
                  value={values[field.key] as string}
                  onChange={(event) => set(field.key, event.target.value)}
                />
              )}
            </>
          )}
        </div>
      ))}
      <div>
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving..." : "Save settings"}
        </Button>
      </div>
    </div>
  );
}
