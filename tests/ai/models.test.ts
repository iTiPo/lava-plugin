import { describe, expect, it } from 'vitest';
import { FALLBACK_DEFAULT_MODEL_ID, resolveDefaultModelId } from '../../src/ai/models';

describe('resolveDefaultModelId', () => {
    it('returns the catalog entry marked default', () => {
        expect(
            resolveDefaultModelId([
                { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', default: false },
                { id: 'deepseek-v4-flash-0731', name: 'DeepSeek V4 Flash', default: true },
            ]),
        ).toBe('deepseek-v4-flash-0731');
    });

    it('falls back when no default flag is true', () => {
        expect(
            resolveDefaultModelId([
                { id: 'grok-4.5', name: 'Grok 4.5', default: false },
            ]),
        ).toBe(FALLBACK_DEFAULT_MODEL_ID);
    });
});
