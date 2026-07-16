import type { ChatIndex } from '../chat/session-types';

export function isReturningUser(index: ChatIndex): boolean {
    return index.sessions.length > 0;
}
