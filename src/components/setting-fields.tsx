import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { SettingField } from "@/connectors/types.ts";
import type { ConnectionSettings } from "@/lib/domain.ts";

/**
 * One renderer for anything a connector declares as a field, so connection
 * settings and rule conditions can never drift apart visually.
 */
export function initialFieldValues(
  fields: SettingField[],
  stored: ConnectionSettings,
): ConnectionSettings {
  const values: ConnectionSettings = {};
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

export function SettingFieldInputs({
  fields,
  values,
  onChange,
  idPrefix = "",
}: {
  fields: SettingField[];
  values: ConnectionSettings;
  onChange: (key: string, value: ConnectionSettings[string]) => void;
  idPrefix?: string;
}) {
  return (
    <>
      {fields.map((field) => {
        const id = `${idPrefix}${field.key}`;
        return (
          <div key={field.key} className="flex flex-col gap-2">
            {field.kind === "boolean" ? (
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor={id}>{field.label}</Label>
                  {field.help ? (
                    <p className="mt-1 text-xs text-muted-foreground">{field.help}</p>
                  ) : null}
                </div>
                <Switch
                  id={id}
                  checked={Boolean(values[field.key])}
                  onCheckedChange={(checked) => onChange(field.key, checked)}
                />
              </div>
            ) : (
              <>
                <Label htmlFor={id}>{field.label}</Label>
                {field.help ? <p className="text-xs text-muted-foreground">{field.help}</p> : null}
                {field.kind === "string_list" ? (
                  <Textarea
                    id={id}
                    rows={4}
                    placeholder={field.placeholder}
                    value={((values[field.key] as string[]) ?? []).join("\n")}
                    onChange={(event) =>
                      onChange(
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
                    onValueChange={(value) => onChange(field.key, value)}
                  >
                    <SelectTrigger id={id} className="w-full">
                      <SelectValue>
                        {(value: string) =>
                          field.options.find((option) => option.value === value)?.label ?? value
                        }
                      </SelectValue>
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
                    id={id}
                    placeholder={field.placeholder}
                    value={values[field.key] as string}
                    onChange={(event) => onChange(field.key, event.target.value)}
                  />
                )}
              </>
            )}
          </div>
        );
      })}
    </>
  );
}
