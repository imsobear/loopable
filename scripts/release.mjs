// Publish loopable-cli to npm from a clean, pushed main, so every version on
// npm is one tagged commit on GitHub.
//
//   pnpm release patch|minor|major|<x.y.z>
//   pnpm release minor --dry-run    checks everything, changes nothing
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const bump = args.find((arg) => !arg.startsWith("--"));

const problems = [];

function say(line) {
  console.log(line);
}

function stop(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

/** A check that stops a real release, and is only reported in a dry run. */
function check(ok, message) {
  if (ok) return;
  if (dryRun) {
    problems.push(message);
    say(`  ! ${message}`);
  } else {
    stop(message);
  }
}

function git(...rest) {
  return execFileSync("git", rest, { cwd: root, encoding: "utf8" }).trim();
}

function run(command, rest) {
  say(`\n$ ${command} ${rest.join(" ")}`);
  const result = spawnSync(command, rest, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) stop(`${command} ${rest.join(" ")} failed.`);
}

function next(current, how) {
  if (/^\d+\.\d+\.\d+$/.test(how)) return how;
  const [major, minor, patch] = current.split(".").map(Number);
  if (how === "major") return `${major + 1}.0.0`;
  if (how === "minor") return `${major}.${minor + 1}.0`;
  if (how === "patch") return `${major}.${minor}.${patch + 1}`;
  stop("Say how to bump: pnpm release patch|minor|major|<x.y.z> [--dry-run]");
}

function newer(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i];
  return false;
}

const pkgPath = join(root, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const version = next(pkg.version, bump);
const tag = `v${version}`;

say(`${pkg.name} ${pkg.version} → ${version}${dryRun ? "  (dry run)" : ""}\n`);
check(newer(version, pkg.version), `${version} is not newer than ${pkg.version}.`);

say("Checking git");
check(git("rev-parse", "--abbrev-ref", "HEAD") === "main", "Release from main.");
check(
  git("status", "--porcelain", "--untracked-files=no") === "",
  "There are uncommitted changes. Commit or stash them first.",
);
git("fetch", "--quiet", "origin", "main", "--tags");
check(
  git("rev-parse", "HEAD") === git("rev-parse", "origin/main"),
  "main is not the same as origin/main. Merge and push first, so the release is what GitHub has.",
);
check(git("tag", "--list", tag) === "", `The tag ${tag} already exists.`);

say("Checking npm");
let published = [];
try {
  published = JSON.parse(execFileSync("npm", ["view", pkg.name, "versions", "--json"], { encoding: "utf8" }));
} catch {
  // Not published yet, or offline; npm publish will say which.
}
check(!published.includes(version), `${pkg.name}@${version} is already on npm.`);
try {
  say(`  signed in to npm as ${execFileSync("npm", ["whoami"], { encoding: "utf8" }).trim()}`);
} catch {
  check(false, "Not signed in to npm. Run npm login.");
}

run("pnpm", ["typecheck"]);
run("pnpm", ["test"]);
run("pnpm", ["build"]);

if (dryRun) {
  // What would be uploaded. Not npm publish --dry-run: that still asks the
  // registry about the old version number, which is already there.
  run("npm", ["pack", "--dry-run", "--ignore-scripts"]);
  say(
    problems.length === 0
      ? `\n✓ Ready to release ${tag}. Run without --dry-run.`
      : `\n✗ ${problems.length} thing${problems.length === 1 ? "" : "s"} would stop a real release (marked ! above).`,
  );
  process.exit(problems.length === 0 ? 0 : 1);
}

pkg.version = version;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
git("commit", "--quiet", "-m", `Release ${tag}.`, "--", "package.json");
git("tag", "-a", tag, "-m", `Release ${tag}.`);
say(`\nCommitted and tagged ${tag}.`);

// The checks above already ran, so publish skips prepublishOnly.
run("npm", ["publish", "--ignore-scripts"]);

const pushed = spawnSync("git", ["push", "--quiet", "--atomic", "origin", "main", tag], {
  cwd: root,
  stdio: "inherit",
});
if (pushed.status !== 0) {
  stop(`Published ${tag} to npm, but could not push. Run: git push --atomic origin main ${tag}`);
}

say(`\n✓ Released ${tag}.`);
say("  Next:");
say(`  - Release notes: gh release create ${tag} --generate-notes`);
say("  - Site, if it changed: pnpm site:deploy");
say("  - Upgrade every runner too: npm install -g loopable-cli");
