<script lang="ts">
    import type { Attachment } from 'svelte/attachments';
    import { setIcon } from 'obsidian';
    import LavaMark from './LavaMark.svelte';
    import { LAVA_PRIVACY_URL, LAVA_TERMS_URL, openLegalUrl } from './legal-urls';

    const backIcon: Attachment<HTMLSpanElement> = (element) => {
        setIcon(element, 'arrow-left');
    };

    interface Props {
        initialEmail?: string;
        showBack?: boolean;
        onBack?: () => void;
        onSubmit: (email: string) => Promise<void>;
    }

    let { initialEmail = '', showBack = false, onBack, onSubmit }: Props = $props();

    let email = $state('');
    let error = $state('');
    let submitting = $state(false);

    $effect.pre(() => {
        email = initialEmail;
    });

    function validateEmail(value: string): string | null {
        const trimmed = value.trim();
        if (!trimmed) return 'Enter your email address.';
        if (!trimmed.includes('@')) return 'Enter a valid email address.';
        return null;
    }

    async function handleSubmit(event: SubmitEvent) {
        event.preventDefault();
        const validationError = validateEmail(email);
        if (validationError) {
            error = validationError;
            return;
        }

        error = '';
        submitting = true;
        try {
            await onSubmit(email.trim());
        } catch (submitError) {
            error =
                submitError instanceof Error
                    ? submitError.message
                    : 'Could not send sign-in link. Try again.';
        } finally {
            submitting = false;
        }
    }
</script>

<div class="lava-auth" class:lava-auth--with-topbar={showBack}>
    {#if showBack}
        <div class="lava-auth__topbar">
            <button type="button" class="lava-auth__back" onclick={() => onBack?.()}>
                <span class="lava-auth__back-icon" {@attach backIcon}></span>
                Back to chats
            </button>
        </div>
    {/if}

    <div class="lava-auth__stage">
        <div class="lava-auth__orb lava-auth__orb--primary" aria-hidden="true"></div>
        <div class="lava-auth__orb lava-auth__orb--secondary" aria-hidden="true"></div>

        <div class="lava-auth__content">
            <header class="lava-auth__header">
                <LavaMark />
                <div class="lava-auth__brand-row">
                    <span class="lava-auth__brand-name">LAVA</span>
                    <span class="lava-auth__brand-badge">for Obsidian</span>
                </div>
            </header>

            <div class="lava-auth__hero">
                <p class="lava-auth__eyebrow">
                    <span class="lava-auth__eyebrow-dot" aria-hidden="true"></span>
                    Closed beta
                </p>
                <h1 class="lava-auth__headline">
                    Sign in to think with the <em>notes</em> you trust.
                </h1>
                <p class="lava-auth__lede">
                    Lava brings the ideas you have already captured into the conversation—so your vault
                    becomes active material for better thinking.
                </p>
            </div>

            <div class="lava-auth__card">
                <form class="lava-auth__fields" onsubmit={(event) => void handleSubmit(event)}>
                    <span class="lava-auth__card-label">Sign in with email</span>
                    <h2 class="lava-auth__card-title">Your next good thought could be in here.</h2>
                    <p class="lava-auth__card-copy">
                        Enter your email and we will send a magic link to open Lava in Obsidian.
                    </p>

                    <label class="lava-auth__label" for="lava-auth-email">Email</label>
                    <input
                        id="lava-auth-email"
                        class="lava-auth__input"
                        type="email"
                        autocomplete="email"
                        placeholder="you@example.com"
                        bind:value={email}
                        disabled={submitting}
                    />
                    {#if error}
                        <p class="lava-auth__error" role="alert">{error}</p>
                    {/if}
                    <button class="lava-auth__button" type="submit" disabled={submitting}>
                        {submitting ? 'Sending…' : 'Send sign-in link'}
                    </button>
                    <p class="lava-auth__hint">Magic link · no password required</p>
                </form>

                <p class="lava-auth__legal">
                    By continuing, you agree to the
                    <a
                        class="lava-auth__legal-link"
                        href={LAVA_TERMS_URL}
                        onclick={(event) => {
                            event.preventDefault();
                            openLegalUrl(LAVA_TERMS_URL);
                        }}
                    >
                        Terms of Use
                    </a>
                    and
                    <a
                        class="lava-auth__legal-link"
                        href={LAVA_PRIVACY_URL}
                        onclick={(event) => {
                            event.preventDefault();
                            openLegalUrl(LAVA_PRIVACY_URL);
                        }}
                    >
                        Privacy Policy
                    </a>.
                </p>
            </div>
        </div>
    </div>
</div>
