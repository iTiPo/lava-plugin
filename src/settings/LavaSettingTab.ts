import { PluginSettingTab, Setting } from 'obsidian';
import type LavaPlugin from '../main';
import type { McpServerConfig } from '../mcp/types';
import { McpServerModal, hostLabel, statusLabel } from './McpServerModal';

export class LavaSettingTab extends PluginSettingTab {
	constructor(private readonly lavaPlugin: LavaPlugin) {
		super(lavaPlugin.app, lavaPlugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('MCP servers')
			.setDesc(
				'Connect Streamable HTTP servers. Tools are available only in Agent mode. OAuth, SSE, and stdio are not supported yet.',
			)
			.setHeading();

		const servers = this.lavaPlugin.mcpSettings.listServers();
		const listEl = containerEl.createDiv({ cls: 'lava-mcp-server-list' });

		if (servers.length === 0) {
			const empty = listEl.createDiv({ cls: 'lava-mcp-empty' });
			empty.createEl('p', {
				text: 'No MCP servers yet. Add a server, then configure its URL, headers, and tools.',
				cls: 'setting-item-description',
			});
		} else {
			for (const server of servers) this.renderServerRow(listEl, server);
		}

		new Setting(containerEl)
			.setName('Add server')
			.setDesc('Opens the server configuration dialog.')
			.addButton((button) => {
				button.setButtonText('Add MCP server').setCta().onClick(async () => {
					const server = await this.lavaPlugin.mcpSettings.addServer();
					this.display();
					this.openServerModal(server.id, { expandHeaders: true });
				});
			});
	}

	private renderServerRow(listEl: HTMLElement, server: McpServerConfig): void {
		const row = listEl.createDiv({ cls: 'lava-mcp-server-row' });
		if (!server.enabled) row.addClass('lava-mcp-server-row--disabled');

		const identity = row.createDiv({ cls: 'lava-mcp-server-row__identity' });
		identity.createDiv({
			text: server.name.trim() || 'MCP server',
			cls: 'lava-mcp-server-row__title',
		});

		const meta = identity.createDiv({ cls: 'lava-mcp-server-row__meta' });
		const status = this.lavaPlugin.mcpConnections.getStatus(server.id);
		meta.createSpan({
			cls: `lava-mcp-status lava-mcp-status--${status}`,
			text: statusLabel(status),
		});

		const summaryParts = [hostLabel(server.url)];
		if (server.tools.length > 0) {
			summaryParts.push(
				`${server.tools.length} tool${server.tools.length === 1 ? '' : 's'}`,
			);
		}
		if (server.headers.length > 0) {
			summaryParts.push(
				`${server.headers.length} header${server.headers.length === 1 ? '' : 's'}`,
			);
		}
		meta.createSpan({
			cls: 'lava-mcp-server-row__summary',
			text: summaryParts.filter(Boolean).join(' · '),
		});

		const actions = row.createDiv({ cls: 'lava-mcp-server-row__actions' });
		new Setting(actions)
			.setClass('lava-mcp-server-row__controls')
			.addExtraButton((button) => {
				button
					.setIcon('pencil')
					.setTooltip('Configure server')
					.onClick(() => {
						this.openServerModal(server.id);
					});
			})
			.addExtraButton((button) => {
				button
					.setIcon('trash')
					.setTooltip('Remove server')
					.onClick(async () => {
						await this.lavaPlugin.mcpConnections.disconnect(server.id);
						await this.lavaPlugin.mcpSettings.removeServer(server.id);
						this.display();
					});
			})
			.addToggle((toggle) => {
				toggle.setTooltip(server.enabled ? 'Enabled' : 'Disabled');
				toggle.setValue(server.enabled).onChange(async (enabled) => {
					await this.lavaPlugin.mcpSettings.updateServer(server.id, { enabled });
					if (!enabled) await this.lavaPlugin.mcpConnections.disconnect(server.id);
					this.display();
				});
			});
	}

	private openServerModal(
		serverId: string,
		options?: { expandHeaders?: boolean; expandTools?: boolean },
	): void {
		new McpServerModal(
			this.app,
			this.lavaPlugin,
			serverId,
			() => this.display(),
			options,
		).open();
	}
}
