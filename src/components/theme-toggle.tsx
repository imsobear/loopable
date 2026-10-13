import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NEXT = { system: "light", light: "dark", dark: "system" } as const;
const LABEL = { system: "Theme: system", light: "Theme: light", dark: "Theme: dark" } as const;
type Choice = keyof typeof NEXT;

/** One button that goes round system, light and dark. */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  // The choice is only known in the browser; until then draw the default, so
  // the server's page and the first render agree.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const choice: Choice = mounted && theme && theme in NEXT ? (theme as Choice) : "system";
  const Icon = choice === "light" ? Sun : choice === "dark" ? Moon : Monitor;

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("text-muted-foreground", className)}
      aria-label={LABEL[choice]}
      title={LABEL[choice]}
      onClick={() => setTheme(NEXT[choice])}
    >
      <Icon />
    </Button>
  );
}
