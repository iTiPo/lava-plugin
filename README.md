# Getlava

Getlava brings the ideas you have already captured into the conversation—so your vault becomes active material for better thinking. Chat with models, mention notes in conversations, and let the assistant read vault notes you explicitly include—without leaving your vault.

> 🔒 **Closed beta:** Getlava is currently in closed beta. To request access, leave your contact email on the [website](https://getlava.me).

## Features

- **Chat in your vault** — open a dedicated chat view from the ribbon or command palette.
- **Note mentions** — type `@` to mention notes; the assistant can read those notes when answering.
- **Read-only vault tools** — the assistant can read note content you point it at; it cannot create, edit, or delete notes.
- **Chat and Agent modes** — Chat keeps external tools unavailable; Agent can use configured MCP tools with per-tool access controls.
- **MCP servers** — connect Streamable HTTP MCP servers and decide which tools are blocked, require approval, or run automatically.
- **Chat history** — conversations are stored with the plugin data in your vault.

## Requirements

- Obsidian **1.11.4** or newer
- Desktop (Windows, macOS, or Linux)

## Getting started

1. Open Getlava from the ribbon (**Open chat**) or run the **Open chat** / **New chat** commands.
2. Sign in with your email when prompted (magic link).
3. Start a conversation. Mention notes with `@` when you want the assistant to use their content.
4. Use **New chat** to start a fresh thread.

## MCP and Agent mode

Every new conversation starts in **Chat** mode. In this mode, Lava can read notes you explicitly reference but cannot see or call MCP tools.

To use external tools:

1. Open **Settings → Getlava** and add a Streamable HTTP MCP server.
2. Add any HTTP headers the server needs (for example `Authorization`), then choose **Test and refresh** to discover tools.
3. Set each tool to **Blocked**, **Ask**, or **Auto-run**.
4. Switch the conversation to **Agent** mode.

When a tool is set to **Ask**, Lava shows its exact input before execution. You can deny it, allow it once, allow it for the current conversation, or always allow that reviewed tool definition. Newly discovered or changed tool definitions return to **Ask**.

The first MCP release supports Streamable HTTP with optional custom request headers. On desktop, MCP HTTP uses Node networking (not browser `fetch`) so remote servers are not blocked by CORS. OAuth, SSE, and stdio transports are not yet supported.

## Privacy and data

Getlava needs a network connection to the Getlava service for sign-in and chat.

- Chat messages and note content that you explicitly include in a conversation (for example via `@` mentions) are sent to the Getlava backend for inference.
- In Agent mode, MCP tool arguments are sent directly from the plugin to the configured MCP server. Tool results are returned to the model so it can continue the conversation.
- MCP HTTP header values are stored in plugin data with the server configuration. They are sent only to that MCP server and are not included in model prompts or chat history.
- The plugin does not silently upload your whole vault.
- See [Terms of Use](https://getlava.me/terms) and [Privacy Policy](https://getlava.me/confidential) for full details.

## Support

- Issues and feature requests: use this repository’s issue tracker.
- Contact: [getlava.me/contact](https://getlava.me/contact)

## License

See [LICENSE.md](LICENSE.md).

## Contributing

Want to build or change the plugin? See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, development, and release.
