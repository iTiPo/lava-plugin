<script lang="ts">
    import { onMount } from 'svelte';
    import type { Attachment } from 'svelte/attachments';
    import { setIcon } from 'obsidian';
    import type { AuthStore } from '../../auth/auth-store';
    import { fetchUsage } from '../../ai/usage';
    import type { LavaConfig } from '../../config';

    const backIcon: Attachment<HTMLSpanElement> = (element) => {
        setIcon(element, 'arrow-left');
    };

    interface Props {
        authStore: AuthStore;
        config: LavaConfig;
        onBack: () => void;
        onSignOut: () => Promise<void>;
    }

    let { authStore, config, onBack, onSignOut }: Props = $props();

    let email = $state('');
    let percentUsed = $state<number | null>(null);
    let usageLoading = $state(true);
    let usageError = $state('');
    let noActivePlan = $state(false);
    let signingOut = $state(false);
    let signOutError = $state('');

    const meterWidth = $derived(
        percentUsed === null ? 0 : Math.max(0, Math.min(100, percentUsed)),
    );

    async function loadUsage(): Promise<void> {
        usageLoading = true;
        usageError = '';
        noActivePlan = false;
        percentUsed = null;

        const result = await fetchUsage(authStore, config);
        if (result.ok) {
            percentUsed = result.percentUsed;
            usageLoading = false;
            return;
        }

        if (result.code === 'NO_ACTIVE_PLAN') {
            noActivePlan = true;
            usageError = '';
        } else {
            usageError = result.message;
        }
        usageLoading = false;
    }

    async function handleSignOut(): Promise<void> {
        signOutError = '';
        signingOut = true;
        try {
            await onSignOut();
        } catch (error) {
            signOutError =
                error instanceof Error ? error.message : 'Could not sign out. Try again.';
            signingOut = false;
        }
    }

    onMount(() => {
        email = authStore.getUser()?.email ?? authStore.getEmail();
        void loadUsage();
    });
</script>

<div class="lava-auth lava-auth--with-topbar">
    <div class="lava-auth__topbar">
        <button type="button" class="lava-auth__back" onclick={onBack} disabled={signingOut}>
            <span class="lava-auth__back-icon" {@attach backIcon}></span>
            Back
        </button>
    </div>

    <div class="lava-auth__stage">
        <div class="lava-auth__content lava-profile">
            <h1 class="lava-auth__card-title">Account</h1>
            <p class="lava-auth__card-copy">Your Getlava profile</p>

            <div class="lava-auth__card lava-profile__card">
                <div class="lava-profile__section">
                    <span class="lava-auth__label">Email</span>
                    <p class="lava-profile__email">{email || '—'}</p>
                </div>

                <div class="lava-profile__section">
                    <div class="lava-profile__usage-header">
                        <span class="lava-auth__label">Usage</span>
                        {#if !usageLoading && percentUsed !== null}
                            <span class="lava-profile__usage-value">{percentUsed}% used</span>
                        {/if}
                    </div>

                    {#if usageLoading}
                        <div class="lava-profile__meter lava-profile__meter--loading" aria-hidden="true">
                            <div class="lava-profile__meter-fill"></div>
                        </div>
                        <p class="lava-profile__hint">Loading usage…</p>
                    {:else if noActivePlan}
                        <div class="lava-profile__meter" aria-hidden="true">
                            <div class="lava-profile__meter-fill" style="width: 0%"></div>
                        </div>
                        <p class="lava-profile__hint">No active plan</p>
                    {:else if usageError}
                        <p class="lava-auth__error">{usageError}</p>
                        <button
                            type="button"
                            class="lava-profile__retry"
                            onclick={() => void loadUsage()}
                            disabled={signingOut}
                        >
                            Retry
                        </button>
                    {:else}
                        <div
                            class="lava-profile__meter"
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={meterWidth}
                            aria-label="Plan usage"
                        >
                            <div class="lava-profile__meter-fill" style="width: {meterWidth}%"></div>
                        </div>
                    {/if}
                </div>

                {#if signOutError}
                    <p class="lava-auth__error">{signOutError}</p>
                {/if}

                <button
                    type="button"
                    class="lava-profile__sign-out"
                    onclick={() => void handleSignOut()}
                    disabled={signingOut}
                >
                    {signingOut ? 'Signing out…' : 'Sign out'}
                </button>
            </div>
        </div>
    </div>
</div>
