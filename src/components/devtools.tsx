import { TanStackDevtools } from "@tanstack/react-devtools";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";

/** Only loaded by `pnpm dev`; a production build leaves it out entirely. */
export default function Devtools() {
  return (
    <TanStackDevtools
      config={{ position: "bottom-right" }}
      plugins={[{ name: "Tanstack Router", render: <TanStackRouterDevtoolsPanel /> }]}
    />
  );
}
