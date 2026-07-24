import { Notice, PluginSettingTab, Setting } from 'obsidian';
import type LavaPlugin from '../main';
import type { McpServerConfig, McpToolPolicy } from '../mcp/types';

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
                'Connect Streamable HTTP servers. Tools are available only in Agent mode.',
            )
            .setHeading();

        const servers = this.lavaPlugin.mcpSettings.listServers();
        if (servers.length === 0) {
            containerEl.createEl('p', {
                text: 'No MCP servers configured.',
                cls: 'setting-item-description',
            });
        }
        for (const server of servers) this.renderServer(server);

        new Setting(containerEl)
            .setName('Add MCP server')
            .setDesc(
                'Optional HTTP headers can include Authorization. OAuth, SSE, and stdio are not supported yet.',
            )
            .addButton((button) => {
                button.setButtonText('Add server').setCta().onClick(async () => {
                    await this.lavaPlugin.mcpSettings.addServer();
                    this.display();
                });
            });
    }

    private renderServer(server: McpServerConfig): void {
        const { containerEl } = this;
        new Setting(containerEl)
            .setName(server.name)
            .setDesc(this.statusDescription(server))
            .setHeading();

        new Setting(containerEl)
            .setName('Enabled')
            .setDesc('Disabled servers are disconnected and hidden from Agent mode.')
            .addToggle((toggle) => {
                toggle.setValue(server.enabled).onChange(async (enabled) => {
                    await this.lavaPlugin.mcpSettings.updateServer(server.id, { enabled });
                    if (!enabled) await this.lavaPlugin.mcpConnections.disconnect(server.id);
                    this.display();
                });
            });

        new Setting(containerEl).setName('Name').addText((text) => {
            text.setValue(server.name).onChange(async (name) => {
                await this.lavaPlugin.mcpSettings.updateServer(server.id, { name });
            });
        });

        new Setting(containerEl)
            .setName('Streamable HTTP URL')
            .setDesc('Use an HTTPS endpoint, or localhost for local development.')
            .addText((text) => {
                text.setPlaceholder('https://example.com/mcp').setValue(server.url);
                text.onChange(async (url) => {
                    await this.lavaPlugin.mcpSettings.updateServer(server.id, { url });
                    await this.lavaPlugin.mcpConnections.disconnect(server.id);
                });
            });

        new Setting(containerEl)
            .setName('HTTP headers')
            .setDesc(
                'Sent with every request to this server. Add an Authorization header if the server requires one.',
            )
            .setHeading();

        if (server.headers.length === 0) {
            containerEl.createEl('p', {
                text: 'No headers configured.',
                cls: 'setting-item-description',
            });
        }

        for (const header of server.headers) {
            new Setting(containerEl)
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

        new Setting(containerEl).addButton((button) => {
            button.setButtonText('Add header').onClick(async () => {
                await this.lavaPlugin.mcpSettings.addHeader(server.id);
                this.display();
            });
        });

        new Setting(containerEl)
            .setName('Connection')
            .setDesc(this.lavaPlugin.mcpConnections.getError(server.id) || 'Discover available tools.')
            .addButton((button) => {
                button.setButtonText('Test and refresh').onClick(async () => {
                    button.setDisabled(true).setButtonText('Connecting…');
                    try {
                        const tools =
                            await this.lavaPlugin.mcpConnections.refreshServer(server.id);
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
            })
            .addButton((button) => {
                button.setButtonText('Remove').setWarning().onClick(async () => {
                    await this.lavaPlugin.mcpConnections.disconnect(server.id);
                    await this.lavaPlugin.mcpSettings.removeServer(server.id);
                    this.display();
                });
            });

        if (server.tools.length > 0) {
            new Setting(containerEl)
                .setName('Tool defaults')
                .setDesc('Changed tool definitions always return to Ask.')
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
                new Setting(containerEl)
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
    }

    private statusDescription(server: McpServerConfig): string {
        const status = this.lavaPlugin.mcpConnections.getStatus(server.id);
        if (status === 'connected') return `${server.tools.length} tools · Connected`;
        if (status === 'connecting') return 'Connecting…';
        if (status === 'error') return 'Connection failed';
        return `${server.tools.length} tools · Disconnected`;
    }
}
