import { createClient } from '@supabase/supabase-js';
import type { App } from 'obsidian';
import type { LavaConfig } from '../config';
import { createSupabaseStorage } from './supabase-storage';

export function createSupabaseClient(app: App, config: LavaConfig) {
    return createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: {
            flowType: 'pkce',
            storage: createSupabaseStorage(app),
        },
    });
}
