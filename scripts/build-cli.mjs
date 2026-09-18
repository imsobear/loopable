import * as esbuild from "esbuild";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");

mkdirSync(join(root, "dist"), { recursive: true });

const hashImports = {
  name: "hash-imports",
  setup(build) {
    build.onResolve({ filter: /^#\// }, (args) => ({
      path: join(src, args.path.slice(2)),
    }));
  },
};

const shared = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  absWorkingDir: root,
  plugins: [hashImports],
  external: ["@libsql/client", "@libsql/client/*"],
  legalComments: "none",
  logLevel: "info",
};

await Promise.all([
  esbuild.build({
    ...shared,
    entryPoints: [join(root, "src/cli.ts")],
    outfile: join(root, "dist/cli.mjs"),
    banner: { js: "#!/usr/bin/env node" },
  }),
  esbuild.build({
    ...shared,
    entryPoints: [join(root, "src/dispatcher/main.ts")],
    outfile: join(root, "dist/dispatcher.mjs"),
  }),
  esbuild.build({
    ...shared,
    entryPoints: [join(root, "src/runner/main.ts")],
    outfile: join(root, "dist/runner.mjs"),
  }),
]);

chmodSync(join(root, "dist/cli.mjs"), 0o755);
