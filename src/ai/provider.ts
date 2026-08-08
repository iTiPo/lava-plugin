import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModelV4 } from '@ai-sdk/provider';
import type { AuthStore } from '../auth/auth-store';
import { loadLavaConfig } from '../config';

const httpFetch = window.fetch.bind(window);

/**
 * Build a LanguageModel for the configured OpenAI-compatible endpoint.
 */
export function buildModel(authStore: AuthStore, modelId: string): LanguageModelV4 {
    const { apiBaseUrl } = loadLavaConfig();
    const provider = createOpenAICompatible({
        name: 'Getlava API Inference',
        baseURL: apiBaseUrl,
        fetch: async (input, init) => {
            const token = await authStore.getAccessToken();
            const headers = new Headers(init?.headers);
            if (token) {
                headers.set('Authorization', `Bearer ${token}`);
            }
            return httpFetch(input, { ...init, headers });
        },
    });

    return provider(modelId);
}
