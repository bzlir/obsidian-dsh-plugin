# AGENTS.md

## Version numbering rules

- **Bug fix**: increment patch only (e.g. `0.2.0` → `0.2.1` → `0.2.2` → ... → `0.2.10` → `0.2.11`). Never carry over to minor.
- **Feature merge**: increment minor and reset patch (e.g. `0.2.x` → `0.3.0`).
- **Major**: reserved for breaking changes (e.g. `0.x → 1.0.0`).

## Build & lint

- `npm run build` — type-check + esbuild production bundle
- `npm run dev` — esbuild watch mode
- `bash scripts/install.sh` — build + install to vault with backup/rollback

## Plugin release

- Tag must match `manifest.json` version exactly (no `v` prefix)
- GitHub Actions workflow auto-builds and uploads release assets + attestations on tag push
- `main` branch = stable release; develop on feature branches and PR into `main`
