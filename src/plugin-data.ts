import type { Plugin } from 'obsidian';
import type { LavaPluginData } from './auth/auth-types';

const writeQueues = new WeakMap<Plugin, Promise<void>>();

export async function loadPluginData(plugin: Plugin): Promise<LavaPluginData> {
    return ((await plugin.loadData()) as LavaPluginData | null) ?? {};
}

export async function updatePluginData(
    plugin: Plugin,
    update: (current: LavaPluginData) => LavaPluginData,
): Promise<void> {
    const previous = writeQueues.get(plugin) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
        const current = await loadPluginData(plugin);
        await plugin.saveData(update(current));
    });
    writeQueues.set(plugin, next);
    try {
        await next;
    } finally {
        if (writeQueues.get(plugin) === next) writeQueues.delete(plugin);
    }
}
