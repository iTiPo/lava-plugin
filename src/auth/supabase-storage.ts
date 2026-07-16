import type { App } from 'obsidian';
import type { SupportedStorage } from '@supabase/supabase-js';

export function createSupabaseStorage(app: App): SupportedStorage {
    return {
        getItem: (key: string) => {
            return app.secretStorage.getSecret(secretId(key));
        },
        setItem: (key: string, value: string) => {
            app.secretStorage.setSecret(secretId(key), value);
        },
        removeItem: (key: string) => {
            app.secretStorage.setSecret(secretId(key), '');
        },
    };
}

const SECRET_ID_PREFIX = 'lava-plugin-auth-';
const MAX_SECRET_ID_LENGTH = 64;

function secretId(key: string): string {
    const sanitizedKey = key.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    return `${SECRET_ID_PREFIX}${sanitizedKey}`.slice(0, MAX_SECRET_ID_LENGTH);
}
