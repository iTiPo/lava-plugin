import { APICallError } from 'ai';

const AUTH_ERROR_CODES = new Set(['AUTH_REQUIRED', 'AUTH_INVALID']);

function parseAuthErrorCode(responseBody: string | undefined): string | null {
    if (!responseBody) return null;

    try {
        const parsed = JSON.parse(responseBody) as {
            error?: { code?: string };
        };
        const code = parsed.error?.code;
        return typeof code === 'string' ? code : null;
    } catch {
        return null;
    }
}

export function isAuthApiError(error: unknown): boolean {
    if (APICallError.isInstance(error) && error.statusCode === 401) {
        const code = parseAuthErrorCode(error.responseBody);
        if (code && AUTH_ERROR_CODES.has(code)) {
            return true;
        }
        return true;
    }

    return false;
}
