import { ItemView, type WorkspaceLeaf } from 'obsidian';
import { mount, unmount } from 'svelte';
import type LavaPlugin from '../../main';
import AuthGate from '../auth/AuthGate.svelte';

export const VIEW_TYPE_LAVA_CHAT = 'lava-chat-view';

export class LavaChatView extends ItemView {
    private readonly plugin: LavaPlugin;
    private component: ReturnType<typeof AuthGate> | undefined;

    constructor(leaf: WorkspaceLeaf, plugin: LavaPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE_LAVA_CHAT;
    }

    getDisplayText(): string {
        const title = this.plugin.chatSessions.getActiveSessionTitle();
        return title === 'New chat' ? 'Getlava chat' : `Getlava · ${title}`;
    }

    getIcon(): string {
        return 'message-square';
    }

    async onOpen(): Promise<void> {
        this.contentEl.empty();
        this.contentEl.addClass('lava-chat-host');

        this.component = mount(AuthGate, {
            target: this.contentEl,
            props: {
                app: this.app,
                sessionStore: this.plugin.chatSessions,
                authStore: this.plugin.authStore,
                config: this.plugin.config,
                isReturningUser: this.plugin.isReturningUser,
            },
        });
    }

    async onClose(): Promise<void> {
        if (this.component) {
            await unmount(this.component);
            this.component = undefined;
        }
    }
}
