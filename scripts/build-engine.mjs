import * as esbuild from "esbuild";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

/**
 * The desktop engine: src/desktop/engine.ts and everything it reaches, as
 * one file under desktop/resources/engine, beside the migrations and the one
 * dependency that cannot be bundled, libsql's native module, installed flat
 * with npm so the app ships no symlinks.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");
const out = join(root, "desktop", "resources", "engine");
const pkg = JSON.parse(execSync("cat package.json", { cwd: root, encoding: "utf8" }));

const aliases = {
  name: "aliases",
  setup(build) {
    build.onResolve({ filter: /^[#@]\// }, (args) => ({
      path: join(src, args.path.slice(2)),
    }));
  },
};

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await esbuild.build({
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  absWorkingDir: root,
  plugins: [aliases],
  external: ["@libsql/client", "@libsql/client/*"],
  legalComments: "none",
  logLevel: "info",
  entryPoints: [join(root, "src/desktop/engine.ts")],
  outfile: join(out, "engine.mjs"),
  // The bundle is ESM; some dependencies still ask for require().
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
});

cpSync(join(root, "drizzle"), join(out, "drizzle"), { recursive: true });

writeFileSync(
  join(out, "package.json"),
  JSON.stringify(
    {
      name: "loopable-engine",
      private: true,
      version: pkg.version,
      type: "module",
      dependencies: { "@libsql/client": pkg.dependencies["@libsql/client"] },
    },
    null,
    2,
  ),
);
execSync("npm install --omit=dev --no-audit --no-fund --loglevel=error", { cwd: out, stdio: "inherit" });
console.log(`engine built in ${out}`);
