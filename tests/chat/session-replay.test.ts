import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { CHAT_RECORD_VERSION, type ChatRecord } from '../../src/chat/persistence-types';
import { parseChatRecord, replayChatRecords } from '../../src/chat/session-replay';

const userMessage: UIMessage = {
    id: 'user-1',
    role: 'user',
    parts: [{ type: 'text', text: 'hello' }],
};

describe('chat record replay', () => {
    it('loads legacy message lines', () => {
        const record = parseChatRecord(JSON.stringify(userMessage), 1);

        expect(record).toMatchObject({
            version: CHAT_RECORD_VERSION,
            seq: 1,
            kind: 'message',
            message: userMessage,
        });
    });

    it('ignores malformed lines', () => {
        expect(parseChatRecord('{not-json', 1)).toBeUndefined();
        expect(parseChatRecord('{"unknown":true}', 1)).toBeUndefined();
    });

    it('uses the latest message record without changing order', () => {
        const assistant: UIMessage = {
            id: 'assistant-1',
            role: 'assistant',
            parts: [{ type: 'text', text: 'partial' }],
        };
        const records: ChatRecord[] = [
            messageRecord(1, userMessage),
            messageRecord(2, assistant, true),
            messageRecord(3, {
                ...assistant,
                parts: [{ type: 'text', text: 'complete' }],
            }),
        ];

        const snapshot = replayChatRecords(records);

        expect(snapshot.messages.map((message) => message.id)).toEqual([
            'user-1',
            'assistant-1',
        ]);
        expect(snapshot.messages[1]?.parts).toEqual([
            { type: 'text', text: 'complete' },
        ]);
        expect(snapshot.messageStates.get('assistant-1')?.incomplete).toBe(false);
    });

    it('restores active runs and latest tool outcomes', () => {
        const records: ChatRecord[] = [
            runRecord(1, 'running'),
            toolRecord(2, 'started'),
            toolRecord(3, 'succeeded'),
            runRecord(4, 'awaiting-approval'),
        ];

        const snapshot = replayChatRecords(records);

        expect(snapshot.activeRun?.status).toBe('awaiting-approval');
        expect(snapshot.toolOperations.get('operation-1')?.status).toBe('succeeded');
        expect(snapshot.maxSeq).toBe(4);
    });
});

function messageRecord(
    seq: number,
    message: UIMessage,
    incomplete = false,
): ChatRecord {
    return {
        version: CHAT_RECORD_VERSION,
        seq,
        recordedAt: seq,
        kind: 'message',
        message,
        incomplete,
    } as ChatRecord;
}

function runRecord(
    seq: number,
    status: 'running' | 'awaiting-approval',
): ChatRecord {
    return {
        version: CHAT_RECORD_VERSION,
        seq,
        recordedAt: seq,
        kind: 'run',
        runId: 'run-1',
        triggerMessageId: 'user-1',
        mode: 'agent',
        status,
    };
}

function toolRecord(
    seq: number,
    status: 'started' | 'succeeded',
): ChatRecord {
    return {
        version: CHAT_RECORD_VERSION,
        seq,
        recordedAt: seq,
        kind: 'tool',
        operationId: 'operation-1',
        runId: 'run-1',
        toolCallId: 'tool-call-1',
        serverId: 'github',
        toolName: 'create_issue',
        status,
        authorization: 'once',
    };
}
