<script lang="ts">
    import { onDestroy, onMount } from 'svelte';
    import { Notice, Platform, type App, type Plugin } from 'obsidian';
    import { getToolName, isToolUIPart } from 'ai';
    import { createChat, type LavaChat, type LavaUIMessage } from '../../ai/chat-factory';
    import {
        FALLBACK_DEFAULT_MODEL_ID,
        fetchModels,
        type CatalogModel,
    } from '../../ai/models';
    import { isAuthApiError } from '../../auth/auth-errors';
    import type { AuthStore } from '../../auth/auth-store';
    import type { ChatSession } from '../../chat/session-types';
    import type { ChatSessionStore } from '../../chat/session-store';
    import type { LavaConfig } from '../../config';
    import type { ChatMode } from '../../domain/chat';
    import type { AgentMcpTools, McpConnectionManager } from '../../mcp/connection-manager';
    import { countToolPolicies } from '../../mcp/approval-policy';
    import type { McpSettingsStore } from '../../mcp/settings-store';
    import type { ConnectedMcpTool, ToolApprovalScope } from '../../mcp/types';
    import { loadPluginData, updatePluginData } from '../../plugin-data';
    import ChatThreadHeader from './ChatThreadHeader.svelte';
    import ChatThreadList from './ChatThreadList.svelte';
    import ChatView from './ChatView.svelte';

    interface Props {
        app: App;
        plugin: Plugin;
        sessionStore: ChatSessionStore;
        authStore: AuthStore;
        mcpSettings: McpSettingsStore;
        mcpConnections: McpConnectionManager;
        config: LavaConfig;
        showProfileIcon?: boolean;
        onProfileClick?: () => void;
        onOpenAuth?: () => void;
    }

    let {
        app,
        plugin,
        sessionStore,
        authStore,
        mcpSettings,
        mcpConnections,
        config,
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
    let agentToolsStatus = $state<'idle' | 'connecting' | 'ready' | 'error'>('idle');
    let agentToolsError = $state('');
    let connectedTools = $state<ConnectedMcpTool[]>([]);
    const runStates = new Map<string, { runId: string; triggerMessageId: string }>();
    let initializationId = 0;
    let recoveryWarning = $state('');
    let settingsRefreshTimer: number | undefined;
    const pendingSettingsRefresh = new Set<string>();
    let catalogModels = $state<CatalogModel[]>([]);
    let preferredModelId = $state(FALLBACK_DEFAULT_MODEL_ID);
    let modelsLoaded = $state(false);

    const activeModelId = $derived(
        sessions.find((session) => session.id === activeSessionId)?.modelId ??
            preferredModelId,
    );

    $effect.pre(() => {
        isAuthenticated = authStore.isAuthenticated();
        if (activeChat) return;
        activeSessionId = sessionStore.getActiveSessionId();
        sessions = sessionStore.listSessions();
        void initializeChat(sessionStore.getActiveSession());
    });

    function handleChatError(error: Error): void {
        if (!isAuthApiError(error)) return;
        authRequired = true;
        void authStore.clearSession();
    }

    function mountChat(session: ChatSession, mcp: AgentMcpTools): void {
        connectedTools = mcp.descriptors;
        activeChat = createChat(app, authStore, {
            id: session.id,
            messages: session.messages,
            agent: {
                mode: session.mode,
                modelId: session.modelId || preferredModelId,
                mcpTools: mcp.tools,
                descriptors: () => mcpConnections.listAgentDescriptors(),
                conversationGrants: () => session.toolGrants,
                lifecycle: {
                    currentRun: () => {
                        const run = runStates.get(session.id);
                        return run
                            ? { sessionId: session.id, runId: run.runId }
                            : undefined;
                    },
                    toolStarted: async (operation) => {
                        await sessionStore.recordToolOperation(session.id, {
                            ...operation,
                            status: 'started',
                        });
                    },
                    toolFinished: async (operation) => {
                        await sessionStore.recordToolOperation(session.id, {
                            ...operation,
                            status: operation.error ? 'failed' : 'succeeded',
                        });
                    },
                },
            },
            onError: handleChatError,
            onFinish: ({ message, isAbort, isError }) =>
                handleRunFinish(session, message, isAbort, isError),
            onApprovalStateChange: async (messages, willContinue) => {
                const lastMessage = messages[messages.length - 1];
                if (lastMessage) await sessionStore.persistMessage(session.id, lastMessage);
                const run = runStates.get(session.id);
                if (willContinue && run) {
                    await sessionStore.updateRun(
                        session.id,
                        run.runId,
                        run.triggerMessageId,
                        session.mode,
                        'running',
                    );
                }
            },
        });
    }

    async function initializeChat(session: ChatSession): Promise<void> {
        const requestId = ++initializationId;
        agentToolsError = '';
        pendingSettingsRefresh.delete(session.id);
        await recoverSessionRun(session);
        if (requestId !== initializationId) return;

        if (session.mode !== 'agent') {
            agentToolsStatus = 'idle';
            mountChat(session, { tools: {}, descriptors: [] });
            return;
        }

        const warm = mcpConnections.getConnectedAgentTools();
        mountChat(session, warm);

        if (mcpConnections.allEnabledServersConnected()) {
            agentToolsStatus = 'ready';
            if (pendingSettingsRefresh.has(session.id)) {
                pendingSettingsRefresh.delete(session.id);
                scheduleMcpRefresh(session);
            }
            return;
        }

        agentToolsStatus = 'connecting';
        void connectAgentToolsInBackground(session, requestId);
    }

    async function connectAgentToolsInBackground(
        session: ChatSession,
        requestId: number,
    ): Promise<void> {
        try {
            const mcp = await mcpConnections.getAgentTools();
            if (requestId !== initializationId) return;
            if (session.id !== activeSessionId) return;
            if (sessionStore.getActiveSessionId() !== session.id) return;
            if (session.mode !== 'agent') return;

            if (activeChat && (isChatBusy(activeChat) || chatHasPendingApproval())) {
                pendingSettingsRefresh.add(session.id);
                return;
            }

            if (activeChat) sessionStore.syncFromChat(activeChat, session.id);
            mountChat(session, mcp);

            const enabled = mcpSettings
                .listServers()
                .filter((server) => server.enabled && server.url.trim().length > 0);
            const failed = enabled.filter(
                (server) => mcpConnections.getStatus(server.id) === 'error',
            );
            if (mcp.descriptors.length === 0 && failed.length > 0) {
                agentToolsStatus = 'error';
                agentToolsError =
                    mcpConnections.getError(failed[0]!.id) ||
                    'Could not connect to MCP servers.';
            } else {
                agentToolsStatus = 'ready';
                agentToolsError = '';
            }

            if (pendingSettingsRefresh.has(session.id)) {
                pendingSettingsRefresh.delete(session.id);
                scheduleMcpRefresh(session);
            }
        } catch (error) {
            if (requestId !== initializationId) return;
            agentToolsStatus = 'error';
            agentToolsError =
                error instanceof Error ? error.message : 'Could not connect Agent tools.';
        }
    }

    function retryAgentTools(): void {
        const session = sessionStore.getActiveSession();
        if (session.mode !== 'agent') return;
        const requestId = ++initializationId;
        agentToolsStatus = 'connecting';
        agentToolsError = '';
        void connectAgentToolsInBackground(session, requestId);
    }

    async function recoverSessionRun(session: ChatSession): Promise<void> {
        recoveryWarning = '';
        const activeRun = session.snapshot?.activeRun;
        if (!activeRun) return;
        if (activeRun.status === 'awaiting-approval') {
            runStates.set(session.id, {
                runId: activeRun.runId,
                triggerMessageId: activeRun.triggerMessageId,
            });
            return;
        }

        await sessionStore.updateRun(
            session.id,
            activeRun.runId,
            activeRun.triggerMessageId,
            activeRun.mode,
            'interrupted',
            'Obsidian closed before this run completed.',
        );
        const operations = [...(session.snapshot?.toolOperations.values() ?? [])].filter(
            (operation) =>
                operation.runId === activeRun.runId && operation.status === 'started',
        );
        for (const operation of operations) {
            await sessionStore.recordToolOperation(session.id, {
                operationId: operation.operationId,
                runId: operation.runId,
                toolCallId: operation.toolCallId,
                serverId: operation.serverId,
                toolName: operation.toolName,
                status: 'unknown',
                authorization: operation.authorization,
                input: operation.input,
                error: 'The external outcome is unknown. Verify it before retrying.',
            });
        }
        if (operations.length > 0) {
            recoveryWarning =
                'An external tool was interrupted. Its outcome is unknown; verify the target system before retrying.';
        }
        session.snapshot!.activeRun = undefined;
        runStates.delete(session.id);
    }

    async function handleRunFinish(
        session: ChatSession,
        message: LavaUIMessage,
        isAbort: boolean,
        isError: boolean,
    ): Promise<void> {
        const pendingApproval = hasPendingApproval(message);
        await sessionStore.persistMessage(session.id, message, isAbort || isError);
        const run = runStates.get(session.id);
        if (run) {
            await sessionStore.updateRun(
                session.id,
                run.runId,
                run.triggerMessageId,
                session.mode,
                pendingApproval
                    ? 'awaiting-approval'
                    : isAbort
                      ? 'interrupted'
                      : isError
                        ? 'failed'
                        : 'completed',
                isError ? 'The response failed.' : undefined,
            );
            if (!pendingApproval) {
                runStates.delete(session.id);
            }
        }
        if (
            pendingSettingsRefresh.has(session.id) &&
            session.id === activeSessionId &&
            !pendingApproval
        ) {
            pendingSettingsRefresh.delete(session.id);
            scheduleMcpRefresh(session);
        }
    }

    function hasPendingApproval(message: LavaUIMessage): boolean {
        return message.parts.some(
            (part) =>
                isToolUIPart(part) &&
                part.state === 'approval-requested' &&
                !part.approval.isAutomatic,
        );
    }

    function chatHasPendingApproval(): boolean {
        return activeChat?.messages.some(hasPendingApproval) ?? false;
    }

    async function changeMode(mode: ChatMode): Promise<void> {
        const session = sessionStore.getActiveSession();
        if (session.mode === mode) return;
        if ((activeChat && isChatBusy(activeChat)) || chatHasPendingApproval()) {
            new Notice('Finish or deny the current tool request before changing mode.');
            return;
        }
        if (activeChat) sessionStore.syncFromChat(activeChat);
        await sessionStore.setMode(session.id, mode);
        await initializeChat(session);
        refreshSessions();
    }

    async function changeModel(modelId: string): Promise<void> {
        const session = sessionStore.getActiveSession();
        if (session.modelId === modelId) return;
        if ((activeChat && isChatBusy(activeChat)) || chatHasPendingApproval()) {
            new Notice('Finish or deny the current tool request before changing model.');
            return;
        }
        if (activeChat) sessionStore.syncFromChat(activeChat);
        await sessionStore.setModel(session.id, modelId);
        preferredModelId = modelId;
        await updatePluginData(plugin, (current) => ({
            ...current,
            preferences: {
                ...current.preferences,
                defaultModelId: modelId,
            },
        }));
        await initializeChat(session);
        refreshSessions();
    }

    async function loadModelCatalog(): Promise<void> {
        if (!authStore.isAuthenticated()) {
            modelsLoaded = false;
            catalogModels = [];
            return;
        }

        const data = await loadPluginData(plugin);
        const storedDefault = data.preferences?.defaultModelId;
        if (typeof storedDefault === 'string' && storedDefault.trim()) {
            preferredModelId = storedDefault;
        }

        const result = await fetchModels(authStore, config);
        if (!result.ok) {
            modelsLoaded = false;
            catalogModels = [];
            if (!storedDefault) {
                preferredModelId = FALLBACK_DEFAULT_MODEL_ID;
            }
            return;
        }

        catalogModels = result.models;
        modelsLoaded = true;

        const knownIds = new Set(result.models.map((model) => model.id));
        if (!knownIds.has(preferredModelId)) {
            preferredModelId = result.defaultModelId;
        }

        const session = sessionStore.getActiveSession();
        if (!knownIds.has(session.modelId)) {
            await sessionStore.setModel(session.id, preferredModelId);
            if (activeChat) {
                sessionStore.syncFromChat(activeChat);
                await initializeChat(session);
            }
            refreshSessions();
        }
    }

    function scheduleMcpRefresh(session: ChatSession): void {
        if (settingsRefreshTimer !== undefined) {
            window.clearTimeout(settingsRefreshTimer);
        }
        const sessionId = session.id;
        settingsRefreshTimer = window.setTimeout(() => {
            settingsRefreshTimer = undefined;
            if (
                sessionId !== activeSessionId ||
                sessionStore.getActiveSessionId() !== sessionId ||
                session.mode !== 'agent'
            ) {
                return;
            }
            if (activeChat && (isChatBusy(activeChat) || chatHasPendingApproval())) {
                pendingSettingsRefresh.add(sessionId);
                return;
            }
            if (activeChat) sessionStore.syncFromChat(activeChat, sessionId);
            const requestId = ++initializationId;
            agentToolsStatus = 'connecting';
            agentToolsError = '';
            void connectAgentToolsInBackground(session, requestId);
        }, 150);
    }

    async function handleToolApproval(
        part: LavaUIMessage['parts'][number],
        approved: boolean,
        scope: ToolApprovalScope = 'once',
    ): Promise<void> {
        if (!activeChat || !isToolUIPart(part) || part.state !== 'approval-requested') return;
        const toolName = getToolName(part);
        const descriptor = connectedTools.find((tool) => tool.id === toolName);
        const currentTool = descriptor
            ? mcpSettings
                  .getServer(descriptor.serverId)
                  ?.tools.find((tool) => tool.name === descriptor.toolName)
            : undefined;
        const canApprove =
            approved &&
            (!descriptor ||
                (currentTool?.policy !== 'blocked' &&
                    currentTool?.fingerprint === descriptor.fingerprint));
        if (approved && !canApprove) {
            new Notice('This tool changed or was blocked. The request was denied.');
        }
        if (canApprove && descriptor && scope === 'conversation') {
            await sessionStore.setConversationGrant(activeSessionId, {
                serverId: descriptor.serverId,
                toolName: descriptor.toolName,
                fingerprint: descriptor.fingerprint,
            });
        }
        if (canApprove && descriptor && scope === 'always') {
            await mcpSettings.setToolPolicy(
                descriptor.serverId,
                descriptor.toolName,
                'auto',
            );
            // Settings emit syncs live connection descriptors; refresh UI list.
            connectedTools = mcpConnections.listAgentDescriptors();
        }
        await activeChat.addToolApprovalResponse({
            id: part.approval.id,
            approved: canApprove,
            reason: canApprove ? undefined : 'Denied by the user or current policy.',
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
        activeChat = undefined;
        await initializeChat(session);
        refreshSessions();
    }

    async function createNewSession() {
        await prepareSwitch();
        const session = sessionStore.createSession(preferredModelId);
        activeSessionId = session.id;
        activeChat = undefined;
        await initializeChat(session);
        refreshSessions();
    }

    function handleBeforeSend(text: string) {
        sessionStore.updateTitleFromMessage(text);
        refreshSessions();
    }

    async function handleBeforeRetry(): Promise<void> {
        const session = sessionStore.getActiveSession();
        const trigger = [...(activeChat?.messages ?? [])]
            .reverse()
            .find((message) => message.role === 'user');
        if (!trigger) return;
        runStates.set(session.id, {
            triggerMessageId: trigger.id,
            runId: await sessionStore.startRun(session.id, trigger.id, session.mode),
        });
    }

    async function handleUserMessageSent(message: LavaUIMessage) {
        await sessionStore.appendCompletedMessage(activeSessionId, message);
        const session = sessionStore.getActiveSession();
        runStates.set(activeSessionId, {
            triggerMessageId: message.id,
            runId: await sessionStore.startRun(activeSessionId, message.id, session.mode),
        });
        refreshSessions();
    }

    const activeTitle = $derived(
        sessions.find((s) => s.id === activeSessionId)?.title ?? 'New chat',
    );
    const activeMode = $derived(
        sessions.find((s) => s.id === activeSessionId)?.mode ?? 'chat',
    );
    const toolCounts = $derived(
        countToolPolicies({
            mode: activeMode,
            tools: connectedTools,
            conversationGrants:
                sessions.find((s) => s.id === activeSessionId)?.toolGrants ?? [],
        }),
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
        void loadModelCatalog();
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
                void loadModelCatalog();
            } else {
                modelsLoaded = false;
                catalogModels = [];
            }
        });
        const unsubscribeMcpSettings = mcpSettings.subscribe((change) => {
            const session = sessionStore.getActiveSession();
            if (session.mode !== 'agent') {
                return;
            }
            if (agentToolsStatus === 'connecting') {
                if (change === 'configuration') pendingSettingsRefresh.add(session.id);
                return;
            }
            if (!activeChat || isChatBusy(activeChat) || chatHasPendingApproval()) {
                pendingSettingsRefresh.add(session.id);
                return;
            }
            pendingSettingsRefresh.delete(session.id);
            scheduleMcpRefresh(session);
        });
        return () => {
            unsubscribeSessions();
            unsubscribeAuth();
            unsubscribeMcpSettings();
            if (settingsRefreshTimer !== undefined) {
                window.clearTimeout(settingsRefreshTimer);
            }
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
                    mode={activeMode}
                    modelId={activeModelId}
                    models={modelsLoaded ? catalogModels : []}
                    agentToolCounts={toolCounts}
                    hasConfiguredMcpServers={mcpSettings
                        .listServers()
                        .some((server) => server.enabled)}
                    {agentToolsStatus}
                    {agentToolsError}
                    agentWarning={recoveryWarning}
                    onModeChange={(mode) => void changeMode(mode)}
                    onModelChange={(modelId) => void changeModel(modelId)}
                    onRetryAgentTools={retryAgentTools}
                    onToolApproval={(part, approved, scope) =>
                        handleToolApproval(part, approved, scope)}
                    {isAuthenticated}
                    {authRequired}
                    onOpenAuth={onOpenAuth}
                    onBeforeSend={handleBeforeSend}
                    onBeforeRetry={handleBeforeRetry}
                    onUserMessageSent={handleUserMessageSent}
                />
            {/key}
        {/if}
    </div>
</div>
