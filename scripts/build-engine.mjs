import * as esbuild from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

/**
 * Loopable's own GitHub and Google apps, built into the app so nobody using
 * it registers one. Public clients: GitHub needs only an ID (device flow),
 * and Google does not treat a desktop client's secret as one. Taken from the
 * environment when releasing, or from the desktop entry of the gitignored
 * config/oauth-app.json when developing; nothing here lives in git.
 */
function desktopApps() {
  let config = {};
  try {
    config = JSON.parse(readFileSync(join(root, "config", "oauth-app.json"), "utf8")).desktop ?? {};
  } catch {}
  const env = process.env;
  return {
    github: { clientId: env.LOOPABLE_DESKTOP_GITHUB_CLIENT_ID ?? config.github?.clientId ?? "" },
    gmail: {
      clientId: env.LOOPABLE_DESKTOP_GMAIL_CLIENT_ID ?? config.gmail?.clientId ?? "",
      clientSecret: env.LOOPABLE_DESKTOP_GMAIL_CLIENT_SECRET ?? config.gmail?.clientSecret ?? "",
    },
  };
}
const apps = desktopApps();
writeFileSync(join(out, "oauth-apps.json"), JSON.stringify(apps, null, 2));
const missing = [
  apps.github.clientId ? null : "GitHub",
  apps.gmail.clientId && apps.gmail.clientSecret ? null : "Gmail",
].filter(Boolean);
if (missing.length) {
  console.warn(`no ${missing.join(" or ")} app built in: those connectors will say they are not set up (docs/desktop.md)`);
}

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
