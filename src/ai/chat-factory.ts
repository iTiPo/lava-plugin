import { Chat } from '@ai-sdk/svelte';
import { DirectChatTransport, type ChatInit } from 'ai';
import type { App } from 'obsidian';
import type { AuthStore } from '../auth/auth-store';
import { createLavaAgent } from './agent';
import type { LavaChat, LavaUIMessage } from './chat-types';

export type { LavaChat, LavaUIMessage } from './chat-types';

export interface CreateChatOptions {
    id?: string;
    messages?: LavaUIMessage[];
    onFinish?: ChatInit<LavaUIMessage>['onFinish'];
    onError?: ChatInit<LavaUIMessage>['onError'];
}

/**
 * Create a `Chat` instance wired to an in-process agent with vault tools.
 */
export function createChat(
    app: App,
    authStore: AuthStore,
    options?: CreateChatOptions,
): LavaChat {
    const agent = createLavaAgent(app, authStore);
    return new Chat<LavaUIMessage>({
        id: options?.id,
        messages: options?.messages ?? [],
        transport: new DirectChatTransport({ agent }),
        onFinish: options?.onFinish,
        onError: options?.onError,
    });
}
