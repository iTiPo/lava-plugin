import type { LavaUIMessage } from '../ai/chat-types';
import { normalizePath, type Plugin } from 'obsidian';
import {
    CHAT_INDEX_VERSION,
    createEmptyChatIndex,
    type ChatIndex,
    type ChatSessionMeta,
} from './session-types';

const INDEX_FILE = 'index.json';

export class ChatPersistence {
    private readonly basePath: string;

    constructor(private readonly plugin: Plugin) {
        this.basePath = normalizePath(`${plugin.manifest.dir}/chats`);
    }

    getBasePath(): string {
        return this.basePath;
    }

    private indexPath(): string {
        return normalizePath(`${this.basePath}/${INDEX_FILE}`);
    }

    private sessionPath(sessionId: string): string {
        return normalizePath(`${this.basePath}/${sessionId}.jsonl`);
    }

    async ensureDir(): Promise<void> {
        const exists = await this.plugin.app.vault.adapter.exists(this.basePath);
        if (!exists) {
            await this.plugin.app.vault.adapter.mkdir(this.basePath);
        }
    }

    async loadIndex(): Promise<ChatIndex> {
        const path = this.indexPath();
        const exists = await this.plugin.app.vault.adapter.exists(path);
        if (!exists) {
            return createEmptyChatIndex();
        }

        try {
            const raw = await this.plugin.app.vault.adapter.read(path);
            const parsed = JSON.parse(raw) as Partial<ChatIndex>;
            return normalizeIndex(parsed);
        } catch {
            return createEmptyChatIndex();
        }
    }

    async saveIndex(index: ChatIndex): Promise<void> {
        await this.ensureDir();
        const normalized = normalizeIndex(index);
        await this.plugin.app.vault.adapter.write(
            this.indexPath(),
            JSON.stringify(normalized, null, '\t'),
        );
    }

    async sessionFileExists(sessionId: string): Promise<boolean> {
        return this.plugin.app.vault.adapter.exists(this.sessionPath(sessionId));
    }

    async loadMessages(sessionId: string): Promise<LavaUIMessage[]> {
        const path = this.sessionPath(sessionId);
        const exists = await this.plugin.app.vault.adapter.exists(path);
        if (!exists) return [];

        const raw = await this.plugin.app.vault.adapter.read(path);
        const messages: LavaUIMessage[] = [];

        for (const line of raw.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                messages.push(JSON.parse(trimmed) as LavaUIMessage);
            } catch {
                // Skip malformed lines from interrupted writes.
            }
        }

        return messages;
    }

    async appendMessage(sessionId: string, message: LavaUIMessage): Promise<void> {
        await this.ensureDir();
        await this.plugin.app.vault.adapter.append(
            this.sessionPath(sessionId),
            `${JSON.stringify(message)}\n`,
        );
    }

    async registerSession(meta: ChatSessionMeta, index: ChatIndex): Promise<ChatIndex> {
        const next: ChatIndex = {
            ...index,
            sessions: [...index.sessions.filter((s) => s.id !== meta.id), meta],
        };
        await this.saveIndex(next);
        return next;
    }
}

function normalizeIndex(raw: Partial<ChatIndex>): ChatIndex {
    const sessions = Array.isArray(raw.sessions)
        ? raw.sessions.filter(isValidSessionMeta)
        : [];

    let activeSessionId =
        typeof raw.activeSessionId === 'string' ? raw.activeSessionId : '';

    if (activeSessionId && !sessions.some((s) => s.id === activeSessionId)) {
        activeSessionId = '';
    }

    if (!activeSessionId && sessions.length > 0) {
        const mostRecent = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)[0];
        activeSessionId = mostRecent?.id ?? '';
    }

    return {
        version: CHAT_INDEX_VERSION,
        activeSessionId,
        sessions,
    };
}

function isValidSessionMeta(value: unknown): value is ChatSessionMeta {
    if (!value || typeof value !== 'object') return false;
    const meta = value as Partial<ChatSessionMeta>;
    return (
        typeof meta.id === 'string' &&
        typeof meta.title === 'string' &&
        typeof meta.createdAt === 'number' &&
        typeof meta.updatedAt === 'number'
    );
}
