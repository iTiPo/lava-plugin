import type { Chat } from '@ai-sdk/svelte';
import type { InferAgentUIMessage } from 'ai';
import type { NoteMention } from '../notes/parse-mentions';
import type { createLavaAgent } from './agent';

export type LavaAgent = ReturnType<typeof createLavaAgent>;
export type LavaUIMessage = InferAgentUIMessage<LavaAgent>;
export type LavaChat = Chat<LavaUIMessage>;

export interface LavaMessageMetadata {
    noteMentions?: NoteMention[];
}

export function getNoteMentions(metadata: unknown): NoteMention[] | undefined {
    if (!metadata || typeof metadata !== 'object') return undefined;

    const noteMentions = (metadata as LavaMessageMetadata).noteMentions;
    if (!Array.isArray(noteMentions)) return undefined;

    return noteMentions.filter(
        (mention): mention is NoteMention =>
            Boolean(mention) &&
            typeof mention.path === 'string' &&
            typeof mention.start === 'number' &&
            typeof mention.end === 'number',
    );
}
