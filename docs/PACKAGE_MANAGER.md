# Package Manager: pnpm

This monorepo uses **pnpm** (>= 9). Not npm. Not yarn.

## Why

- pnpm's content-addressable store gives us deterministic, fast installs
  across many small workspace packages without duplicating `node_modules`.
- Every v3.1 package is wired up via `pnpm-workspace.yaml`, not via a
  `workspaces` array in `package.json`. This avoids the npm/yarn quirk
  of having to keep the array in sync with the filesystem.
- All scripts in the root `package.json` use `pnpm --filter` selectors
  rather than `npm -w` workspace flags.

## Install

```bash
# one-time, if pnpm isn't on your machine yet:
npm install -g pnpm@9

# from the repo root:
pnpm install
```

This installs every workspace package's deps in one pass, with hardlinked
shared dependencies. Subsequent installs are near-instant.

## Common commands

| Goal                                                | Command                                        |
| --------------------------------------------------- | ---------------------------------------------- |
| Install everything                                  | `pnpm install`                                 |
| Build everything                                    | `pnpm run build`                               |
| Build a single package                              | `pnpm --filter @extropy/<name> run build`      |
| Add a dep to a single package                       | `pnpm --filter @extropy/<name> add <dep>`      |
| Add a dev dep to the root                           | `pnpm add -Dw <dep>`                           |
| Run all `dev` scripts in parallel                   | `pnpm -r --if-present --parallel run dev`      |
| Start the VPS-role handshake server                 | `pnpm run node-handshake:vps`                  |
| Send a signed `/hello` from a local node            | `PEER_URL=... pnpm run node-handshake:hello`   |
| Run replay round-trip                               | `PEER_URL=... pnpm run node-handshake:replay`  |

## Migration notes (May 2026)

Prior to commit `cd70d06`-ish the repo carried both an `npm` workspaces
array and an empty `pnpm-lock.yaml`, which caused install warnings when
running `npm install --workspace=@extropy/<name>` on packages that had
been added in the v3.1 wave (identity, psll-sync, quest-market,
validation-neighborhoods, node-handshake) but were not yet listed in the
root array.

The fix: drop the npm workspaces array entirely, treat
`pnpm-workspace.yaml` as the single source of truth, and let pnpm
discover every directory under `packages/*` and `frontends/*`
automatically.

If you have an old `node_modules/` from npm-era installs, blow it away
before the first pnpm install:

```bash
rm -rf node_modules packages/*/node_modules frontends/*/node_modules
pnpm install
```

## Why not corepack?

We pin the pnpm major in `package.json` `packageManager` field. If you
have corepack enabled (`corepack enable`), it'll fetch the exact pinned
version automatically. Otherwise the `engines` field will at least warn
about mismatched pnpm major versions.
