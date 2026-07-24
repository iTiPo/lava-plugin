import { describe, expect, it } from 'vitest';
import { fingerprintToolDefinition } from '../../src/mcp/fingerprint';
import { findExternalReference, sanitizeToolValue } from '../../src/mcp/output';

describe('MCP tool safety helpers', () => {
    it('fingerprints objects independently of key order', async () => {
        const first = await fingerprintToolDefinition({
            description: 'Create an issue',
            inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
        });
        const second = await fingerprintToolDefinition({
            inputSchema: { properties: { title: { type: 'string' } }, type: 'object' },
            description: 'Create an issue',
        });

        expect(first).toBe(second);
    });

    it('removes secrets and bounds large output', () => {
        const sanitized = sanitizeToolValue({
            token: 'secret',
            title: 'Issue',
            content: 'x'.repeat(20_000),
            image: { data: 'x'.repeat(20_000) },
        }) as Record<string, unknown>;

        expect(sanitized.token).toBeUndefined();
        expect(String(sanitized.content)).toContain('[truncated]');
        expect(sanitized.image).toEqual({ data: '[binary content omitted]' });
    });

    it('finds external result links', () => {
        expect(
            findExternalReference({
                structuredContent: {
                    html_url: 'https://github.com/getlava/lava-plugin/issues/10',
                },
            }),
        ).toBe('https://github.com/getlava/lava-plugin/issues/10');
    });
});
