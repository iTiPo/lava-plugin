import { z } from 'zod';
import type { AuthStore } from '../auth/auth-store';
import type { LavaConfig } from '../config';

/** Fallback when catalog fetch fails or default is missing. */
export const FALLBACK_DEFAULT_MODEL_ID = 'deepseek-v4-flash-0731';

const catalogModelSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    default: z.boolean(),
});

const modelListSchema = z.object({
    object: z.literal('list'),
    data: z.array(catalogModelSchema).min(1),
});

export type CatalogModel = z.infer<typeof catalogModelSchema>;

type ModelsErrorCode = 'AUTH_REQUIRED' | 'ERROR';

export type ModelsFetchResult =
    | { ok: true; models: CatalogModel[]; defaultModelId: string }
    | { ok: false; code: ModelsErrorCode; message: string };

export function resolveDefaultModelId(models: readonly CatalogModel[]): string {
    return models.find((model) => model.default)?.id ?? FALLBACK_DEFAULT_MODEL_ID;
}

export async function fetchModels(
    authStore: AuthStore,
    config: LavaConfig,
): Promise<ModelsFetchResult> {
    const token = await authStore.getAccessToken();
    if (!token) {
        return modelsError('AUTH_REQUIRED', 'Sign in to continue.');
    }

    try {
        const response = await window.fetch(`${config.apiBaseUrl}/models`, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        if (response.status === 200) {
            const parsed = modelListSchema.safeParse(await response.json());
            if (!parsed.success) {
                return modelsError('ERROR', 'Could not load models. Try again.');
            }
            return {
                ok: true,
                models: parsed.data.data,
                defaultModelId: resolveDefaultModelId(parsed.data.data),
            };
        }

        if (response.status === 401) {
            return modelsError('AUTH_REQUIRED', 'Sign in to continue.');
        }

        return modelsError('ERROR', 'Could not load models. Try again.');
    } catch {
        return modelsError('ERROR', 'Could not load models. Try again.');
    }
}

function modelsError(code: ModelsErrorCode, message: string): ModelsFetchResult {
    return { ok: false, code, message };
}
