import type { UIMessage } from 'ai';
import {
    CHAT_RECORD_VERSION,
    type ChatRecord,
    type MessageRecord,
    type SessionSnapshot,
} from './persistence-types';

interface MessageState {
    firstSeq: number;
    record: MessageRecord;
}

export function parseChatRecord(line: string, legacySeq: number): ChatRecord | undefined {
    let value: unknown;
    try {
        value = JSON.parse(line);
    } catch {
        return undefined;
    }

    if (!value || typeof value !== 'object') return undefined;
    const candidate = value as Partial<ChatRecord> & Partial<UIMessage>;

    if (candidate.version === CHAT_RECORD_VERSION && isChatRecord(candidate)) {
        return candidate;
    }

    if (isLegacyMessage(candidate)) {
        return {
            version: CHAT_RECORD_VERSION,
            seq: legacySeq,
            recordedAt: 0,
            kind: 'message',
            message: candidate,
        };
    }

    return undefined;
}

export function replayChatRecords(records: ChatRecord[]): SessionSnapshot {
    const messages = new Map<string, MessageState>();
    const runs = new Map<string, Extract<ChatRecord, { kind: 'run' }>>();
    const toolOperations = new Map<string, Extract<ChatRecord, { kind: 'tool' }>>();
    let maxSeq = 0;

    for (const record of records) {
        maxSeq = Math.max(maxSeq, record.seq);
        if (record.kind === 'message') {
            const existing = messages.get(record.message.id);
            messages.set(record.message.id, {
                firstSeq: existing?.firstSeq ?? record.seq,
                record,
            });
        } else if (record.kind === 'run') {
            runs.set(record.runId, record);
        } else {
            toolOperations.set(record.operationId, record);
        }
    }

    const orderedMessages = [...messages.values()].sort(
        (left, right) => left.firstSeq - right.firstSeq,
    );
    const activeRun = [...runs.values()]
        .filter((run) => run.status === 'running' || run.status === 'awaiting-approval')
        .sort((left, right) => right.seq - left.seq)[0];

    return {
        messages: orderedMessages.map(({ record }) => record.message),
        messageStates: new Map(
            orderedMessages.map(({ record }) => [
                record.message.id,
                { incomplete: record.incomplete ?? false, seq: record.seq },
            ]),
        ),
        runs,
        toolOperations,
        activeRun,
        maxSeq,
        recordCount: records.length,
    };
}

export function applyChatRecord(
    snapshot: SessionSnapshot | undefined,
    record: ChatRecord,
): SessionSnapshot {
    const next = snapshot ?? emptySessionSnapshot();
    next.maxSeq = Math.max(next.maxSeq, record.seq);
    next.recordCount += 1;

    if (record.kind === 'message') {
        const state = next.messageStates.get(record.message.id);
        if (!state || record.seq >= state.seq) {
            const index = next.messages.findIndex(
                (message) => message.id === record.message.id,
            );
            if (index === -1) {
                next.messages = [...next.messages, record.message];
            } else {
                next.messages = next.messages.map((message, messageIndex) =>
                    messageIndex === index ? record.message : message,
                );
            }
            next.messageStates.set(record.message.id, {
                incomplete: record.incomplete ?? false,
                seq: record.seq,
            });
        }
    } else if (record.kind === 'run') {
        const current = next.runs.get(record.runId);
        if (!current || record.seq >= current.seq) next.runs.set(record.runId, record);
    } else {
        const current = next.toolOperations.get(record.operationId);
        if (!current || record.seq >= current.seq) {
            next.toolOperations.set(record.operationId, record);
        }
    }

    next.activeRun = [...next.runs.values()]
        .filter((run) => run.status === 'running' || run.status === 'awaiting-approval')
        .sort((left, right) => right.seq - left.seq)[0];
    return next;
}

export function emptySessionSnapshot(): SessionSnapshot {
    return {
        messages: [],
        messageStates: new Map(),
        runs: new Map(),
        toolOperations: new Map(),
        activeRun: undefined,
        maxSeq: 0,
        recordCount: 0,
    };
}

function isChatRecord(value: object): value is ChatRecord {
    // Persisted JSON is untrusted: keep `kind` as a plain string so unknown
    // kinds fall through to `return false` instead of being narrowed away.
    const record = value as Record<string, unknown>;
    if (
        typeof record.seq !== 'number' ||
        typeof record.recordedAt !== 'number' ||
        typeof record.kind !== 'string'
    ) {
        return false;
    }

    if (record.kind === 'message') {
        return isLegacyMessage(record.message);
    }
    if (record.kind === 'run') {
        return (
            typeof record.runId === 'string' &&
            typeof record.triggerMessageId === 'string' &&
            (record.mode === 'chat' || record.mode === 'agent') &&
            typeof record.status === 'string'
        );
    }
    if (record.kind === 'tool') {
        return (
            typeof record.operationId === 'string' &&
            typeof record.runId === 'string' &&
            typeof record.toolCallId === 'string' &&
            typeof record.toolName === 'string' &&
            typeof record.status === 'string'
        );
    }
    return false;
}

function isLegacyMessage(value: unknown): value is UIMessage {
    if (!value || typeof value !== 'object') return false;
    const message = value as Partial<UIMessage>;
    return (
        typeof message.id === 'string' &&
        typeof message.role === 'string' &&
        Array.isArray(message.parts)
    );
}
