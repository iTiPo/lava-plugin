import type { LavaUIMessage } from '../ai/chat-types';
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
    const candidate = value as Partial<ChatRecord> & Partial<LavaUIMessage>;

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

function isChatRecord(value: Partial<ChatRecord>): value is ChatRecord {
    if (
        typeof value.seq !== 'number' ||
        typeof value.recordedAt !== 'number' ||
        typeof value.kind !== 'string'
    ) {
        return false;
    }

    if (value.kind === 'message') {
        return isLegacyMessage(value.message);
    }
    if (value.kind === 'run') {
        return (
            typeof value.runId === 'string' &&
            typeof value.triggerMessageId === 'string' &&
            (value.mode === 'chat' || value.mode === 'agent') &&
            typeof value.status === 'string'
        );
    }
    if (value.kind === 'tool') {
        return (
            typeof value.operationId === 'string' &&
            typeof value.runId === 'string' &&
            typeof value.toolCallId === 'string' &&
            typeof value.toolName === 'string' &&
            typeof value.status === 'string'
        );
    }
    return false;
}

function isLegacyMessage(value: unknown): value is LavaUIMessage {
    if (!value || typeof value !== 'object') return false;
    const message = value as Partial<LavaUIMessage>;
    return (
        typeof message.id === 'string' &&
        typeof message.role === 'string' &&
        Array.isArray(message.parts)
    );
}
