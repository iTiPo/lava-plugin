# Obsidian plugin development guidelines

Guidelines for working on this Obsidian plugin.

## Project structure

- Entry point: `src/main.ts` compiles to `main.js` and is loaded by Obsidian.
- Keep `main.ts` small and focused on plugin lifecycle (loading, unloading, registering commands). Delegate feature logic to modules under `src/`.
- Organize code across multiple files. Layout:

  ```
  src/
    main.ts           # Plugin entry point, lifecycle management
    config.ts         # Build-time config (API base URL, etc.)
    ai/               # Model providers, agents, tools
    auth/             # Supabase auth store and client
    chat/             # Session storage and persistence
    notes/            # @mention parsing and suggest
    ui/               # Views and Svelte components
  ```

- Bundle everything into `main.js` with esbuild. Do not commit `node_modules/`, `main.js`, or other generated files.
- Prefer browser-compatible packages. Avoid large dependencies.
- Use TypeScript with `"strict": true`. Prefer `async/await` over promise chains.

## Manifest (`manifest.json`)

Required fields include `id`, `name`, `version` (SemVer), `minAppVersion`, `description`, and `isDesktopOnly`. Optional: `author`, `authorUrl`, `fundingUrl`.

- Never change `id` after release. Treat it as stable API.
- Keep `minAppVersion` accurate when using newer Obsidian APIs.
- Canonical release requirements: https://github.com/obsidianmd/obsidian-releases/blob/master/.github/workflows/validate-plugin-entry.yml

## Commands, settings, and listeners

- Add user-facing commands with `this.addCommand(...)`. Use stable command IDs; do not rename them after release.
- If the plugin has configuration, provide a settings tab and sensible defaults.
- Persist settings with `this.loadData()` / `this.saveData()`.
- Register and clean up listeners with `register*` helpers so reload/unload does not leak:

  ```ts
  this.registerEvent(
    this.app.workspace.on('file-open', (f) => {
      /* ... */
    }),
  );
  this.registerDomEvent(activeWindow, 'resize', () => {
    /* ... */
  });
  this.registerInterval(
    window.setInterval(() => {
      /* ... */
    }, 1000),
  );
  ```

## Security and privacy

Follow Obsidian [developer policies](https://docs.obsidian.md/Developer+policies) and [plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines).

- Default to local/offline operation. Only make network requests when essential to the feature.
- No hidden telemetry. Disclose external services, data sent, and risks in settings and documentation.
- Chat messages and note content explicitly included in a conversation are sent to the Lava backend for inference. The backend exposes the model as `lava-chat` and requires OpenRouter endpoints with Zero Data Retention, no provider data collection, and FP8 inference; requests are still processed transiently by those services.
- Never execute remote code, fetch and eval scripts, or auto-update plugin code outside normal releases.
- Read and write only what is necessary inside the vault. Do not access files outside the vault.
- Do not collect vault contents, filenames, or personal information unless essential and explicitly consented.

## UX copy

- Prefer sentence case for headings, buttons, and titles.
- Use clear, action-oriented imperatives in step-by-step copy.
- Use **bold** for literal UI labels. Prefer "select" for interactions.
- Use arrow notation for navigation: **Settings → Community plugins**.
- Keep in-app strings short, consistent, and free of jargon.

## Performance

- Keep startup light. Defer heavy work until needed.
- Avoid long-running tasks during `onload`; use lazy initialization.
- Batch disk access and avoid excessive vault scans.
- Debounce or throttle expensive operations in response to file system events.

## Mobile

- `isDesktopOnly` is `true` for this plugin because it uses desktop-oriented AI and UI APIs.
- Where feasible on other plugins, test on iOS and Android. Avoid Node/Electron APIs if mobile compatibility is required.

## Troubleshooting

- Plugin does not load after build: ensure `main.js` and `manifest.json` are at the top level of `<Vault>/.obsidian/plugins/lava-plugin/`.
- Build issues: if `main.js` is missing, run `npm run build` or `npm run dev`.
- Commands not appearing: verify `addCommand` runs during `onload` and IDs are unique.
- Settings not persisting: ensure `loadData` / `saveData` are awaited and the settings UI re-renders after changes.
