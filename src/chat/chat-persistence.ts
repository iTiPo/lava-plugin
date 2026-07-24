import { normalizePath, type Plugin } from 'obsidian';
import {
    CHAT_INDEX_VERSION,
    createEmptyChatIndex,
    type ChatIndex,
    type ChatSessionMeta,
} from './session-types';
import {
    CHAT_RECORD_VERSION,
    type ChatRecord,
    type NewChatRecord,
    type SessionSnapshot,
} from './persistence-types';
import type { McpConversationGrant } from '../mcp/types';
import { parseChatRecord, replayChatRecords } from './session-replay';

const INDEX_FILE = 'index.json';
const COMPACT_RECORD_THRESHOLD = 500;

export class ChatPersistence {
    private readonly basePath: string;
    private readonly writeQueues = new Map<string, Promise<void>>();
    private readonly nextSequences = new Map<string, number>();

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

    async loadSnapshot(sessionId: string): Promise<SessionSnapshot> {
        return replayChatRecords(await this.loadRecords(sessionId));
    }

    async loadRecords(sessionId: string): Promise<ChatRecord[]> {
        const path = this.sessionPath(sessionId);
        const exists = await this.plugin.app.vault.adapter.exists(path);
        if (!exists) return [];

        const raw = await this.plugin.app.vault.adapter.read(path);
        const records: ChatRecord[] = [];
        let legacySeq = 0;

        for (const line of raw.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const record = parseChatRecord(trimmed, ++legacySeq);
            if (record) {
                records.push(record);
            }
        }

        return records;
    }

    async appendRecord(sessionId: string, value: NewChatRecord): Promise<ChatRecord> {
        let persisted: ChatRecord | undefined;
        await this.enqueueWrite(sessionId, async () => {
            await this.ensureSequenceInitialized(sessionId);
            const seq = this.nextSequences.get(sessionId) ?? 1;
            this.nextSequences.set(sessionId, seq + 1);
            persisted = {
                ...value,
                version: CHAT_RECORD_VERSION,
                seq,
                recordedAt: Date.now(),
            };
            await this.plugin.app.vault.adapter.append(
                this.sessionPath(sessionId),
                `${JSON.stringify(persisted)}\n`,
            );
        });
        if (!persisted) throw new Error('Chat record was not persisted.');
        return persisted;
    }

    async maybeCompact(sessionId: string): Promise<void> {
        await this.enqueueWrite(sessionId, async () => {
            const snapshot = replayChatRecords(await this.loadRecords(sessionId));
            if (snapshot.recordCount < COMPACT_RECORD_THRESHOLD) return;
            await this.writeCompactedSnapshot(sessionId, snapshot);
        });
    }

    async compactSession(sessionId: string): Promise<void> {
        await this.enqueueWrite(sessionId, async () => {
            const snapshot = replayChatRecords(await this.loadRecords(sessionId));
            await this.writeCompactedSnapshot(sessionId, snapshot);
        });
    }

    async registerSession(meta: ChatSessionMeta, index: ChatIndex): Promise<ChatIndex> {
        const next: ChatIndex = {
            ...index,
            sessions: [...index.sessions.filter((s) => s.id !== meta.id), meta],
        };
        await this.saveIndex(next);
        return next;
    }

    private async ensureSequenceInitialized(sessionId: string): Promise<void> {
        if (this.nextSequences.has(sessionId)) return;
        const records = await this.loadRecords(sessionId);
        const maxSeq = records.reduce(
            (maximum, record) => Math.max(maximum, record.seq),
            0,
        );
        this.nextSequences.set(sessionId, maxSeq + 1);
    }

    private async enqueueWrite(sessionId: string, action: () => Promise<void>): Promise<void> {
        const previous = this.writeQueues.get(sessionId) ?? Promise.resolve();
        const next = previous.catch(() => undefined).then(action);
        this.writeQueues.set(sessionId, next);
        try {
            await next;
        } finally {
            if (this.writeQueues.get(sessionId) === next) {
                this.writeQueues.delete(sessionId);
            }
        }
    }

    private async writeCompactedSnapshot(
        sessionId: string,
        snapshot: SessionSnapshot,
    ): Promise<void> {
        const canonical: NewChatRecord[] = [
            ...snapshot.messages.map(
                (message): NewChatRecord => ({
                    kind: 'message',
                    message,
                    incomplete: snapshot.messageStates.get(message.id)?.incomplete,
                }),
            ),
            ...[...snapshot.runs.values()].map(
                (record): NewChatRecord => stripRecordMetadata(record),
            ),
            ...[...snapshot.toolOperations.values()].map(
                (record): NewChatRecord => stripRecordMetadata(record),
            ),
        ];
        const now = Date.now();
        const records = canonical.map(
            (record, index): ChatRecord => ({
                ...record,
                version: CHAT_RECORD_VERSION,
                seq: index + 1,
                recordedAt: now,
            }),
        );
        const path = this.sessionPath(sessionId);
        const tempPath = `${path}.compact`;
        const backupPath = `${path}.backup`;
        const adapter = this.plugin.app.vault.adapter;
        await adapter.write(
            tempPath,
            records.map((record) => JSON.stringify(record)).join('\n') + '\n',
        );
        if (await adapter.exists(backupPath)) await adapter.remove(backupPath);
        if (await adapter.exists(path)) await adapter.rename(path, backupPath);
        try {
            await adapter.rename(tempPath, path);
            if (await adapter.exists(backupPath)) await adapter.remove(backupPath);
            this.nextSequences.set(sessionId, records.length + 1);
        } catch (error) {
            if (await adapter.exists(backupPath)) await adapter.rename(backupPath, path);
            throw error;
        }
    }
}

function normalizeIndex(raw: Partial<ChatIndex>): ChatIndex {
    const sessions = Array.isArray(raw.sessions)
        ? raw.sessions.filter(isValidSessionMeta).map(normalizeSessionMeta)
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

function normalizeSessionMeta(meta: ChatSessionMeta): ChatSessionMeta {
    return {
        id: meta.id,
        title: meta.title,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        mode: meta.mode === 'agent' ? 'agent' : 'chat',
        toolGrants: normalizeToolGrants(meta.toolGrants),
        storageVersion: meta.storageVersion === 2 ? 2 : 1,
    };
}

function normalizeToolGrants(value: unknown): McpConversationGrant[] {
    if (!Array.isArray(value)) return [];
    return value.filter((grant): grant is McpConversationGrant => {
        if (!grant || typeof grant !== 'object') return false;
        const candidate = grant as Partial<McpConversationGrant>;
        return (
            typeof candidate.serverId === 'string' &&
            typeof candidate.toolName === 'string' &&
            typeof candidate.fingerprint === 'string'
        );
    });
}

function stripRecordMetadata(
    record: Exclude<ChatRecord, { kind: 'message' }>,
): NewChatRecord {
    const { version: _version, seq: _seq, recordedAt: _recordedAt, ...value } = record;
    return value;
}
