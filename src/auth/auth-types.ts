import type { McpPluginData } from '../mcp/types';

export type AuthStatus = 'unknown' | 'anonymous' | 'pending_email' | 'authenticated';

export type AuthRoute = 'welcome' | 'check_email' | 'chats' | 'profile';

export type PersistedAuthStatus = 'anonymous' | 'pending_email' | 'authenticated';

export interface AuthUser {
    id: string;
    email: string;
}

export interface PersistedAuthData {
    status: PersistedAuthStatus;
    email?: string;
}

export interface LavaPluginData {
    auth?: PersistedAuthData;
    mcp?: McpPluginData;
}

export interface MagicLinkParams {
    action: string;
    token_hash?: string;
    type?: string;
    [key: string]: string | undefined;
}
