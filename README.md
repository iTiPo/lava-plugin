# Lava

Lava is an AI assistant inside Obsidian. Chat with models, mention notes in conversations, and let the assistant read vault notes you explicitly include—so you can think and write without leaving your vault.

## Features

- **Chat in Obsidian** — open a dedicated chat view from the ribbon or command palette.
- **Note mentions** — type `@` to mention notes; the assistant can read those notes when answering.
- **Read-only vault tools** — the assistant can read note content you point it at; it cannot create, edit, or delete notes.
- **Chat history** — conversations are stored with the plugin data in your vault.

## Requirements

- Obsidian **1.11.4** or newer
- Desktop (Windows, macOS, or Linux)

## Getting started

1. Open Lava from the ribbon (**Open chat**) or run the **Open chat** / **New chat** commands.
2. Sign in with your email when prompted (magic link).
3. Start a conversation. Mention notes with `@` when you want the assistant to use their content.
4. Use **New chat** to start a fresh thread.

## Privacy and data

Lava needs a network connection to the Lava service for sign-in and chat.

- Chat messages and note content that you explicitly include in a conversation (for example via `@` mentions) are sent to the Lava backend for inference.
- The plugin does not silently upload your whole vault.
- See [Terms](https://getlava.me/terms) and [Privacy](https://getlava.me/confidential) for full details.

## Support

- Issues and feature requests: use this repository’s issue tracker.
- Website: [getlava.me](https://getlava.me)

## License

See [LICENSE.md](LICENSE.md).

## Contributing

Want to build or change the plugin? See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, development, and release. AI coding agents should also read [AGENTS.md](AGENTS.md).
