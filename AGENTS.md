# AGENTS.md

Follow [CONTRIBUTING.md](CONTRIBUTING.md) for setup, build, lint, conventions, security, auth testing, and release. Do not skip those steps. Product context for end users is in [README.md](README.md).

This file adds **agent-only** rules. User instructions in the conversation override this file.

## Agent-only rules

- Prefer minimal diffs. Do not rewrite documentation or perform drive-by refactors unless asked.
- Never commit secrets, `.env`, `node_modules/`, or generated `main.js`.
- Never change the `id` field in `manifest.json` after the plugin is published.
- After code changes, run the validate commands documented in CONTRIBUTING (`npm run build`, `npm run lint`).
- Do not invent backend or monorepo paths that are not in this tree. The Lava API is an external service configured via `LAVA_API_BASE_URL`.
- Do not add hidden telemetry, remote code loading, or auto-update of plugin code outside normal releases.
- Read and write only what is necessary inside the vault when changing plugin behavior.
