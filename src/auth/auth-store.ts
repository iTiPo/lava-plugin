import type { ObsidianProtocolData, Plugin } from 'obsidian';
import type { Session } from '@supabase/supabase-js';
import { loadLavaConfig, type LavaConfig } from '../config';
import { createSupabaseClient } from './supabase-client';
import type { AuthStatus, AuthUser, LavaPluginData, MagicLinkParams } from './auth-types';

type Listener = () => void;
type LavaSupabaseClient = ReturnType<typeof createSupabaseClient>;

const httpFetch = window.fetch.bind(window);

export class AuthStore {
    private status: AuthStatus = 'unknown';
    private email = '';
    private user: AuthUser | null = null;
    private lastError = '';
    private listeners = new Set<Listener>();
    private plugin: Plugin | null = null;
    private supabase: LavaSupabaseClient | null = null;
    private authSubscription: { unsubscribe: () => void } | null = null;

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify(): void {
        for (const listener of this.listeners) {
            listener();
        }
    }

    getStatus(): AuthStatus {
        return this.status;
    }

    getEmail(): string {
        return this.email;
    }

    getUser(): AuthUser | null {
        return this.user;
    }

    getLastError(): string {
        return this.lastError;
    }

    isAuthenticated(): boolean {
        return this.status === 'authenticated';
    }

    async init(plugin: Plugin, config: LavaConfig): Promise<void> {
        this.plugin = plugin;
        this.supabase = createSupabaseClient(plugin.app, config);

        const data = (await plugin.loadData()) as LavaPluginData | null;
        const auth = data?.auth;

        if (auth?.email) {
            this.email = auth.email;
        }

        if (auth?.status === 'pending_email' && auth.email) {
            this.status = 'pending_email';
            this.user = null;
        }

        const {
            data: { session },
        } = await this.supabase.auth.getSession();

        if (session) {
            this.applySession(session);
        } else if (this.status !== 'pending_email') {
            this.status = 'anonymous';
            this.user = null;
        }

        this.authSubscription = this.supabase.auth.onAuthStateChange((_event, session) => {
            if (session) {
                this.applySession(session);
            } else if (this.status === 'authenticated') {
                this.status = 'anonymous';
                this.user = null;
                void this.persist();
                this.notify();
            }
        }).data.subscription;

        void this.supabase.auth.startAutoRefresh();
        this.notify();
    }

    dispose(): void {
        this.authSubscription?.unsubscribe();
        this.authSubscription = null;
        void this.supabase?.auth.stopAutoRefresh();
    }

    async requestMagicLink(email: string): Promise<void> {
        if (!this.supabase) {
            throw new Error('Auth is not initialized.');
        }

        this.lastError = '';
        this.email = email.trim();
        this.status = 'pending_email';
        this.user = null;
        await this.persist();

        const { apiBaseUrl } = loadLavaConfig();

        try {
            const response = await httpFetch(`${apiBaseUrl}/auth/magic-link`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email: this.email }),
            });

            if (!response.ok) {
                let message = 'Could not send sign-in link. Try again.';
                try {
                    const body = (await response.json()) as {
                        error?: { message?: string };
                    };
                    if (body.error?.message) {
                        message = body.error.message;
                    }
                } catch {
                    // keep default message
                }
                throw new Error(message);
            }
        } catch (error) {
            this.lastError =
                error instanceof Error
                    ? error.message
                    : 'Could not send sign-in link. Try again.';
            this.status = 'anonymous';
            await this.persist();
            this.notify();
            throw error instanceof Error
                ? error
                : new Error(this.lastError);
        }

        this.notify();
    }

    async completeMagicLink(params: ObsidianProtocolData | MagicLinkParams): Promise<void> {
        if (!this.supabase) {
            this.lastError = 'Auth is not initialized.';
            this.notify();
            return;
        }

        this.lastError = '';
        const tokenHash = params.token_hash;

        if (!tokenHash) {
            this.lastError = 'Invalid sign-in link. Request a new one.';
            this.notify();
            return;
        }

        const { data, error } = await this.supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: 'magiclink',
        });

        if (error || !data.session) {
            this.lastError = error?.message ?? 'Sign-in link expired. Request a new one.';
            this.notify();
            return;
        }

        this.applySession(data.session);
    }

    async getAccessToken(): Promise<string | null> {
        if (!this.supabase) return null;

        const {
            data: { session },
        } = await this.supabase.auth.getSession();

        return session?.access_token ?? null;
    }

    async clearSession(): Promise<void> {
        if (!this.supabase) return;

        this.lastError = '';
        const { error } = await this.supabase.auth.signOut({ scope: 'local' });
        if (error) {
            this.lastError = error.message;
            this.notify();
            throw error;
        }

        this.status = 'anonymous';
        this.user = null;
        await this.persist();
        this.notify();
    }

    async backFromCheckEmail(): Promise<void> {
        this.status = 'anonymous';
        this.lastError = '';
        await this.persist();
        this.notify();
    }

    private applySession(session: Session): void {
        const email = session.user.email ?? this.email;
        this.email = email;
        this.user = {
            id: session.user.id,
            email,
        };
        this.status = 'authenticated';
        this.lastError = '';
        void this.persist();
        this.notify();
    }

    private async persist(): Promise<void> {
        if (!this.plugin) return;

        const existing = ((await this.plugin.loadData()) as LavaPluginData | null) ?? {};
        const persistedStatus =
            this.status === 'authenticated'
                ? 'authenticated'
                : this.status === 'pending_email'
                    ? 'pending_email'
                    : 'anonymous';

        await this.plugin.saveData({
            ...existing,
            auth: {
                status: persistedStatus,
                email: this.email || undefined,
            },
        });
    }
}
