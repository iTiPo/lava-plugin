<script lang="ts">
    import type { Attachment } from 'svelte/attachments';
    import { setIcon } from 'obsidian';
    import LavaMark from './LavaMark.svelte';

    const backIcon: Attachment<HTMLSpanElement> = (element) => {
        setIcon(element, 'arrow-left');
    };

    interface Props {
        email: string;
        error?: string;
        onBack: () => void;
    }

    let { email, error = '', onBack }: Props = $props();
</script>

<div class="lava-auth lava-auth--with-topbar">
    <div class="lava-auth__topbar">
        <button type="button" class="lava-auth__back" onclick={onBack}>
            <span class="lava-auth__back-icon" {@attach backIcon}></span>
            Back
        </button>
    </div>

    <div class="lava-auth__stage">
        <div class="lava-auth__orb lava-auth__orb--primary" aria-hidden="true"></div>
        <div class="lava-auth__orb lava-auth__orb--secondary" aria-hidden="true"></div>

        <div class="lava-auth__content">
            <header class="lava-auth__header">
                <LavaMark />
                <div class="lava-auth__brand-row">
                    <span class="lava-auth__brand-name">GETLAVA</span>
                    <span class="lava-auth__brand-badge">for Obsidian</span>
                </div>
            </header>

            <div class="lava-auth__card lava-auth__card--message">
                <div class="lava-auth__message-icon" aria-hidden="true">✓</div>
                <h2 class="lava-auth__card-title">Check your email</h2>
                <p class="lava-auth__card-copy">
                    Follow the link we sent to <strong>{email}</strong> to finish signing in. The link
                    opens directly in Obsidian.
                </p>
                {#if error}
                    <p class="lava-auth__error" role="alert">{error}</p>
                {/if}
            </div>
        </div>
    </div>
</div>
