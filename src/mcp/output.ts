const MAX_STRING_LENGTH = 16_000;
const MAX_ARRAY_LENGTH = 100;
const MAX_DEPTH = 8;

export function sanitizeToolValue(value: unknown, depth = 0): unknown {
    if (depth >= MAX_DEPTH) return '[truncated: maximum depth]';
    if (typeof value === 'string') {
        return value.length > MAX_STRING_LENGTH
            ? `${value.slice(0, MAX_STRING_LENGTH)}… [truncated]`
            : value;
    }
    if (
        value === null ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        typeof value === 'undefined'
    ) {
        return value;
    }
    if (Array.isArray(value)) {
        const result = value
            .slice(0, MAX_ARRAY_LENGTH)
            .map((entry) => sanitizeToolValue(entry, depth + 1));
        if (value.length > MAX_ARRAY_LENGTH) result.push('[truncated: more items]');
        return result;
    }
    if (typeof value === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(value)) {
            if (key === '_meta' || /authorization|token|secret|password/i.test(key)) {
                continue;
            }
            if (
                (key === 'data' || key === 'blob') &&
                typeof entry === 'string' &&
                entry.length > MAX_STRING_LENGTH
            ) {
                result[key] = '[binary content omitted]';
            } else {
                result[key] = sanitizeToolValue(entry, depth + 1);
            }
        }
        return result;
    }
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'symbol') return value.description ?? '[symbol]';
    if (typeof value === 'function') return '[function]';
    return undefined;
}

export function findExternalReference(value: unknown): string | undefined {
    const candidates = collectStrings(value);
    return candidates.find((candidate) => /^https?:\/\//i.test(candidate));
}

function collectStrings(value: unknown, depth = 0): string[] {
    if (depth > 4) return [];
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) {
        return value.flatMap((entry) => collectStrings(entry, depth + 1));
    }
    if (value && typeof value === 'object') {
        const object = value as Record<string, unknown>;
        const preferred = ['url', 'html_url', 'uri']
            .flatMap((key) => collectStrings(object[key], depth + 1));
        return [
            ...preferred,
            ...Object.values(object).flatMap((entry) => collectStrings(entry, depth + 1)),
        ];
    }
    return [];
}
