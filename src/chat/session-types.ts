import type { LavaUIMessage } from '../ai/chat-types';
import type { ChatMode } from '../domain/chat';
import type { McpConversationGrant } from '../mcp/types';
import type { SessionSnapshot } from './persistence-types';

export const CHAT_INDEX_VERSION = 2;

export interface ChatSessionMeta {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	mode: ChatMode;
	toolGrants: McpConversationGrant[];
	storageVersion: 1 | 2;
}

export interface ChatIndex {
	version: typeof CHAT_INDEX_VERSION;
	activeSessionId: string;
	sessions: ChatSessionMeta[];
}

export interface ChatSession extends ChatSessionMeta {
	messages: LavaUIMessage[];
	messagesLoaded: boolean;
	persisted: boolean;
	snapshot?: SessionSnapshot;
}

export const DEFAULT_SESSION_TITLE = 'New chat';

export const TITLE_MAX_LENGTH = 40;

export function titleFromFirstMessage(text: string): string {
	const trimmed = text.trim();
	if (!trimmed) return DEFAULT_SESSION_TITLE;
	if (trimmed.length <= TITLE_MAX_LENGTH) return trimmed;
	return `${trimmed.slice(0, TITLE_MAX_LENGTH - 1)}…`;
}

export function createEmptyChatIndex(): ChatIndex {
	return {
		version: CHAT_INDEX_VERSION,
		activeSessionId: '',
		sessions: [],
	};
}
