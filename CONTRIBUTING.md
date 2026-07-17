# Contributing

This is the handbook for developing this plugin. Product overview for end users lives in [README.md](README.md).

## Requirements

- Node.js 18+ and npm.
- Obsidian 1.11.4 or newer (`minAppVersion` in `manifest.json`).

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

By default, `npm run dev` and `npm run build` write `main.js` to the repository root.

To install into an Obsidian vault during development, set `LAVA_PLUGIN_DIR` in `.env` to that vault’s plugin folder (see `.env.example`). Then `dev` / `build` write `main.js` there, and `npm run copy` copies `manifest.json` and `styles.css` into the same directory.

```bash
npm run copy
npm run dev
```

`npm run dev` runs esbuild in watch mode. Reload Obsidian (or disable and re-enable the plugin) to pick up changes.

For a one-off production bundle (repo-root `main.js` unless `LAVA_PLUGIN_DIR` is set):

```bash
npm run build
```

`npm run copy` requires `LAVA_PLUGIN_DIR` (from `.env` or the environment). It only copies `manifest.json` and `styles.css`; `main.js` comes from `dev` or `build`.

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

## Release

- Release artifacts are `manifest.json`, `main.js`, and `styles.css`. Bump `version` in `manifest.json`, update `versions.json`, and create a GitHub release whose tag matches the version exactly (no `v` prefix).
- You can bump versions with `npm version patch`, `npm version minor`, or `npm version major` after updating `minAppVersion` in `manifest.json` when needed.

## Development notes

Obsidian API reference: https://docs.obsidian.md
