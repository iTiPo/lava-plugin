declare const __LAVA_SUPABASE_URL__: string;
declare const __LAVA_SUPABASE_ANON_KEY__: string;
declare const __LAVA_API_BASE_URL__: string;

export interface LavaConfig {
    supabaseUrl: string;
    supabaseAnonKey: string;
    apiBaseUrl: string;
}

export function loadLavaConfig(): LavaConfig {
    return {
        supabaseUrl: __LAVA_SUPABASE_URL__,
        supabaseAnonKey: __LAVA_SUPABASE_ANON_KEY__,
        apiBaseUrl: __LAVA_API_BASE_URL__,
    };
}
