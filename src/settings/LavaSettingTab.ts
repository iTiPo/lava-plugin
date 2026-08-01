import {
	PluginSettingTab,
	Setting,
	requireApiVersion,
	type SettingDefinitionItem,
} from 'obsidian';
import type LavaPlugin from '../main';
import type { McpServerConfig } from '../mcp/types';
import { formatCount } from './format';
import { McpServerModal, hostLabel, statusLabel } from './McpServerModal';

/**
 * Settings tab with dual rendering:
 * - Obsidian 1.13+: declarative `getSettingDefinitions()` (searchable)
 * - Older Obsidian: imperative `display()` fallback
 *
 * 1.13 is still Catalyst-only; keep `display()` until minAppVersion can move to 1.13.0.
 */
export class LavaSettingTab extends PluginSettingTab {
	private unsubscribeConnections: (() => void) | undefined;
	private statusRefreshTimer: number | undefined;
	/** Servers we already tried to auto-connect during this settings visit. */
	private readonly autoConnectAttempted = new Set<string>();
	private refreshingFromStatus = false;

	constructor(private readonly lavaPlugin: LavaPlugin) {
		super(lavaPlugin.app, lavaPlugin);
	}

	override getSettingDefinitions(): SettingDefinitionItem[] {
		this.ensureConnectionSubscription();

		const servers = this.lavaPlugin.mcpSettings.listServers();
		// Search indexing calls this while the tab is hidden — skip side effects then.
		if (this.containerEl.isShown() && !this.refreshingFromStatus) {
			this.kickOffAutoConnects(servers);
		}

		return [
			{
				name: 'MCP servers',
				desc: 'Connect Streamable HTTP servers. Tools are available only in Agent mode. OAuth, SSE, and stdio are not supported yet.',
			},
			{
				type: 'list',
				emptyState:
					'No MCP servers yet. Add a server, then configure its URL, headers, and tools.',
				addItem: {
					name: 'Add MCP server',
					action: () => {
						void this.addServer();
					},
				},
				onDelete: (index) => {
					void this.removeServerAt(index);
				},
				items: servers.map((server) => ({
					name: serverDisplayName(server),
					desc: serverSummary(server, this.lavaPlugin.mcpConnections.getStatus(server.id)),
					aliases: ['MCP', hostLabel(server.url)],
					render: (setting) => {
						this.renderDeclarativeServerRow(setting, server);
					},
				})),
			},
		];
	}

	display(): void {
		this.renderImperativeTab();
	}

	override hide(): void {
		this.unsubscribeConnections?.();
		this.unsubscribeConnections = undefined;
		if (this.statusRefreshTimer !== undefined) {
			window.clearTimeout(this.statusRefreshTimer);
			this.statusRefreshTimer = undefined;
		}
		this.autoConnectAttempted.clear();
		this.refreshingFromStatus = false;
		super.hide();
	}

	private refreshTab(): void {
		if (requireApiVersion('1.13.0')) {
			this.update();
			return;
		}
		// Avoid calling deprecated display() from our code; Obsidian still
		// invokes display() on hosts below 1.13.
		this.renderImperativeTab();
	}

	private renderImperativeTab(): void {
		this.ensureConnectionSubscription();

		const servers = this.lavaPlugin.mcpSettings.listServers();
		if (!this.refreshingFromStatus) {
			this.kickOffAutoConnects(servers);
		}

		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('MCP servers')
			.setDesc(
				'Connect Streamable HTTP servers. Tools are available only in Agent mode. OAuth, SSE, and stdio are not supported yet.',
			)
			.setHeading();

		const listEl = containerEl.createDiv({ cls: 'lava-mcp-server-list' });

		if (servers.length === 0) {
			const empty = listEl.createDiv({ cls: 'lava-mcp-empty' });
			empty.createEl('p', {
				text: 'No MCP servers yet. Add a server, then configure its URL, headers, and tools.',
				cls: 'setting-item-description',
			});
		} else {
			for (const server of servers) this.renderImperativeServerRow(listEl, server);
		}

		new Setting(containerEl)
			.setName('Add server')
			.setDesc('Opens the server configuration dialog.')
			.addButton((button) => {
				button
					.setButtonText('Add MCP server')
					.setCta()
					.onClick(() => {
						void this.addServer();
					});
			});
	}

	private ensureConnectionSubscription(): void {
		if (this.unsubscribeConnections) return;
		this.unsubscribeConnections = this.lavaPlugin.mcpConnections.subscribe(() => {
			if (this.statusRefreshTimer !== undefined) {
				window.clearTimeout(this.statusRefreshTimer);
			}
			this.statusRefreshTimer = window.setTimeout(() => {
				this.statusRefreshTimer = undefined;
				this.refreshingFromStatus = true;
				try {
					this.refreshTab();
				} finally {
					this.refreshingFromStatus = false;
				}
			}, 50);
		});
	}

	private kickOffAutoConnects(servers: McpServerConfig[]): void {
		for (const server of servers) {
			if (!server.enabled || !server.url.trim()) continue;
			if (this.autoConnectAttempted.has(server.id)) continue;

			const status = this.lavaPlugin.mcpConnections.getStatus(server.id);
			if (status === 'connected' || status === 'connecting') {
				this.autoConnectAttempted.add(server.id);
				continue;
			}

			this.autoConnectAttempted.add(server.id);
			void this.lavaPlugin.mcpConnections.connect(server.id).catch(() => undefined);
		}
	}

	private renderDeclarativeServerRow(setting: Setting, server: McpServerConfig): void {
		setting.setClass('lava-mcp-server-row__controls');
		if (!server.enabled) {
			setting.settingEl.addClass('lava-mcp-server-row--disabled');
		}

		const status = this.lavaPlugin.mcpConnections.getStatus(server.id);
		setting.setDesc(
			createFragment((frag) => {
				frag.createSpan({
					cls: `lava-mcp-status lava-mcp-status--${status}`,
					text: statusLabel(status),
				});
				frag.createSpan({
					cls: 'lava-mcp-server-row__summary',
					text: ` ${serverMetaSummary(server)}`,
				});
			}),
		);

		setting.addExtraButton((button) => {
			button
				.setIcon('pencil')
				.setTooltip('Configure server')
				.onClick(() => {
					this.openServerModal(server.id);
				});
		});

		setting.addToggle((toggle) => {
			toggle.setTooltip(server.enabled ? 'Enabled' : 'Disabled');
			toggle.setValue(server.enabled).onChange((enabled) => {
				void this.setServerEnabled(server.id, enabled);
			});
		});
	}

	private renderImperativeServerRow(listEl: HTMLElement, server: McpServerConfig): void {
		const row = listEl.createDiv({ cls: 'lava-mcp-server-row' });
		if (!server.enabled) row.addClass('lava-mcp-server-row--disabled');

		const identity = row.createDiv({ cls: 'lava-mcp-server-row__identity' });
		identity.createDiv({
			text: serverDisplayName(server),
			cls: 'lava-mcp-server-row__title',
		});

		const meta = identity.createDiv({ cls: 'lava-mcp-server-row__meta' });
		const status = this.lavaPlugin.mcpConnections.getStatus(server.id);
		meta.createSpan({
			cls: `lava-mcp-status lava-mcp-status--${status}`,
			text: statusLabel(status),
		});
		meta.createSpan({
			cls: 'lava-mcp-server-row__summary',
			text: serverMetaSummary(server),
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
					.onClick(() => {
						void this.removeServer(server.id);
					});
			})
			.addToggle((toggle) => {
				toggle.setTooltip(server.enabled ? 'Enabled' : 'Disabled');
				toggle.setValue(server.enabled).onChange((enabled) => {
					void this.setServerEnabled(server.id, enabled);
				});
			});
	}

	private async addServer(): Promise<void> {
		const server = await this.lavaPlugin.mcpSettings.addServer();
		this.refreshTab();
		this.openServerModal(server.id, { expandHeaders: true });
	}

	private async removeServerAt(index: number): Promise<void> {
		const server = this.lavaPlugin.mcpSettings.listServers()[index];
		if (!server) return;
		await this.removeServer(server.id);
	}

	private async removeServer(serverId: string): Promise<void> {
		await this.lavaPlugin.mcpConnections.disconnect(serverId);
		await this.lavaPlugin.mcpSettings.removeServer(serverId);
		this.autoConnectAttempted.delete(serverId);
		this.refreshTab();
	}

	private async setServerEnabled(serverId: string, enabled: boolean): Promise<void> {
		await this.lavaPlugin.mcpSettings.updateServer(serverId, { enabled });
		if (!enabled) {
			await this.lavaPlugin.mcpConnections.disconnect(serverId);
		}
		this.autoConnectAttempted.delete(serverId);
		this.refreshTab();
	}

	private openServerModal(
		serverId: string,
		options?: { expandHeaders?: boolean; expandTools?: boolean },
	): void {
		new McpServerModal(
			this.app,
			this.lavaPlugin,
			serverId,
			() => {
				this.refreshTab();
			},
			options,
		).open();
	}
}

function serverDisplayName(server: McpServerConfig): string {
	return server.name.trim() || 'MCP server';
}

function serverMetaSummary(server: McpServerConfig): string {
	const summaryParts = [hostLabel(server.url)];
	if (server.tools.length > 0) {
		summaryParts.push(formatCount(server.tools.length, 'tool'));
	}
	if (server.headers.length > 0) {
		summaryParts.push(formatCount(server.headers.length, 'header'));
	}
	return summaryParts.filter(Boolean).join(' · ');
}

function serverSummary(
	server: McpServerConfig,
	status: ReturnType<LavaPlugin['mcpConnections']['getStatus']>,
): string {
	return `${statusLabel(status)} · ${serverMetaSummary(server)}`;
}
