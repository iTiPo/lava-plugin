import { z } from 'zod';
import type { AuthStore } from '../auth/auth-store';
import type { LavaConfig } from '../config';

const httpFetch = window.fetch.bind(window);

const usageSummarySchema = z.object({
    percent_used: z.number(),
});

const apiErrorSchema = z.object({
    error: z.object({
        code: z.string(),
        message: z.string(),
    }),
});

type UsageErrorCode = 'AUTH_REQUIRED' | 'NO_ACTIVE_PLAN' | 'ERROR';

export type UsageFetchResult =
    | { ok: true; percentUsed: number }
    | { ok: false; code: UsageErrorCode; message: string };

export async function fetchUsage(
    authStore: AuthStore,
    config: LavaConfig,
): Promise<UsageFetchResult> {
    const token = await authStore.getAccessToken();
    if (!token) {
        return usageError('AUTH_REQUIRED', 'Sign in to continue.');
    }

    try {
        const response = await httpFetch(`${config.apiBaseUrl}/usage`, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        if (response.status === 200) {
            const parsed = usageSummarySchema.safeParse(await response.json());
            if (!parsed.success) {
                return usageError('ERROR', 'Could not load usage. Try again.');
            }
            return { ok: true, percentUsed: parsed.data.percent_used };
        }

        if (response.status === 401) {
            const parsed = apiErrorSchema.safeParse(await response.json());
            return usageError(
                'AUTH_REQUIRED',
                parsed.success ? parsed.data.error.message : '',
            );
        }

        if (response.status === 402) {
            const parsed = apiErrorSchema.safeParse(await response.json());
            return usageError(
                'NO_ACTIVE_PLAN',
                parsed.success ? parsed.data.error.message : '',
            );
        }

        return usageError('ERROR', 'Could not load usage. Try again.');
    } catch {
        return usageError('ERROR', 'Could not load usage. Try again.');
    }
}

function usageError(code: UsageErrorCode, message: string): UsageFetchResult {
    return { ok: false, code, message };
}
