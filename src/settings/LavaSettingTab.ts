import { Notice, PluginSettingTab, Setting, setIcon } from 'obsidian';
import type LavaPlugin from '../main';
import type { McpConnectionStatus, McpServerConfig, McpToolPolicy } from '../mcp/types';

export class LavaSettingTab extends PluginSettingTab {
    private readonly expandedServers = new Set<string>();
    private readonly expandedHeaders = new Set<string>();
    private readonly expandedTools = new Set<string>();

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
                text: 'No MCP servers yet. Add a Streamable HTTP endpoint, optional headers, then test the connection.',
                cls: 'setting-item-description',
            });
        } else {
            for (const server of servers) this.renderServer(listEl, server);
        }

        new Setting(containerEl)
            .setName('Add server')
            .setDesc('Creates a new server card below. Configure the URL and headers, then test and refresh.')
            .addButton((button) => {
                button.setButtonText('Add MCP server').setCta().onClick(async () => {
                    const server = await this.lavaPlugin.mcpSettings.addServer();
                    this.expandedServers.add(server.id);
                    this.expandedHeaders.add(server.id);
                    this.display();
                });
            });
    }

    private renderServer(listEl: HTMLElement, server: McpServerConfig): void {
        const expanded = this.expandedServers.has(server.id);
        const card = listEl.createDiv({ cls: 'lava-mcp-server' });
        if (!server.enabled) card.addClass('lava-mcp-server--disabled');
        if (expanded) card.addClass('lava-mcp-server--expanded');

        this.renderChrome(card, server, expanded);

        if (!expanded) return;

        const body = card.createDiv({ cls: 'lava-mcp-server__body' });

        new Setting(body).setName('Name').addText((text) => {
            text.setValue(server.name).onChange(async (name) => {
                await this.lavaPlugin.mcpSettings.updateServer(server.id, { name });
            });
        });

        new Setting(body)
            .setName('URL')
            .setDesc('Streamable HTTP endpoint. Use HTTPS, or localhost for local development.')
            .addText((text) => {
                text.setPlaceholder('https://example.com/mcp').setValue(server.url);
                text.inputEl.addClass('lava-mcp-url-input');
                text.onChange(async (url) => {
                    await this.lavaPlugin.mcpSettings.updateServer(server.id, { url });
                    await this.lavaPlugin.mcpConnections.disconnect(server.id);
                });
            });

        this.renderHeadersSection(body, server);

        const connectionError = this.lavaPlugin.mcpConnections.getError(server.id);
        new Setting(body)
            .setName('Connection')
            .setDesc(connectionError || 'Test the endpoint and refresh the tool list.')
            .addButton((button) => {
                button.setButtonText('Test and refresh').onClick(async () => {
                    button.setDisabled(true).setButtonText('Connecting…');
                    try {
                        const tools =
                            await this.lavaPlugin.mcpConnections.refreshServer(server.id);
                        this.expandedServers.add(server.id);
                        this.expandedTools.add(server.id);
                        new Notice(`Connected. Discovered ${tools.length} tools.`);
                    } catch (error) {
                        new Notice(
                            error instanceof Error
                                ? error.message
                                : 'Could not connect to MCP server.',
                        );
                    }
                    this.display();
                });
            });

        this.renderToolsSection(body, server);
    }

    private renderChrome(
        card: HTMLElement,
        server: McpServerConfig,
        expanded: boolean,
    ): void {
        const chrome = card.createDiv({ cls: 'lava-mcp-server__chrome' });

        const toggle = chrome.createEl('button', {
            cls: 'lava-mcp-server__toggle',
            attr: {
                type: 'button',
                'aria-expanded': String(expanded),
                'aria-label': expanded
                    ? `Collapse ${server.name.trim() || 'MCP server'}`
                    : `Expand ${server.name.trim() || 'MCP server'}`,
            },
        });
        toggle.addEventListener('click', () => {
            if (expanded) this.expandedServers.delete(server.id);
            else this.expandedServers.add(server.id);
            this.display();
        });

        const chevron = toggle.createSpan({ cls: 'lava-mcp-server__chevron' });
        setIcon(chevron, expanded ? 'chevron-down' : 'chevron-right');

        const identity = toggle.createDiv({ cls: 'lava-mcp-server__identity' });
        identity.createDiv({
            text: server.name.trim() || 'MCP server',
            cls: 'lava-mcp-server__title',
        });

        const meta = identity.createDiv({ cls: 'lava-mcp-server__meta' });
        const status = this.lavaPlugin.mcpConnections.getStatus(server.id);
        const badge = meta.createSpan({
            cls: `lava-mcp-status lava-mcp-status--${status}`,
            text: statusLabel(status),
        });
        badge.setAttr('aria-label', `Connection status: ${statusLabel(status)}`);

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
            cls: 'lava-mcp-server__summary',
            text: summaryParts.filter(Boolean).join(' · '),
        });

        const actions = chrome.createDiv({ cls: 'lava-mcp-server__actions' });
        actions.addEventListener('click', (event) => event.stopPropagation());
        new Setting(actions)
            .setClass('lava-mcp-server__chrome-setting')
            .addToggle((toggleControl) => {
                toggleControl.setTooltip(server.enabled ? 'Enabled' : 'Disabled');
                toggleControl.setValue(server.enabled).onChange(async (enabled) => {
                    await this.lavaPlugin.mcpSettings.updateServer(server.id, { enabled });
                    if (!enabled) await this.lavaPlugin.mcpConnections.disconnect(server.id);
                    this.display();
                });
            })
            .addExtraButton((button) => {
                button
                    .setIcon('trash')
                    .setTooltip('Remove server')
                    .onClick(async () => {
                        await this.lavaPlugin.mcpConnections.disconnect(server.id);
                        await this.lavaPlugin.mcpSettings.removeServer(server.id);
                        this.expandedServers.delete(server.id);
                        this.expandedHeaders.delete(server.id);
                        this.expandedTools.delete(server.id);
                        this.display();
                    });
            });
    }

    private renderHeadersSection(body: HTMLElement, server: McpServerConfig): void {
        const expanded = this.expandedHeaders.has(server.id);
        const section = body.createDiv({ cls: 'lava-mcp-section' });
        this.renderSectionToggle(
            section,
            'Headers',
            server.headers.length === 0
                ? 'Optional request headers'
                : `${server.headers.length} configured`,
            expanded,
            () => {
                if (expanded) this.expandedHeaders.delete(server.id);
                else this.expandedHeaders.add(server.id);
                this.display();
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
                            this.display();
                        });
                });
        }

        new Setting(content).addButton((button) => {
            button.setButtonText('Add header').onClick(async () => {
                await this.lavaPlugin.mcpSettings.addHeader(server.id);
                this.expandedHeaders.add(server.id);
                this.display();
            });
        });
    }

    private renderToolsSection(body: HTMLElement, server: McpServerConfig): void {
        if (server.tools.length === 0) {
            body.createEl('p', {
                cls: 'lava-mcp-tools-empty setting-item-description',
                text: 'No tools discovered yet. Run Test and refresh after the URL and headers are set.',
            });
            return;
        }

        const expanded = this.expandedTools.has(server.id);
        const section = body.createDiv({ cls: 'lava-mcp-section' });
        this.renderSectionToggle(
            section,
            'Tools',
            `${server.tools.length} discovered`,
            expanded,
            () => {
                if (expanded) this.expandedTools.delete(server.id);
                else this.expandedTools.add(server.id);
                this.display();
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
                        this.display();
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
                        });
                });
        }
    }

    private renderSectionToggle(
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
}

function statusLabel(status: McpConnectionStatus): string {
    if (status === 'connected') return 'Connected';
    if (status === 'connecting') return 'Connecting';
    if (status === 'error') return 'Failed';
    return 'Disconnected';
}

function hostLabel(url: string): string {
    const trimmed = url.trim();
    if (!trimmed) return 'No URL';
    try {
        return new URL(trimmed).host || trimmed;
    } catch {
        return trimmed;
    }
}
