<script lang="ts">
    import type { Attachment } from 'svelte/attachments';
    import { setIcon, type App } from 'obsidian';
    import { getToolName, isDynamicToolUIPart, isToolUIPart } from 'ai';
    import type { LavaChat, LavaUIMessage } from '../../ai/chat-factory';
    import type { ChatMode } from '../../chat/persistence-types';
    import type { ToolApprovalScope } from '../../mcp/types';
    import { getNoteMentions, type LavaMessageMetadata } from '../../ai/chat-types';
    import { isAuthApiError } from '../../auth/auth-errors';
    import { NoteMentionSuggest } from '../../notes/note-mention-suggest';
    import {
        rebaseNoteMentions,
        splitNoteMentionText,
        type NoteMention,
    } from '../../notes/parse-mentions';
    import { renderAssistantMarkdown } from './markdown';

    const sendIcon: Attachment<HTMLButtonElement> = (element) => {
        setIcon(element, 'arrow-up');
    };

    const stopIcon: Attachment<HTMLButtonElement> = (element) => {
        setIcon(element, 'square');
    };

    interface Props {
        app: App;
        chat: LavaChat;
        isAuthenticated?: boolean;
        authRequired?: boolean;
        mode?: ChatMode;
        agentToolCounts?: { ask: number; auto: number };
        hasConfiguredMcpServers?: boolean;
        agentWarning?: string;
        onModeChange?: (mode: ChatMode) => void;
        onToolApproval?: (
            part: LavaUIMessage['parts'][number],
            approved: boolean,
            scope?: ToolApprovalScope,
        ) => Promise<void>;
        onOpenAuth?: () => void;
        onBeforeSend?: (text: string) => void;
        onUserMessageSent?: (message: LavaUIMessage) => Promise<void>;
    }

    let {
        app,
        chat,
        isAuthenticated = false,
        authRequired = false,
        mode = 'chat',
        agentToolCounts = { ask: 0, auto: 0 },
        hasConfiguredMcpServers = false,
        agentWarning = '',
        onModeChange,
        onToolApproval,
        onOpenAuth,
        onBeforeSend,
        onUserMessageSent,
    }: Props = $props();

    let input = $state('');
    let messagesEl: HTMLDivElement | undefined = $state();
    let textareaEl: HTMLTextAreaElement | undefined = $state();
    let autoScrollEnabled = $state(true);
    let isProgrammaticScroll = false;
    let isSlowResponse = $state(false);
    let selectedNoteMentions = $state<NoteMention[]>([]);
    let pendingNoteMention: NoteMention | undefined;
    let inputScrollTop = $state(0);
    let inputScrollLeft = $state(0);
    let respondingApprovalIds = $state<string[]>([]);

    const isBusy = $derived(chat.status === 'streaming' || chat.status === 'submitted');
    const activeAssistantMessage = $derived(findAssistantResponse(chat.messages));
    const showResponsePlaceholder = $derived(
        !activeAssistantMessage && (isBusy || chat.status === 'error'),
    );
    const hasPendingApproval = $derived(
        chat.messages.some((message) =>
            message.parts.some(
                (part) =>
                    isToolUIPart(part) &&
                    part.state === 'approval-requested' &&
                    !part.approval.isAutomatic,
            ),
        ),
    );
    const inputSegments = $derived(splitNoteMentionText(input, selectedNoteMentions));

    function isAtBottom(): boolean {
        if (!messagesEl) return false;
        return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight <= 24;
    }

    function scrollToBottom(behavior: ScrollBehavior) {
        if (!messagesEl) return;
        isProgrammaticScroll = true;
        messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior });
        const clearProgrammaticScroll = () => {
            isProgrammaticScroll = false;
        };
        if (behavior === 'smooth') {
            messagesEl.addEventListener('scrollend', clearProgrammaticScroll, { once: true });
            window.setTimeout(clearProgrammaticScroll, 500);
        } else {
            requestAnimationFrame(clearProgrammaticScroll);
        }
    }

    function preferredScrollBehavior(): ScrollBehavior {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'auto'
            : 'smooth';
    }

    function handleMessagesScroll(event: Event) {
        if (isProgrammaticScroll) return;

        const target = event.target as HTMLElement;
        autoScrollEnabled = target.scrollLeft <= 0 && isAtBottom();
    }

    $effect(() => {
        if (!textareaEl) return;
        const mentionSuggest = new NoteMentionSuggest(app, textareaEl, (mention) => {
            pendingNoteMention = mention;
        });
        return () => {
            mentionSuggest.close();
        };
    });

    $effect(() => {
        if (!messagesEl) return;
        messagesEl.addEventListener('scroll', handleMessagesScroll, { capture: true });
        return () => {
            messagesEl?.removeEventListener('scroll', handleMessagesScroll, { capture: true });
        };
    });

    function findAssistantResponse(messages: LavaUIMessage[]): LavaUIMessage | undefined {
        for (let i = messages.length - 1; i >= 0; i--) {
            const message = messages[i];
            if (message?.role === 'assistant') return message;
            if (message?.role === 'user') return undefined;
        }
        return undefined;
    }

    async function sendUserMessage(text: string, noteMentions: NoteMention[]) {
        autoScrollEnabled = true;
        queueMicrotask(() => scrollToBottom(preferredScrollBehavior()));
        onBeforeSend?.(text);
        const metadata: LavaMessageMetadata | undefined = noteMentions.length
            ? { noteMentions }
            : undefined;
        const userMessage: LavaUIMessage = {
            id: chat.generateId(),
            role: 'user',
            metadata,
            parts: [{ type: 'text', text }],
        };
        await onUserMessageSent?.(userMessage);
        await chat.sendMessage(userMessage);
    }

    function handleSubmit(event: SubmitEvent) {
        event.preventDefault();
        const { text, noteMentions } = getInputForSend();
        if (!text || isBusy || hasPendingApproval) return;
        void sendUserMessage(text, noteMentions);
        input = '';
        selectedNoteMentions = [];
        pendingNoteMention = undefined;
    }

    function handleStop() {
        void chat.stop();
    }

    function handleRetry() {
        if (chat.status !== 'error') return;
        autoScrollEnabled = true;
        queueMicrotask(() => scrollToBottom(preferredScrollBehavior()));
        void chat.regenerate();
    }

    async function respondToApproval(
        part: ToolPart,
        approved: boolean,
        scope: ToolApprovalScope = 'once',
    ): Promise<void> {
        if (part.state !== 'approval-requested') return;
        const id = part.approval.id;
        if (respondingApprovalIds.includes(id)) return;
        respondingApprovalIds = [...respondingApprovalIds, id];
        try {
            await onToolApproval?.(part, approved, scope);
        } finally {
            respondingApprovalIds = respondingApprovalIds.filter(
                (candidate) => candidate !== id,
            );
        }
    }

    function handleKeyDown(event: KeyboardEvent) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            const { text, noteMentions } = getInputForSend();
            if (!text || isBusy || hasPendingApproval) return;
            void sendUserMessage(text, noteMentions);
            input = '';
            selectedNoteMentions = [];
            pendingNoteMention = undefined;
        }
    }

    function handleInput(event: Event) {
        const nextInput = (event.currentTarget as HTMLTextAreaElement).value;
        let nextMentions = rebaseNoteMentions(input, nextInput, selectedNoteMentions);

        if (
            pendingNoteMention &&
            nextInput.slice(pendingNoteMention.start, pendingNoteMention.end) ===
                `@${pendingNoteMention.path}`
        ) {
            nextMentions = [...nextMentions, pendingNoteMention];
        }

        input = nextInput;
        selectedNoteMentions = nextMentions;
        pendingNoteMention = undefined;
    }

    function getInputForSend(): { text: string; noteMentions: NoteMention[] } {
        const text = input.trim();
        const leadingOffset = input.length - input.trimStart().length;
        const textEnd = leadingOffset + text.length;

        return {
            text,
            noteMentions: selectedNoteMentions
                .filter(
                    (mention) =>
                        mention.start >= leadingOffset && mention.end <= textEnd,
                )
                .map((mention) => ({
                    ...mention,
                    start: mention.start - leadingOffset,
                    end: mention.end - leadingOffset,
                })),
        };
    }

    function handleInputScroll(event: Event) {
        const textarea = event.currentTarget as HTMLTextAreaElement;
        inputScrollTop = textarea.scrollTop;
        inputScrollLeft = textarea.scrollLeft;
    }

    $effect(() => {
        if (!isBusy) {
            isSlowResponse = false;
            return;
        }

        isSlowResponse = false;
        const timeout = window.setTimeout(() => {
            isSlowResponse = true;
        }, 8_000);

        return () => {
            window.clearTimeout(timeout);
        };
    });

    $effect(() => {
        void chat.messages.length;
        void chat.status;
        for (const message of chat.messages) {
            void message.parts.length;
            for (const part of message.parts) {
                if (part.type === 'text' || part.type === 'reasoning') {
                    void part.text;
                }
                if (part.type === 'reasoning' || isToolUIPart(part)) {
                    void part.state;
                }
                if (isToolUIPart(part)) {
                    void part.input;
                    void part.approval;
                }
            }
        }

        if (!autoScrollEnabled) return;
        queueMicrotask(() => scrollToBottom('auto'));
    });

    function messageText(message: LavaUIMessage): string {
        return message.parts
            .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
            .map((p) => p.text)
            .join('');
    }

    function messageTextSegments(message: LavaUIMessage) {
        const text = messageText(message);
        return splitNoteMentionText(text, getNoteMentions(message.metadata));
    }

    type ToolPart = Extract<
        LavaUIMessage['parts'][number],
        { type: `tool-${string}` } | { type: 'dynamic-tool' }
    >;

    function toolStatus(part: ToolPart): string {
        const name = toolDisplayName(part);
        if (part.state === 'approval-requested' && !part.approval.isAutomatic) {
            return `Approval required · ${name}`;
        }
        if (part.state === 'approval-responded') {
            return part.approval.approved ? `Approved · ${name}` : `Denied · ${name}`;
        }
        if (part.state === 'output-available') return `Completed · ${name}`;
        if (part.state === 'output-error') return `Failed · ${name}`;
        if (part.state === 'output-denied') return `Denied · ${name}`;
        return `Running · ${name}`;
    }

    function toolDisplayName(part: ToolPart): string {
        if (isDynamicToolUIPart(part) && part.title) return part.title;
        const metadata = toolMetadata(part);
        return metadata?.toolName ?? getToolName(part);
    }

    function toolServerName(part: ToolPart): string | undefined {
        return toolMetadata(part)?.serverName;
    }

    function toolMetadata(
        part: ToolPart,
    ): { serverName?: string; toolName?: string } | undefined {
        const metadata = part.toolMetadata?.getlava;
        if (!metadata || typeof metadata !== 'object') return undefined;
        const value = metadata as Record<string, unknown>;
        return {
            serverName:
                typeof value.serverName === 'string' ? value.serverName : undefined,
            toolName: typeof value.toolName === 'string' ? value.toolName : undefined,
        };
    }

    function formatToolValue(value: unknown): string {
        if (value === undefined) return '';
        try {
            return JSON.stringify(value, null, 2);
        } catch {
            return String(value);
        }
    }

    function toolExternalUrl(part: ToolPart): string | undefined {
        if (part.state !== 'output-available') return undefined;
        return findUrl(part.output);
    }

    function findUrl(value: unknown, depth = 0): string | undefined {
        if (depth > 4) return undefined;
        if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
        if (Array.isArray(value)) {
            for (const entry of value) {
                const url = findUrl(entry, depth + 1);
                if (url) return url;
            }
        } else if (value && typeof value === 'object') {
            const object = value as Record<string, unknown>;
            for (const key of ['url', 'html_url', 'uri']) {
                const url = findUrl(object[key], depth + 1);
                if (url) return url;
            }
            for (const entry of Object.values(object)) {
                const url = findUrl(entry, depth + 1);
                if (url) return url;
            }
        }
        return undefined;
    }

    function hasText(message: LavaUIMessage): boolean {
        return message.parts.some((part) => part.type === 'text' && part.text.length > 0);
    }

    function hasStreamingReasoning(message: LavaUIMessage): boolean {
        return message.parts.some(
            (part) => part.type === 'reasoning' && part.state === 'streaming',
        );
    }

    function activeToolStatus(message: LavaUIMessage): string | undefined {
        for (let i = message.parts.length - 1; i >= 0; i--) {
            const part = message.parts[i];
            if (part && isToolUIPart(part)) {
                if (
                    part.state !== 'output-available' &&
                    part.state !== 'output-error' &&
                    part.state !== 'output-denied'
                ) {
                    return toolStatus(part);
                }
            }
        }
        return undefined;
    }

    function isActiveResponse(message: LavaUIMessage | undefined): boolean {
        return message?.id === activeAssistantMessage?.id;
    }

    function responseStatus(message?: LavaUIMessage): string {
        if (!message || isActiveResponse(message)) {
            const tool = message ? activeToolStatus(message) : undefined;
            if (tool) return tool;
            if (chat.status === 'error') return 'Something went wrong.';
            if (chat.status === 'submitted') {
                return isSlowResponse ? 'Still working…' : 'Thinking…';
            }
            if (chat.status === 'streaming') {
                if (message && hasText(message)) return 'Writing response…';
                if (message && hasStreamingReasoning(message)) return 'Thinking…';
                return isSlowResponse ? 'Still working…' : 'Thinking…';
            }
        }
        return 'Response ready';
    }

    function showStreamingCursor(message: LavaUIMessage, partIndex: number): boolean {
        return (
            isActiveResponse(message) &&
            chat.status === 'streaming' &&
            !message.parts
                .slice(partIndex + 1)
                .some((part) => part.type === 'text' && part.text.length > 0)
        );
    }

    const suggestions = [
        'Summarize my latest notes',
        'Brainstorm ideas for a project',
        'Explain a concept simply',
    ];

    const showAuthError = $derived(
        isAuthenticated &&
            (authRequired || (chat.error ? isAuthApiError(chat.error) : false)),
    );
</script>

<div class="lava-chat">
    <div class="lava-chat__messages" bind:this={messagesEl} role="region" aria-label="Conversation">
        {#if chat.messages.length === 0}
            <div class="lava-chat__empty">
                <div class="lava-chat__empty-title">Lava</div>
                <div class="lava-chat__empty-subtitle">
                    Chat with an AI model. Configure your endpoint in Settings → Lava.
                </div>
                {#if isAuthenticated}
                    <div class="lava-chat__suggestions">
                        {#each suggestions as s}
                            <button
                                type="button"
                                class="lava-chat__suggestion"
                                onclick={() => {
                                    input = s;
                                }}
                            >
                                {s}
                            </button>
                        {/each}
                    </div>
                {/if}
            </div>
        {:else}
            {#each chat.messages as message (message.id)}
                <div class="lava-chat__message lava-chat__message--{message.role}">
                    <div class="lava-chat__role">
                        {message.role === 'user'
                            ? 'You'
                            : message.role === 'assistant'
                              ? 'Lava'
                              : message.role}
                    </div>
                    {#if message.role === 'assistant'}
                        <div
                            class="lava-chat__work"
                            aria-busy={isActiveResponse(message) && isBusy}
                        >
                            <div
                                class="lava-chat__work-status"
                                role="status"
                                aria-live="polite"
                                aria-atomic="true"
                            >
                                {#if isActiveResponse(message) && isBusy}
                                    <span class="lava-chat__work-indicator" aria-hidden="true"></span>
                                {/if}
                                {responseStatus(message)}
                            </div>
                            {#each message.parts as part, partIndex}
                                {#if part.type === 'reasoning'}
                                    <details class="lava-chat__reasoning">
                                        <summary>
                                            {part.state === 'streaming' && !hasText(message)
                                                ? 'Thinking…'
                                                : 'Reasoning'}
                                        </summary>
                                        <div class="lava-chat__reasoning-text">{part.text}</div>
                                    </details>
                                {:else if isToolUIPart(part)}
                                    <div class="lava-chat__tool-card">
                                        <div class="lava-chat__tool-card-header">
                                            <span>{toolStatus(part)}</span>
                                            {#if toolServerName(part)}
                                                <span class="lava-chat__tool-server">
                                                    {toolServerName(part)}
                                                </span>
                                            {/if}
                                        </div>
                                        {#if part.state === 'approval-requested' &&
                                        !part.approval.isAutomatic}
                                            <p class="lava-chat__tool-copy">
                                                Review the exact input before this external tool runs.
                                            </p>
                                            <pre class="lava-chat__tool-value">{formatToolValue(
                                                    part.input,
                                                )}</pre>
                                            <div class="lava-chat__tool-actions">
                                                <button
                                                    type="button"
                                                    disabled={respondingApprovalIds.includes(
                                                        part.approval.id,
                                                    )}
                                                    onclick={() =>
                                                        void respondToApproval(part, false)}
                                                >
                                                    Deny
                                                </button>
                                                <button
                                                    type="button"
                                                    class="mod-cta"
                                                    disabled={respondingApprovalIds.includes(
                                                        part.approval.id,
                                                    )}
                                                    onclick={() =>
                                                        void respondToApproval(part, true)}
                                                >
                                                    Allow once
                                                </button>
                                                <details class="lava-chat__tool-more">
                                                    <summary>More</summary>
                                                    <button
                                                        type="button"
                                                        onclick={() =>
                                                            void respondToApproval(
                                                                part,
                                                                true,
                                                                'conversation',
                                                            )}
                                                    >
                                                        Allow for this chat
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onclick={() =>
                                                            void respondToApproval(
                                                                part,
                                                                true,
                                                                'always',
                                                            )}
                                                    >
                                                        Always allow this tool
                                                    </button>
                                                </details>
                                            </div>
                                        {:else if part.state === 'output-error'}
                                            <pre class="lava-chat__tool-value lava-chat__tool-value--error"
                                                >{part.errorText}</pre
                                            >
                                        {:else if part.state === 'output-available' &&
                                        getToolName(part) !== 'readNote'}
                                            {#if toolExternalUrl(part)}
                                                <a
                                                    class="lava-chat__tool-link"
                                                    href={toolExternalUrl(part)}
                                                >
                                                    Open result
                                                </a>
                                            {/if}
                                            <details class="lava-chat__tool-details">
                                                <summary>Details</summary>
                                                <pre class="lava-chat__tool-value"
                                                    >{formatToolValue(part.output)}</pre
                                                >
                                            </details>
                                        {/if}
                                    </div>
                                {:else if part.type === 'text' && part.text}
                                    <div class="lava-chat__bubble lava-chat__bubble--markdown">
                                        {@html renderAssistantMarkdown(part.text)}
                                        {#if showStreamingCursor(message, partIndex)}
                                            <span class="lava-chat__streaming-cursor" aria-hidden="true"></span>
                                        {/if}
                                    </div>
                                {/if}
                            {/each}
                            {#if isActiveResponse(message) && chat.status === 'error' && !showAuthError}
                                <div class="lava-chat__work-error" role="alert">
                                    <span>Something went wrong. Please try again.</span>
                                    <button
                                        type="button"
                                        class="lava-chat__work-retry"
                                        onclick={handleRetry}
                                        aria-label="Retry response"
                                    >
                                        Retry response
                                    </button>
                                </div>
                            {/if}
                        </div>
                    {:else}
                        <div class="lava-chat__bubble">
                            {#each messageTextSegments(message) as segment}
                                {#if segment.mention}
                                    <span class="lava-chat__note-mention">{segment.text}</span>
                                {:else}
                                    {segment.text}
                                {/if}
                            {/each}
                        </div>
                    {/if}
                </div>
            {/each}
            {#if showResponsePlaceholder && !showAuthError}
                <div class="lava-chat__message lava-chat__message--assistant">
                    <div class="lava-chat__role">Lava</div>
                    <div class="lava-chat__work" aria-busy={isBusy}>
                        <div
                            class="lava-chat__work-status"
                            role="status"
                            aria-live="polite"
                            aria-atomic="true"
                        >
                            {#if isBusy}
                                <span class="lava-chat__work-indicator" aria-hidden="true"></span>
                            {/if}
                            {responseStatus()}
                        </div>
                        {#if chat.status === 'error'}
                            <div class="lava-chat__work-error" role="alert">
                                <span>Something went wrong. Please try again.</span>
                                <button
                                    type="button"
                                    class="lava-chat__work-retry"
                                    onclick={handleRetry}
                                    aria-label="Retry response"
                                >
                                    Retry response
                                </button>
                            </div>
                        {/if}
                    </div>
                </div>
            {/if}
        {/if}
    </div>

    {#if showAuthError}
        <div class="lava-chat__error lava-chat__error--auth">
            <span>Sign in to continue.</span>
            <button type="button" class="lava-chat__error-action" onclick={() => onOpenAuth?.()}>
                Sign in
            </button>
        </div>
    {/if}

    {#if isAuthenticated}
        <form class="lava-chat__input-area" onsubmit={handleSubmit}>
            <div class="lava-chat__mode-bar">
                <div class="lava-chat__mode-switch" role="group" aria-label="Chat mode">
                    <button
                        type="button"
                        class:lava-chat__mode-option--active={mode === 'chat'}
                        aria-pressed={mode === 'chat'}
                        onclick={() => onModeChange?.('chat')}
                    >
                        Chat
                    </button>
                    <button
                        type="button"
                        class:lava-chat__mode-option--active={mode === 'agent'}
                        aria-pressed={mode === 'agent'}
                        onclick={() => onModeChange?.('agent')}
                    >
                        Agent
                    </button>
                </div>
                {#if mode === 'agent'}
                    <span class="lava-chat__mode-summary">
                        {agentToolCounts.auto} auto · {agentToolCounts.ask} ask
                    </span>
                {/if}
            </div>
            {#if mode === 'agent' && !hasConfiguredMcpServers}
                <div class="lava-chat__agent-notice" role="status">
                    Configure an MCP server in Settings → Getlava to add Agent tools.
                </div>
            {/if}
            {#if agentWarning}
                <div class="lava-chat__agent-notice lava-chat__agent-notice--warning" role="alert">
                    {agentWarning}
                </div>
            {/if}
            <div class="lava-chat__input-wrapper">
                <div class="lava-chat__input-backdrop" aria-hidden="true">
                    <div
                        class="lava-chat__input-backdrop-content"
                        style:transform={`translate(${-inputScrollLeft}px, ${-inputScrollTop}px)`}
                    >
                        {#each inputSegments as segment}
                            {#if segment.mention}
                                <span class="lava-chat__note-mention">{segment.text}</span>
                            {:else}
                                {segment.text}
                            {/if}
                        {/each}
                    </div>
                </div>
                <textarea
                    bind:this={textareaEl}
                    class="lava-chat__input"
                    value={input}
                    oninput={handleInput}
                    onkeydown={handleKeyDown}
                    onscroll={handleInputScroll}
                    placeholder="Message Lava…"
                    aria-label="Message Lava"
                    rows="2"
                ></textarea>
                <div class="lava-chat__actions">
                    {#if isBusy}
                        <button
                            type="button"
                            class="lava-chat__stop"
                            {@attach stopIcon}
                            onclick={handleStop}
                            aria-label="Stop"
                        ></button>
                    {:else}
                        <button
                            type="submit"
                            class="lava-chat__send"
                            {@attach sendIcon}
                            disabled={!input.trim() || hasPendingApproval}
                            aria-label="Send"
                        ></button>
                    {/if}
                </div>
            </div>
        </form>
    {:else}
        <div class="lava-chat__signin-prompt">
            <span>Sign in to send a message.</span>
            <a
                href="#sign-in"
                class="lava-chat__signin-link"
                onclick={(event) => {
                    event.preventDefault();
                    onOpenAuth?.();
                }}
            >
                Sign In
            </a>
        </div>
    {/if}
</div>
