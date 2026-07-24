import type { LavaUIMessage } from '../ai/chat-types';

export const CHAT_RECORD_VERSION = 2;

export type ChatMode = 'chat' | 'agent';
export type RunStatus =
    | 'running'
    | 'awaiting-approval'
    | 'completed'
    | 'failed'
    | 'interrupted';
export type ToolOperationStatus =
    | 'started'
    | 'succeeded'
    | 'failed'
    | 'interrupted'
    | 'unknown';
export type ToolAuthorization = 'automatic' | 'once' | 'conversation' | 'always';

interface RecordBase {
    version: typeof CHAT_RECORD_VERSION;
    seq: number;
    recordedAt: number;
}

export interface MessageRecord extends RecordBase {
    kind: 'message';
    message: LavaUIMessage;
    incomplete?: boolean;
}

export interface RunRecord extends RecordBase {
    kind: 'run';
    runId: string;
    triggerMessageId: string;
    mode: ChatMode;
    status: RunStatus;
    error?: string;
}

export interface ToolOperationRecord extends RecordBase {
    kind: 'tool';
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
}

export type ChatRecord = MessageRecord | RunRecord | ToolOperationRecord;

export type NewChatRecord =
    | Omit<MessageRecord, keyof RecordBase>
    | Omit<RunRecord, keyof RecordBase>
    | Omit<ToolOperationRecord, keyof RecordBase>;

export interface SessionSnapshot {
    messages: LavaUIMessage[];
    messageStates: Map<string, { incomplete: boolean; seq: number }>;
    runs: Map<string, RunRecord>;
    toolOperations: Map<string, ToolOperationRecord>;
    activeRun?: RunRecord;
    maxSeq: number;
    recordCount: number;
}
