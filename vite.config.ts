import { defineConfig } from "vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

const hosted = process.env.LOOPABLE_CF === "1";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    ...(hosted
      ? [cloudflare({ viteEnvironment: { name: "ssr" } })]
      : [
          devtools(),
          nitro({
            rollupConfig: { external: [/^@sentry\//, "@libsql/client"] },
            traceDeps: [
              "!libsql",
              "!@libsql/client",
              "!@libsql/darwin-arm64",
              "!@libsql/darwin-x64",
              "!@libsql/linux-x64-gnu",
              "!@libsql/linux-arm64-gnu",
              "!@libsql/win32-x64-msvc",
              "!@neon-rs/load",
              "!detect-libc",
            ],
          }),
        ]),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
});
