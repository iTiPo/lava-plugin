<script lang="ts">
    import { onDestroy, onMount } from 'svelte';
    import { Platform, type App } from 'obsidian';
    import { createChat, type LavaChat, type LavaUIMessage } from '../../ai/chat-factory';
    import { isAuthApiError } from '../../auth/auth-errors';
    import type { AuthStore } from '../../auth/auth-store';
    import type { ChatSession } from '../../chat/session-types';
    import type { ChatSessionStore } from '../../chat/session-store';
    import ChatThreadHeader from './ChatThreadHeader.svelte';
    import ChatThreadList from './ChatThreadList.svelte';
    import ChatView from './ChatView.svelte';

    interface Props {
        app: App;
        sessionStore: ChatSessionStore;
        authStore: AuthStore;
        showProfileIcon?: boolean;
        onProfileClick?: () => void;
        onOpenAuth?: () => void;
    }

    let {
        app,
        sessionStore,
        authStore,
        showProfileIcon = false,
        onProfileClick,
        onOpenAuth,
    }: Props = $props();

    const SIDEBAR_EXPAND_WIDTH = 720;
    const SIDEBAR_COLLAPSE_WIDTH = 680;

    let shellEl: HTMLDivElement | undefined = $state();
    let layout = $state<'sidebar' | 'compact'>('compact');
    let activeSessionId = $state('');
    let sessions = $state<ChatSession[]>([]);
    let activeChat = $state<LavaChat | undefined>(undefined);
    let authRequired = $state(false);
    let isAuthenticated = $state(false);

    $effect.pre(() => {
        isAuthenticated = authStore.isAuthenticated();
        if (activeChat) return;
        activeSessionId = sessionStore.getActiveSessionId();
        sessions = sessionStore.listSessions();
        activeChat = createChatForSession(sessionStore.getActiveSession());
    });

    function handleChatError(error: Error): void {
        if (!isAuthApiError(error)) return;
        authRequired = true;
        void authStore.clearSession();
    }

    function createChatForSession(session: ChatSession) {
        return createChat(app, authStore, {
            id: session.id,
            messages: session.messages,
            onError: handleChatError,
            onFinish: ({ message, isAbort, isError }) => {
                if (!isAbort && !isError) {
                    void sessionStore.appendCompletedMessage(session.id, message);
                }
                if (activeChat) {
                    sessionStore.syncFromChat(activeChat);
                }
            },
        });
    }

    function refreshSessions() {
        sessions = sessionStore.listSessions();
    }

    function updateLayout(width: number, current: 'sidebar' | 'compact'): 'sidebar' | 'compact' {
        if (Platform.isMobile) return 'compact';
        if (current === 'sidebar' && width < SIDEBAR_COLLAPSE_WIDTH) return 'compact';
        if (current === 'compact' && width >= SIDEBAR_EXPAND_WIDTH) return 'sidebar';
        return current;
    }

    function isChatBusy(chat: LavaChat): boolean {
        return chat.status === 'streaming' || chat.status === 'submitted';
    }

    async function prepareSwitch(): Promise<void> {
        if (!activeChat) return;
        const outgoingId = activeSessionId;
        if (isChatBusy(activeChat)) {
            await activeChat.stop();
        }
        sessionStore.syncFromChat(activeChat);
        sessionStore.pruneEmptySession(outgoingId);
    }

    async function switchToSession(id: string) {
        if (id === activeSessionId) return;
        await prepareSwitch();
        const session = await sessionStore.selectSession(id);
        if (!session) return;
        activeSessionId = session.id;
        activeChat = createChatForSession(session);
        refreshSessions();
    }

    async function createNewSession() {
        await prepareSwitch();
        const session = sessionStore.createSession();
        activeSessionId = session.id;
        activeChat = createChatForSession(session);
        refreshSessions();
    }

    function handleBeforeSend(text: string) {
        sessionStore.updateTitleFromMessage(text);
        refreshSessions();
    }

    async function handleUserMessageSent(message: LavaUIMessage) {
        await sessionStore.appendCompletedMessage(activeSessionId, message);
        refreshSessions();
    }

    const activeTitle = $derived(
        sessions.find((s) => s.id === activeSessionId)?.title ?? 'New chat',
    );

    $effect(() => {
        if (!shellEl) return;
        const ro = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (!entry) return;
            layout = updateLayout(entry.contentRect.width, layout);
        });
        ro.observe(shellEl);
        return () => ro.disconnect();
    });

    onMount(() => {
        if (sessionStore.takePendingNewChat()) {
            void createNewSession();
        }
        const unsubscribeSessions = sessionStore.subscribe(() => {
            refreshSessions();
            if (sessionStore.takePendingNewChat()) {
                void createNewSession();
            }
        });
        const unsubscribeAuth = authStore.subscribe(() => {
            isAuthenticated = authStore.isAuthenticated();
            if (isAuthenticated) {
                authRequired = false;
            }
        });
        return () => {
            unsubscribeSessions();
            unsubscribeAuth();
        };
    });

    onDestroy(() => {
        if (!activeChat) return;
        sessionStore.syncFromChat(activeChat);
        if (isChatBusy(activeChat)) {
            void activeChat.stop();
        }
    });
</script>

<div class="lava-chat-shell" bind:this={shellEl}>
    {#if layout === 'sidebar'}
        <ChatThreadList
            {sessions}
            {activeSessionId}
            {showProfileIcon}
            onSelect={(id) => void switchToSession(id)}
            onNew={() => void createNewSession()}
            {onProfileClick}
        />
    {/if}

    <div class="lava-chat-shell__main">
        {#if layout === 'compact'}
            <ChatThreadHeader
                {sessions}
                {activeSessionId}
                {activeTitle}
                {showProfileIcon}
                onSelect={(id) => void switchToSession(id)}
                onNew={() => void createNewSession()}
                {onProfileClick}
            />
        {/if}

        {#if activeChat}
            {#key activeSessionId}
                <ChatView
                    {app}
                    chat={activeChat}
                    {isAuthenticated}
                    {authRequired}
                    onOpenAuth={onOpenAuth}
                    onBeforeSend={handleBeforeSend}
                    onUserMessageSent={handleUserMessageSent}
                />
            {/key}
        {/if}
    </div>
</div>
