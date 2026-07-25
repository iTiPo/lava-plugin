import { describe, expect, it } from 'vitest';
import { headersToRecord } from '../../src/mcp/types';

describe('headersToRecord', () => {
    it('returns undefined when there are no usable headers', () => {
        expect(headersToRecord([])).toBeUndefined();
        expect(
            headersToRecord([{ id: '1', name: '  ', value: 'x' }]),
        ).toBeUndefined();
    });

    it('keeps values as-is and skips empty names', () => {
        expect(
            headersToRecord([
                { id: '1', name: ' Authorization ', value: 'Bearer abc' },
                { id: '2', name: '', value: 'ignored' },
                { id: '3', name: 'X-Custom', value: '  spaced  ' },
            ]),
        ).toEqual({
            Authorization: 'Bearer abc',
            'X-Custom': '  spaced  ',
        });
    });

    it('lets later duplicate names win', () => {
        expect(
            headersToRecord([
                { id: '1', name: 'X-Test', value: 'one' },
                { id: '2', name: 'X-Test', value: 'two' },
            ]),
        ).toEqual({ 'X-Test': 'two' });
    });
});
