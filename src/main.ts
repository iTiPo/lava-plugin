import { Plugin, type WorkspaceLeaf } from 'obsidian';
import { loadLavaConfig, type LavaConfig } from './config';
import { AuthStore } from './auth/auth-store';
import { isReturningUser } from './auth/returning-user';
import { ChatPersistence } from './chat/chat-persistence';
import { ChatSessionStore } from './chat/session-store';
import { LavaChatView, VIEW_TYPE_LAVA_CHAT } from './ui/chat/ChatView';
import { McpSettingsStore } from './mcp/settings-store';
import { McpConnectionManager } from './mcp/connection-manager';
import { LavaSettingTab } from './settings/LavaSettingTab';

export default class LavaPlugin extends Plugin {
    config!: LavaConfig;
    chatSessions!: ChatSessionStore;
    authStore!: AuthStore;
    mcpSettings!: McpSettingsStore;
    mcpConnections!: McpConnectionManager;
    isReturningUser = false;

    async onload() {
        this.config = loadLavaConfig();

        const persistence = new ChatPersistence(this);
        await persistence.ensureDir();
        const index = await persistence.loadIndex();

        this.isReturningUser = isReturningUser(index);
        this.authStore = new AuthStore();
        await this.authStore.init(this, this.config);
        this.mcpSettings = new McpSettingsStore(this);
        await this.mcpSettings.init();
        this.mcpConnections = new McpConnectionManager(this.mcpSettings);

        this.chatSessions = await ChatSessionStore.fromLoaded(persistence, index, {
            createDefaultSession:
                this.isReturningUser || this.authStore.isAuthenticated(),
        });

        this.registerView(VIEW_TYPE_LAVA_CHAT, (leaf) => new LavaChatView(leaf, this));
        this.addSettingTab(new LavaSettingTab(this));

        this.registerObsidianProtocolHandler('getlava-auth-callback', (params) => {
            void this.authStore.completeMagicLink(params);
            void this.activateChatView();
        });

        this.addRibbonIcon('message-square', 'Open chat', () => {
            void this.activateChatView();
        });

        this.addCommand({
            id: 'open-chat',
            name: 'Open chat',
            callback: () => {
                void this.activateChatView();
            },
        });

        this.addCommand({
            id: 'new-chat',
            name: 'New chat',
            callback: () => {
                this.chatSessions.requestNewChat();
                void this.activateChatView();
            },
        });
    }

    onunload() {
        this.authStore?.dispose();
        void this.mcpConnections?.closeAll();
        void this.chatSessions?.flushIndex();
    }

    async activateChatView(): Promise<void> {
        const { workspace } = this.app;
        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE_LAVA_CHAT);

        if (leaves.length > 0) {
            leaf = leaves[0] ?? null;
        } else {
            leaf = workspace.getRightLeaf(false);
            if (leaf) {
                await leaf.setViewState({ type: VIEW_TYPE_LAVA_CHAT, active: true });
            }
        }

        if (leaf) {
            await workspace.revealLeaf(leaf);
        }
    }
}
