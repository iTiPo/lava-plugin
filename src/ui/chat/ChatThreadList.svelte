<script lang="ts">
    import type { Attachment } from 'svelte/attachments';
    import { setIcon } from 'obsidian';
    import type { ChatSession } from '../../chat/session-types';

    const profileIcon: Attachment<HTMLButtonElement> = (element) => {
        setIcon(element, 'user');
    };

    const plusIcon: Attachment<HTMLSpanElement> = (element) => {
        setIcon(element, 'plus');
    };

    interface Props {
        sessions: ChatSession[];
        activeSessionId: string;
        showProfileIcon?: boolean;
        onSelect: (id: string) => void;
        onNew: () => void;
        onProfileClick?: () => void;
    }

    let {
        sessions,
        activeSessionId,
        showProfileIcon = false,
        onSelect,
        onNew,
        onProfileClick,
    }: Props = $props();

    function handleItemKeydown(event: KeyboardEvent, id: string): void {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onSelect(id);
    }
</script>

<aside class="lava-chat-thread-list" aria-label="Chats">
    <div class="lava-chat-thread-list__toolbar">
        <p class="lava-chat-thread-list__label">
            <span class="lava-chat-thread-list__label-dot" aria-hidden="true"></span>
            Chats
        </p>
        {#if showProfileIcon}
            <button
                type="button"
                class="lava-chat-thread-list__profile"
                {@attach profileIcon}
                onclick={() => onProfileClick?.()}
                aria-label="Account"
            ></button>
        {/if}
    </div>

    <button type="button" class="lava-chat-thread-list__new" onclick={onNew}>
        <span class="lava-chat-thread-list__new-icon" {@attach plusIcon}></span>
        New chat
    </button>

    {#if sessions.length === 0}
        <p class="lava-chat-thread-list__empty">No chats yet. Start one above.</p>
    {:else}
        <ul class="lava-chat-thread-list__items" role="listbox" aria-label="Chat sessions">
            {#each sessions as session (session.id)}
                <li
                    class="lava-chat-thread-list__item"
                    class:lava-chat-thread-list__item--active={session.id === activeSessionId}
                    role="option"
                    aria-selected={session.id === activeSessionId}
                    tabindex="0"
                    onclick={() => onSelect(session.id)}
                    onkeydown={(event) => handleItemKeydown(event, session.id)}
                >
                    <span
                        class="lava-chat-thread-list__item-indicator"
                        aria-hidden="true"
                    ></span>
                    <span class="lava-chat-thread-list__item-title">{session.title}</span>
                </li>
            {/each}
        </ul>
    {/if}
</aside>
