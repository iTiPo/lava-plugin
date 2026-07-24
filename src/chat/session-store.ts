import type { LavaChat, LavaUIMessage } from '../ai/chat-types';
import { generateId } from 'ai';
import type { ChatMode } from '../domain/chat';
import type { McpConversationGrant, ToolAuthorization } from '../mcp/types';
import type { ChatPersistence } from './chat-persistence';
import type { RunStatus, ToolOperationStatus } from './persistence-types';
import { applyChatRecord } from './session-replay';
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
                snapshot: undefined,
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
            mode: 'chat',
            toolGrants: [],
            storageVersion: 2,
            messagesLoaded: true,
            persisted: false,
            snapshot: undefined,
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

    syncFromChat(chat: LavaChat, sessionId = this.activeSessionId): void {
        const session = this.sessions.find((s) => s.id === sessionId);
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
        if (this.activeSessionId === sessionId) {
            const next = this.listSessions()[0];
            this.activeSessionId = next?.id ?? '';
        }
    }

    async ensureMessagesLoaded(sessionId: string): Promise<void> {
        const session = this.getSession(sessionId);
        if (!session || session.messagesLoaded) return;

        const snapshot = await this.persistence.loadSnapshot(sessionId);
        session.messages = snapshot.messages as LavaUIMessage[];
        session.snapshot = snapshot;
        session.messagesLoaded = true;
    }

    async appendCompletedMessage(
        sessionId: string,
        message: LavaUIMessage,
    ): Promise<void> {
        await this.persistMessage(sessionId, message, false);
    }

    async persistMessage(
        sessionId: string,
        message: LavaUIMessage,
        incomplete = false,
    ): Promise<void> {
        const session = this.getSession(sessionId);
        if (!session) return;

        const now = Date.now();
        if (!session.persisted) {
            session.persisted = true;
            session.updatedAt = now;
            this.index = await this.persistence.registerSession(
                this.toMeta(session),
                this.index,
            );
        }

        const existingIndex = session.messages.findIndex((candidate) => candidate.id === message.id);
        if (existingIndex === -1) {
            session.messages = [...session.messages, message];
        } else {
            session.messages = session.messages.map((candidate, index) =>
                index === existingIndex ? message : candidate,
            );
        }
        const record = await this.persistence.appendRecord(sessionId, {
            kind: 'message',
            message,
            incomplete,
        });
        session.snapshot = applyChatRecord(session.snapshot, record);
        session.messagesLoaded = true;
        session.updatedAt = now;
        session.storageVersion = 2;

        this.index = {
            ...this.index,
            sessions: this.index.sessions.map((meta) =>
                meta.id === sessionId ? this.toMeta(session) : meta,
            ),
        };
        await this.flushIndex();
        this.notify();
    }

    async setMode(sessionId: string, mode: ChatMode): Promise<void> {
        const session = this.getSession(sessionId);
        if (!session || session.mode === mode) return;
        session.mode = mode;
        session.updatedAt = Date.now();
        if (session.persisted) await this.flushIndex();
        this.notify();
    }

    async setConversationGrant(
        sessionId: string,
        grant: McpConversationGrant,
    ): Promise<void> {
        const session = this.getSession(sessionId);
        if (!session) return;
        session.toolGrants = [
            ...session.toolGrants.filter(
                (candidate) =>
                    candidate.serverId !== grant.serverId ||
                    candidate.toolName !== grant.toolName,
            ),
            grant,
        ];
        session.updatedAt = Date.now();
        if (session.persisted) await this.flushIndex();
        this.notify();
    }

    async startRun(
        sessionId: string,
        triggerMessageId: string,
        mode: ChatMode,
    ): Promise<string> {
        const runId = generateId();
        const record = await this.persistence.appendRecord(sessionId, {
            kind: 'run',
            runId,
            triggerMessageId,
            mode,
            status: 'running',
        });
        const session = this.getSession(sessionId);
        if (session) session.snapshot = applyChatRecord(session.snapshot, record);
        return runId;
    }

    async updateRun(
        sessionId: string,
        runId: string,
        triggerMessageId: string,
        mode: ChatMode,
        status: RunStatus,
        error?: string,
    ): Promise<void> {
        const record = await this.persistence.appendRecord(sessionId, {
            kind: 'run',
            runId,
            triggerMessageId,
            mode,
            status,
            error,
        });
        const session = this.getSession(sessionId);
        if (session) session.snapshot = applyChatRecord(session.snapshot, record);
        if (status !== 'running' && status !== 'awaiting-approval') {
            void this.persistence.maybeCompact(sessionId);
        }
    }

    async recordToolOperation(
        sessionId: string,
        operation: {
            operationId: string;
            runId: string;
            toolCallId: string;
            serverId?: string;
            toolName: string;
            status: ToolOperationStatus;
            authorization: ToolAuthorization;
            input?: unknown;
            result?: unknown;
            externalReference?: string;
            error?: string;
        },
    ): Promise<void> {
        const record = await this.persistence.appendRecord(sessionId, {
            kind: 'tool',
            ...operation,
        });
        const session = this.getSession(sessionId);
        if (session) session.snapshot = applyChatRecord(session.snapshot, record);
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
            mode: session.mode,
            toolGrants: session.toolGrants,
            storageVersion: session.storageVersion,
        };
    }

}
