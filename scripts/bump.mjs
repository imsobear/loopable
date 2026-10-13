// Bumps loopable-cli's version on the current branch, as its own commit, for
// the pull request that releases it. Publishing is the Release workflow's,
// which runs by itself once that pull request is merged and deployed.
//
//   pnpm bump patch|minor|major|<x.y.z>
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const how = process.argv[2];

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function stop(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function next(current) {
  if (/^\d+\.\d+\.\d+$/.test(how ?? "")) return how;
  const [major, minor, patch] = current.split(".").map(Number);
  if (how === "major") return `${major + 1}.0.0`;
  if (how === "minor") return `${major}.${minor + 1}.0`;
  if (how === "patch") return `${major}.${minor}.${patch + 1}`;
  stop("Say how to bump: pnpm bump patch|minor|major|<x.y.z>");
}

if (git("rev-parse", "--abbrev-ref", "HEAD") === "main") stop("Bump on a branch; main takes changes by pull request.");
if (git("status", "--porcelain", "--untracked-files=no") !== "") stop("Commit or stash your changes first.");

const path = join(root, "package.json");
const pkg = JSON.parse(readFileSync(path, "utf8"));
const version = next(pkg.version);
pkg.version = version;
writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
git("commit", "--quiet", "-m", `Bump loopable-cli to v${version}.`, "--", "package.json");
console.log(`✓ v${version}, committed. Merge the pull request; it is published once it is deployed.`);
