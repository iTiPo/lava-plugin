export async function fingerprintToolDefinition(value: unknown): Promise<string> {
    const bytes = new TextEncoder().encode(stableStringify(value));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

export function stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        const object = value as Record<string, unknown>;
        return `{${Object.keys(object)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
            .join(',')}}`;
    }
    // JSON.stringify(undefined) / functions yield undefined, not a string.
    const json = JSON.stringify(value);
    return typeof json === 'string' ? json : 'null';
}
