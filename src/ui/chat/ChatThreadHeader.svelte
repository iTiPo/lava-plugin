<script lang="ts">
    import { onMount } from 'svelte';
    import type { Attachment } from 'svelte/attachments';
    import { setIcon } from 'obsidian';
    import type { ChatSession } from '../../chat/session-types';

    const plusIcon: Attachment<HTMLButtonElement> = (element) => {
        setIcon(element, 'plus');
    };

    const profileIcon: Attachment<HTMLButtonElement> = (element) => {
        setIcon(element, 'user');
    };

    const chevronIcon: Attachment<HTMLSpanElement> = (element) => {
        setIcon(element, 'chevron-down');
    };

    interface Props {
        sessions: ChatSession[];
        activeSessionId: string;
        activeTitle: string;
        showProfileIcon?: boolean;
        onSelect: (id: string) => void;
        onNew: () => void;
        onProfileClick?: () => void;
    }

    let {
        sessions,
        activeSessionId,
        activeTitle,
        showProfileIcon = false,
        onSelect,
        onNew,
        onProfileClick,
    }: Props = $props();

    let dropdownOpen = $state(false);
    let headerEl: HTMLElement | undefined = $state();

    function toggleDropdown() {
        dropdownOpen = !dropdownOpen;
    }

    function handleSelect(id: string) {
        onSelect(id);
        dropdownOpen = false;
    }

    function handleNew() {
        onNew();
        dropdownOpen = false;
    }

    function handleItemKeydown(event: KeyboardEvent, id: string): void {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        handleSelect(id);
    }

    onMount(() => {
        function handleClickOutside(event: MouseEvent) {
            if (!headerEl?.contains(event.target as Node)) {
                dropdownOpen = false;
            }
        }
        document.addEventListener('click', handleClickOutside);
        return () => document.removeEventListener('click', handleClickOutside);
    });
</script>

<header class="lava-chat-thread-header" bind:this={headerEl}>
    {#if showProfileIcon}
        <button
            type="button"
            class="lava-chat-thread-header__profile"
            {@attach profileIcon}
            onclick={() => onProfileClick?.()}
            aria-label="Account"
        ></button>
    {/if}

    <button
        type="button"
        class="lava-chat-thread-header__title"
        class:lava-chat-thread-header__title--open={dropdownOpen}
        onclick={toggleDropdown}
        aria-expanded={dropdownOpen}
        aria-haspopup="listbox"
    >
        <span class="lava-chat-thread-header__title-text">{activeTitle}</span>
        <span class="lava-chat-thread-header__chevron" {@attach chevronIcon}></span>
    </button>

    <button
        type="button"
        class="lava-chat-thread-header__new"
        {@attach plusIcon}
        onclick={handleNew}
        aria-label="New chat"
    ></button>

    {#if dropdownOpen}
        <div class="lava-chat-thread-header__dropdown">
            <div class="lava-chat-thread-header__dropdown-header">
                <p class="lava-chat-thread-header__dropdown-label">
                    <span class="lava-chat-thread-header__dropdown-dot" aria-hidden="true"></span>
                    Your chats
                </p>
                <button
                    type="button"
                    class="lava-chat-thread-header__dropdown-new"
                    onclick={handleNew}
                >
                    New chat
                </button>
            </div>

            {#if sessions.length === 0}
                <p class="lava-chat-thread-header__dropdown-empty">No chats yet.</p>
            {:else}
                <ul
                    class="lava-chat-thread-header__dropdown-items"
                    role="listbox"
                    aria-label="Chat sessions"
                >
                    {#each sessions as session (session.id)}
                        <li
                            class="lava-chat-thread-header__dropdown-item"
                            class:lava-chat-thread-header__dropdown-item--active={session.id ===
                                activeSessionId}
                            role="option"
                            aria-selected={session.id === activeSessionId}
                            tabindex="0"
                            onclick={() => handleSelect(session.id)}
                            onkeydown={(event) => handleItemKeydown(event, session.id)}
                        >
                            <span
                                class="lava-chat-thread-header__dropdown-indicator"
                                aria-hidden="true"
                            ></span>
                            <span class="lava-chat-thread-header__dropdown-item-title">
                                {session.title}
                            </span>
                        </li>
                    {/each}
                </ul>
            {/if}
        </div>
    {/if}
</header>
