import { Modal, Notice, Setting, setIcon, type App } from 'obsidian';
import type LavaPlugin from '../main';
import type { McpConnectionStatus, McpServerConfig, McpToolPolicy } from '../mcp/types';

export class McpServerModal extends Modal {
	private readonly expandedHeaders = new Set<string>();
	private readonly expandedTools = new Set<string>();

	constructor(
		app: App,
		private readonly lavaPlugin: LavaPlugin,
		private readonly serverId: string,
		private readonly onChange: () => void,
		options?: { expandHeaders?: boolean; expandTools?: boolean },
	) {
		super(app);
		if (options?.expandHeaders) this.expandedHeaders.add(serverId);
		if (options?.expandTools) this.expandedTools.add(serverId);
	}

	override onOpen(): void {
		this.modalEl.addClass('lava-mcp-server-modal');
		this.render();
	}

	override onClose(): void {
		this.contentEl.empty();
		this.onChange();
	}

	private render(): void {
		const server = this.lavaPlugin.mcpSettings.getServer(this.serverId);
		if (!server) {
			this.close();
			return;
		}

		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: server.name.trim() || 'MCP server' });
		contentEl.createEl('p', {
			cls: 'setting-item-description lava-mcp-modal__lede',
			text: 'Configure the Streamable HTTP endpoint, optional headers, then test and set tool policies.',
		});

		this.renderStatus(contentEl, server);

		new Setting(contentEl).setName('Name').addText((text) => {
			text.setValue(server.name).onChange(async (name) => {
				await this.lavaPlugin.mcpSettings.updateServer(server.id, { name });
				const title = contentEl.querySelector('h2');
				if (title) title.setText(name.trim() || 'MCP server');
				this.onChange();
			});
		});

		new Setting(contentEl)
			.setName('URL')
			.setDesc('Streamable HTTP endpoint. Use HTTPS, or localhost for local development.')
			.addText((text) => {
				text.setPlaceholder('https://example.com/mcp').setValue(server.url);
				text.inputEl.addClass('lava-mcp-url-input');
				text.onChange(async (url) => {
					await this.lavaPlugin.mcpSettings.updateServer(server.id, { url });
					await this.lavaPlugin.mcpConnections.disconnect(server.id);
					this.onChange();
				});
			});

		this.renderHeadersSection(contentEl, server);

		const connectionError = this.lavaPlugin.mcpConnections.getError(server.id);
		new Setting(contentEl)
			.setName('Connection')
			.setDesc(connectionError || 'Test the endpoint and refresh the tool list.')
			.addButton((button) => {
				button.setButtonText('Test and refresh').onClick(async () => {
					button.setDisabled(true).setButtonText('Connecting…');
					try {
						const tools =
							await this.lavaPlugin.mcpConnections.refreshServer(server.id);
						this.expandedTools.add(server.id);
						new Notice(`Connected. Discovered ${tools.length} tools.`);
					} catch (error) {
						new Notice(
							error instanceof Error
								? error.message
								: 'Could not connect to MCP server.',
						);
					}
					this.onChange();
					this.render();
				});
			});

		this.renderToolsSection(contentEl, server);

		new Setting(contentEl).addButton((button) => {
			button.setButtonText('Done').setCta().onClick(() => this.close());
		});
	}

	private renderStatus(parent: HTMLElement, server: McpServerConfig): void {
		const row = parent.createDiv({ cls: 'lava-mcp-modal__status' });
		const status = this.lavaPlugin.mcpConnections.getStatus(server.id);
		row.createSpan({
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
		row.createSpan({
			cls: 'lava-mcp-modal__status-summary',
			text: summaryParts.filter(Boolean).join(' · '),
		});
	}

	private renderHeadersSection(parent: HTMLElement, server: McpServerConfig): void {
		const expanded = this.expandedHeaders.has(server.id);
		const section = parent.createDiv({ cls: 'lava-mcp-section' });
		renderSectionToggle(
			section,
			'Headers',
			server.headers.length === 0
				? 'Optional request headers'
				: `${server.headers.length} configured`,
			expanded,
			() => {
				if (expanded) this.expandedHeaders.delete(server.id);
				else this.expandedHeaders.add(server.id);
				this.render();
			},
		);

		if (!expanded) return;

		const content = section.createDiv({ cls: 'lava-mcp-section__content' });
		content.createEl('p', {
			cls: 'lava-mcp-section__hint setting-item-description',
			text: 'Sent with every request. Add an Authorization header if the server requires one.',
		});

		if (server.headers.length === 0) {
			content.createEl('p', {
				text: 'No headers yet.',
				cls: 'setting-item-description',
			});
		}

		for (const header of server.headers) {
			new Setting(content)
				.setClass('lava-mcp-header-row')
				.addText((text) => {
					text.setPlaceholder('Header name')
						.setValue(header.name)
						.onChange(async (name) => {
							await this.lavaPlugin.mcpSettings.updateHeader(
								server.id,
								header.id,
								{ name },
							);
							await this.lavaPlugin.mcpConnections.disconnect(server.id);
							this.onChange();
						});
					text.inputEl.setAttr('aria-label', 'Header name');
				})
				.addText((text) => {
					text.setPlaceholder('Header value')
						.setValue(header.value)
						.onChange(async (value) => {
							await this.lavaPlugin.mcpSettings.updateHeader(
								server.id,
								header.id,
								{ value },
							);
							await this.lavaPlugin.mcpConnections.disconnect(server.id);
							this.onChange();
						});
					text.inputEl.setAttr('aria-label', 'Header value');
				})
				.addExtraButton((button) => {
					button
						.setIcon('trash')
						.setTooltip('Remove header')
						.onClick(async () => {
							await this.lavaPlugin.mcpSettings.removeHeader(
								server.id,
								header.id,
							);
							await this.lavaPlugin.mcpConnections.disconnect(server.id);
							this.onChange();
							this.render();
						});
				});
		}

		new Setting(content).addButton((button) => {
			button.setButtonText('Add header').onClick(async () => {
				await this.lavaPlugin.mcpSettings.addHeader(server.id);
				this.expandedHeaders.add(server.id);
				this.onChange();
				this.render();
			});
		});
	}

	private renderToolsSection(parent: HTMLElement, server: McpServerConfig): void {
		if (server.tools.length === 0) {
			parent.createEl('p', {
				cls: 'lava-mcp-tools-empty setting-item-description',
				text: 'No tools discovered yet. Run Test and refresh after the URL and headers are set.',
			});
			return;
		}

		const expanded = this.expandedTools.has(server.id);
		const section = parent.createDiv({ cls: 'lava-mcp-section' });
		renderSectionToggle(
			section,
			'Tools',
			`${server.tools.length} discovered`,
			expanded,
			() => {
				if (expanded) this.expandedTools.delete(server.id);
				else this.expandedTools.add(server.id);
				this.render();
			},
		);

		if (!expanded) return;

		const content = section.createDiv({ cls: 'lava-mcp-section__content' });
		content.createEl('p', {
			cls: 'lava-mcp-section__hint setting-item-description',
			text: 'Changed tool definitions always return to Ask.',
		});

		new Setting(content)
			.setName('Defaults')
			.setDesc('Apply a policy to every tool on this server.')
			.addDropdown((dropdown) => {
				dropdown
					.addOption('ask', 'Ask for all')
					.addOption('reads', 'Auto-run read-only hints')
					.addOption('auto', 'Auto-run all')
					.setValue('custom')
					.addOption('custom', 'Custom')
					.onChange(async (preset) => {
						await this.lavaPlugin.mcpSettings.setAllToolPolicies(
							server.id,
							(tool) => {
								if (preset === 'auto') return 'auto';
								if (preset === 'reads' && tool.readOnlyHint) return 'auto';
								return 'ask';
							},
						);
						await this.lavaPlugin.mcpConnections.disconnect(server.id);
						this.onChange();
						this.render();
					});
			});

		for (const tool of server.tools) {
			new Setting(content)
				.setName(tool.title ?? tool.name)
				.setDesc(
					`${tool.name}${tool.readOnlyHint ? ' · read-only hint' : ''}${tool.description ? ` — ${tool.description}` : ''}`,
				)
				.addDropdown((dropdown) => {
					dropdown
						.addOption('blocked', 'Blocked')
						.addOption('ask', 'Ask')
						.addOption('auto', 'Auto-run')
						.setValue(tool.policy)
						.onChange(async (policy) => {
							await this.lavaPlugin.mcpSettings.setToolPolicy(
								server.id,
								tool.name,
								policy as McpToolPolicy,
							);
							await this.lavaPlugin.mcpConnections.disconnect(server.id);
							this.onChange();
						});
				});
		}
	}
}

function renderSectionToggle(
	section: HTMLElement,
	title: string,
	subtitle: string,
	expanded: boolean,
	onToggle: () => void,
): void {
	const toggle = section.createEl('button', {
		cls: 'lava-mcp-section__toggle',
		attr: { type: 'button' },
	});
	toggle.setAttr('aria-expanded', String(expanded));

	const chevron = toggle.createSpan({ cls: 'lava-mcp-section__chevron' });
	setIcon(chevron, expanded ? 'chevron-down' : 'chevron-right');

	const labels = toggle.createDiv({ cls: 'lava-mcp-section__labels' });
	labels.createSpan({ cls: 'lava-mcp-section__title', text: title });
	labels.createSpan({ cls: 'lava-mcp-section__subtitle', text: subtitle });

	toggle.addEventListener('click', onToggle);
}

export function statusLabel(status: McpConnectionStatus): string {
	if (status === 'connected') return 'Connected';
	if (status === 'connecting') return 'Connecting';
	if (status === 'error') return 'Failed';
	return 'Disconnected';
}

export function hostLabel(url: string): string {
	const trimmed = url.trim();
	if (!trimmed) return 'No URL';
	try {
		return new URL(trimmed).host || trimmed;
	} catch {
		return trimmed;
	}
}
