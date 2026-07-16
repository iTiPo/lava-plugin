import { tool } from 'ai';
import type { App } from 'obsidian';
import { TFile } from 'obsidian';
import { z } from 'zod';

export function createReadNoteTool(app: App) {
    return tool({
        description:
            'Read the full markdown content of a vault note by its vault-relative path.',
        inputSchema: z.object({
            path: z
                .string()
                .describe('Vault-relative path, e.g. "Projects/Idea.md"'),
        }),
        execute: async ({ path }) => {
            const file = app.vault.getAbstractFileByPath(path);
            if (!file || !(file instanceof TFile)) {
                return { error: 'Note not found', path };
            }
            const content = await app.vault.read(file);
            return { path: file.path, content };
        },
    });
}
