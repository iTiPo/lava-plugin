# Contributing

This is the handbook for developing this plugin. Product overview for end users lives in [README.md](README.md).

## Requirements

- Node.js 18+ and npm.
- Obsidian 1.11.4 or newer (`minAppVersion` in `manifest.json`).
- For the Dev Container workflow: a bind-mounted vault at `/vault` (see `.devcontainer/devcontainer.json` when present).

## Setup

From the repository root, install dependencies:

```bash
npm ci
```

Copy `.env.example` to `.env` and fill in the values it defines:

```bash
cp .env.example .env
```

## Develop

```bash
npm run dev
```

`npm run dev` runs esbuild in watch mode. In the Dev Container, rebuilds write directly to `/vault/.obsidian/plugins/lava-plugin/main.js`. Reload Obsidian (or disable and re-enable the plugin) to pick up changes.

For a one-off production bundle:

```bash
npm run build
```

When you are ready to test the build in Obsidian, copy the required plugin files into the vault plugin directory:

```bash
npm run copy
```

In the Dev Container this targets `/vault/.obsidian/plugins/lava-plugin/`.

### Manual install

Copy `main.js`, `manifest.json`, and `styles.css` into your vault at:

```
<Vault>/.obsidian/plugins/lava-plugin/
```

Then reload Obsidian and enable **Lava** under **Settings → Community plugins**.

## Validate

Run the following commands to check that everything builds and the linter passes:

```bash
npm run build
npm run lint
```

## Development guidelines

Obsidian plugin conventions, security, UX, performance, and troubleshooting live in [docs/obsidian-plugin-guidelines.md](docs/obsidian-plugin-guidelines.md).

## Release

- Release artifacts are `manifest.json`, `main.js`, and `styles.css`. Bump `version` in `manifest.json`, update `versions.json`, and create a GitHub release whose tag matches the version exactly (no `v` prefix).
- You can bump versions with `npm version patch`, `npm version minor`, or `npm version major` after updating `minAppVersion` in `manifest.json` when needed.
