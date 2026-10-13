# Release

How a change gets from a branch to loop.goodone.si and to npm. The workflows are in `.github/workflows/`.

```text
branch → pull request → CI → merge to main → CI → Deploy (migrate, then deploy)
                                             → Release (by hand, CLI only, after pnpm bump in a pull request)
```

## Changing code

1. Work on a branch. One feature per pull request, one feature per commit.
2. Open a pull request. **CI** runs typecheck, tests and the build.
3. Merge with **squash** once CI passes. `main` takes no direct pushes and no merges with a failing CI.

## Deploying the service

Merging deploys. When CI passes on `main`, **Deploy** runs for that exact commit:

1. Applies database migrations to the production database.
2. Deploys the App Worker and the dispatcher container.
3. Checks that `https://loop.goodone.si` answers.

The GitHub **production** environment lists every deploy and its commit, so what is live is always one click away.

**Migrations run before the new code is live**, and so must also suit the code that is live until then:

- Add a column, table or index in one release. Make it nullable or give it a default.
- Stop reading an old column in that release; drop it in a later one.
- Never rename in place. Add the new one, copy, switch, and drop the old one later.

## Releasing the CLI

Release a new CLI when the runner or the `loopable` command changed. A service-only change needs no release.

1. On a branch, `pnpm bump minor` (or `patch`, `major`, an exact version). It commits the new version.
2. Merge that pull request, and wait for its deploy to finish.
3. Run **Release** from the Actions tab. It refuses unless `main` is the commit that is deployed, so the service always knows about a new runner before any runner is out. It checks, builds, publishes the version in `package.json` to npm through trusted publishing, tags `vX.Y.Z`, and writes the release notes. It never pushes to `main`.

Runners on 0.7.0 or later can then be updated from the Runners page.

## Rolling back

- **The service:** run **Deploy** by hand with `ref` set to the last good commit or tag. Migrations are not undone, which is why they only ever add.
- **Faster, for the App Worker alone:** `npx wrangler rollback` from a checkout signed in to Cloudflare.
- **The CLI:** publish a fixed version. Never unpublish: runners may already have it.

## Secrets

| Where | Name | For |
| --- | --- | --- |
| Repository | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Deploying to Cloudflare |
| Environment **production** | `LOOPABLE_DATABASE_URL`, `LOOPABLE_DATABASE_AUTH_TOKEN` | Migrating before a deploy |
| The Worker (`scripts/hosting-secrets.sh`) | Database, master key, OAuth apps | The running service |
| npm | none | Trusted publishing from `release.yml` |
