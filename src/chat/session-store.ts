import type { LavaChat, LavaUIMessage } from '../ai/chat-types';
import { generateId } from 'ai';
import type { ChatPersistence } from './chat-persistence';
import {
    DEFAULT_SESSION_TITLE,
    type ChatIndex,
    type ChatSession,
    type ChatSessionMeta,
    titleFromFirstMessage,
} from './session-types';

type Listener = () => void;

export class ChatSessionStore {
    private sessions: ChatSession[] = [];
    private activeSessionId = '';
    private listeners = new Set<Listener>();
    private pendingNewChat = false;
    private index: ChatIndex;
    private readonly persistedMessageIds = new Map<string, Set<string>>();

    private constructor(
        private readonly persistence: ChatPersistence,
        index: ChatIndex,
    ) {
        this.index = index;
    }

    static async fromLoaded(
        persistence: ChatPersistence,
        index: ChatIndex,
        options?: { createDefaultSession?: boolean },
    ): Promise<ChatSessionStore> {
        const store = new ChatSessionStore(persistence, index);
        const createDefaultSession = options?.createDefaultSession ?? true;

        for (const meta of index.sessions) {
            store.sessions.push({
                ...meta,
                messages: [],
                messagesLoaded: false,
                persisted: true,
            });
        }

        if (index.activeSessionId) {
            store.activeSessionId = index.activeSessionId;
            await store.ensureMessagesLoaded(index.activeSessionId);
        } else if (store.sessions.length === 0 && createDefaultSession) {
            store.createSession();
        } else if (store.sessions.length > 0) {
            const mostRecent = store.listSessions()[0];
            if (mostRecent) {
                store.activeSessionId = mostRecent.id;
                await store.ensureMessagesLoaded(mostRecent.id);
            }
        }

        return store;
    }

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify(): void {
        for (const listener of this.listeners) {
            listener();
        }
    }

    private getPersistedIds(sessionId: string): Set<string> {
        let ids = this.persistedMessageIds.get(sessionId);
        if (!ids) {
            ids = new Set();
            this.persistedMessageIds.set(sessionId, ids);
        }
        return ids;
    }

    listSessions(): ChatSession[] {
        return [...this.sessions].sort((a, b) => b.updatedAt - a.updatedAt);
    }

    getActiveSessionId(): string {
        return this.activeSessionId;
    }

    getActiveSessionTitle(): string {
        const session = this.sessions.find((s) => s.id === this.activeSessionId);
        return session?.title ?? DEFAULT_SESSION_TITLE;
    }

    getActiveSession(): ChatSession {
        const session = this.sessions.find((s) => s.id === this.activeSessionId);
        if (session) return session;
        return this.createSession();
    }

    async ensureActiveSession(): Promise<ChatSession> {
        const session = this.sessions.find((s) => s.id === this.activeSessionId);
        if (session) {
            await this.ensureMessagesLoaded(session.id);
            return session;
        }
        if (this.sessions.length > 0) {
            const mostRecent = this.listSessions()[0];
            if (mostRecent) {
                this.activeSessionId = mostRecent.id;
                await this.ensureMessagesLoaded(mostRecent.id);
                return mostRecent;
            }
        }
        return this.createSession();
    }

    getSession(id: string): ChatSession | undefined {
        return this.sessions.find((s) => s.id === id);
    }

    requestNewChat(): void {
        this.pendingNewChat = true;
        this.notify();
    }

    takePendingNewChat(): boolean {
        const pending = this.pendingNewChat;
        this.pendingNewChat = false;
        return pending;
    }

    createSession(): ChatSession {
        const now = Date.now();
        const session: ChatSession = {
            id: generateId(),
            title: DEFAULT_SESSION_TITLE,
            messages: [],
            createdAt: now,
            updatedAt: now,
            messagesLoaded: true,
            persisted: false,
        };
        this.sessions.push(session);
        this.activeSessionId = session.id;
        this.notify();
        return session;
    }

    async selectSession(id: string): Promise<ChatSession | undefined> {
        const session = this.sessions.find((s) => s.id === id);
        if (!session) return undefined;
        this.activeSessionId = id;
        await this.ensureMessagesLoaded(id);
        await this.flushIndex();
        this.notify();
        return session;
    }

    syncFromChat(chat: LavaChat): void {
        const session = this.sessions.find((s) => s.id === this.activeSessionId);
        if (!session) return;
        session.messages = [...chat.messages];
        session.updatedAt = Date.now();
    }

    updateTitleFromMessage(text: string): void {
        const session = this.getActiveSession();
        if (session.title !== DEFAULT_SESSION_TITLE) return;
        session.title = titleFromFirstMessage(text);
        session.updatedAt = Date.now();
        if (session.persisted) {
            void this.flushIndex();
        }
        this.notify();
    }

    isSessionPersisted(sessionId: string): boolean {
        const session = this.getSession(sessionId);
        return session?.persisted ?? false;
    }

    isSessionEmpty(sessionId: string): boolean {
        const session = this.getSession(sessionId);
        if (!session) return true;
        return session.messages.length === 0;
    }

    pruneEmptySession(sessionId: string): void {
        const session = this.getSession(sessionId);
        if (!session || session.persisted || session.messages.length > 0) return;
        this.sessions = this.sessions.filter((s) => s.id !== sessionId);
        this.persistedMessageIds.delete(sessionId);
        if (this.activeSessionId === sessionId) {
            const next = this.listSessions()[0];
            this.activeSessionId = next?.id ?? '';
        }
    }

    async ensureMessagesLoaded(sessionId: string): Promise<void> {
        const session = this.getSession(sessionId);
        if (!session || session.messagesLoaded) return;

        const messages = await this.persistence.loadMessages(sessionId);
        session.messages = messages;
        session.messagesLoaded = true;

        const ids = this.getPersistedIds(sessionId);
        ids.clear();
        for (const message of messages) {
            ids.add(message.id);
        }
    }

    async appendCompletedMessage(
        sessionId: string,
        message: LavaUIMessage,
    ): Promise<void> {
        const session = this.getSession(sessionId);
        if (!session) return;

        const persistedIds = this.getPersistedIds(sessionId);
        if (persistedIds.has(message.id)) return;

        const now = Date.now();
        if (!session.persisted) {
            session.persisted = true;
            session.updatedAt = now;
            this.index = await this.persistence.registerSession(
                this.toMeta(session),
                this.index,
            );
        }

        await this.persistence.appendMessage(sessionId, message);
        persistedIds.add(message.id);

        if (!session.messages.some((m) => m.id === message.id)) {
            session.messages = [...session.messages, message];
        }
        session.messagesLoaded = true;
        session.updatedAt = now;

        this.index = {
            ...this.index,
            sessions: this.index.sessions.map((meta) =>
                meta.id === sessionId ? this.toMeta(session) : meta,
            ),
        };
        await this.flushIndex();
        this.notify();
    }

    async flushIndex(): Promise<void> {
        this.index = {
            ...this.index,
            activeSessionId: this.activeSessionId,
            sessions: this.sessions
                .filter((session) => session.persisted)
                .map((session) => this.toMeta(session)),
        };
        await this.persistence.saveIndex(this.index);
    }

    private toMeta(session: ChatSession): ChatSessionMeta {
        return {
            id: session.id,
            title: session.title,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
        };
    }
}
