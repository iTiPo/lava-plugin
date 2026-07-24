<script lang="ts">
    import { onMount } from 'svelte';
    import type { App } from 'obsidian';
    import type { AuthStore } from '../../auth/auth-store';
    import type { AuthRoute } from '../../auth/auth-types';
    import type { ChatSessionStore } from '../../chat/session-store';
    import type { LavaConfig } from '../../config';
    import type { McpConnectionManager } from '../../mcp/connection-manager';
    import type { McpSettingsStore } from '../../mcp/settings-store';
    import ChatShell from '../chat/ChatShell.svelte';
    import AuthCheckEmail from './AuthCheckEmail.svelte';
    import AuthProfile from './AuthProfile.svelte';
    import AuthWelcome from './AuthWelcome.svelte';

    interface Props {
        app: App;
        sessionStore: ChatSessionStore;
        authStore: AuthStore;
        mcpSettings: McpSettingsStore;
        mcpConnections: McpConnectionManager;
        config: LavaConfig;
        isReturningUser: boolean;
    }

    let {
        app,
        sessionStore,
        authStore,
        mcpSettings,
        mcpConnections,
        config,
        isReturningUser,
    }: Props = $props();

    let route = $state<AuthRoute>('welcome');
    let ready = $state(false);
    let checkEmailError = $state('');
    let hasSessions = $state(false);
    let resumeChatAfterAuth = $state(false);

    const showProfileIcon = $derived(isReturningUser || authStore.isAuthenticated() || hasSessions);
    const showWelcomeBack = $derived(hasSessions);

    $effect.pre(() => {
        hasSessions = sessionStore.listSessions().length > 0;
    });

    function resolveInitialRoute(): AuthRoute {
        if (authStore.isAuthenticated()) return 'chats';
        if (authStore.getStatus() === 'pending_email') return 'check_email';
        if (!isReturningUser) return 'welcome';
        return 'chats';
    }

    async function enterChats(): Promise<void> {
        try {
            await sessionStore.ensureActiveSession();
        } catch (error) {
            console.error('Failed to load chat session:', error);
        }
        route = 'chats';
    }

    function handleAuthChange(): void {
        checkEmailError = authStore.getLastError();
        if (
            authStore.isAuthenticated() &&
            (route === 'welcome' || route === 'check_email')
        ) {
            const shouldResume = resumeChatAfterAuth;
            resumeChatAfterAuth = false;
            if (!shouldResume) {
                sessionStore.requestNewChat();
            }
            void enterChats();
        }
    }

    onMount(() => {
        void (async () => {
            route = resolveInitialRoute();
            if (route === 'chats') {
                try {
                    await sessionStore.ensureActiveSession();
                } catch (error) {
                    console.error('Failed to load chat session:', error);
                }
            }
            hasSessions = sessionStore.listSessions().length > 0;
            ready = true;
        })();

        const unsubscribeSessions = sessionStore.subscribe(() => {
            hasSessions = sessionStore.listSessions().length > 0;
        });
        const unsubscribeAuth = authStore.subscribe(handleAuthChange);
        return () => {
            unsubscribeSessions();
            unsubscribeAuth();
        };
    });

    async function handleWelcomeSubmit(email: string): Promise<void> {
        checkEmailError = '';
        await authStore.requestMagicLink(email);
        route = 'check_email';
    }

    function openAuth(): void {
        resumeChatAfterAuth = true;
        route = 'welcome';
    }

    function handleWelcomeBack(): void {
        resumeChatAfterAuth = false;
        void enterChats();
    }

    function handleCheckEmailBack(): void {
        void authStore.backFromCheckEmail();
        checkEmailError = '';
        route = 'welcome';
    }

    function handleProfileClick(): void {
        route = authStore.isAuthenticated() ? 'profile' : 'welcome';
    }

    function handleProfileBack(): void {
        void enterChats();
    }

    async function handleSignOut(): Promise<void> {
        await authStore.clearSession();
        route = 'welcome';
    }
</script>

{#if ready}
    {#if route === 'welcome'}
        <AuthWelcome
            initialEmail={authStore.getEmail()}
            showBack={showWelcomeBack}
            onBack={handleWelcomeBack}
            onSubmit={handleWelcomeSubmit}
        />
    {:else if route === 'check_email'}
        <AuthCheckEmail
            email={authStore.getEmail()}
            error={checkEmailError}
            onBack={handleCheckEmailBack}
        />
    {:else if route === 'profile'}
        <AuthProfile
            {authStore}
            {config}
            onBack={handleProfileBack}
            onSignOut={handleSignOut}
        />
    {:else}
        <ChatShell
            {app}
            {sessionStore}
            {authStore}
            {mcpSettings}
            {mcpConnections}
            {showProfileIcon}
            onProfileClick={handleProfileClick}
            onOpenAuth={openAuth}
        />
    {/if}
{/if}
