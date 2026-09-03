import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { SettingFieldInputs, initialFieldValues } from "@/components/setting-fields";
import { Button } from "@/components/ui/button";
import type { SettingField } from "@/connectors/types.ts";
import type { ConnectionSettings, ConnectionView } from "@/lib/domain.ts";
import { saveConnectionSettings } from "@/server/functions/connectors.ts";

/** Renders a connector's settings from its manifest, so no page knows the fields. */
export function ConnectionSettingsForm({
  fields,
  connection,
}: {
  fields: SettingField[];
  connection: ConnectionView;
}) {
  const router = useRouter();
  const [values, setValues] = useState<ConnectionSettings>(() =>
    initialFieldValues(fields, connection.settings),
  );
  const [saving, setSaving] = useState(false);

  if (fields.length === 0) return null;

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
      <SettingFieldInputs
        fields={fields}
        values={values}
        onChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))}
      />
      <div>
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving..." : "Save settings"}
        </Button>
      </div>
    </div>
  );
}
