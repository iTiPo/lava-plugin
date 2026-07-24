import { ToolLoopAgent, type ToolSet } from 'ai';
import type { App } from 'obsidian';
import type { AuthStore } from '../auth/auth-store';
import type { ChatMode } from '../domain/chat';
import {
    resolveToolPolicy,
    type ToolPolicyContext,
} from '../mcp/approval-policy';
import { findExternalReference, sanitizeToolValue } from '../mcp/output';
import type {
    ConnectedMcpTool,
    McpConversationGrant,
    ToolAuthorization,
} from '../mcp/types';
import { buildModel } from './provider';
import { createReadNoteTool } from './tools/read-note';

const LAVA_SYSTEM_INSTRUCTIONS = `You are Lava, an AI assistant embedded in Obsidian. You help the user think clearly and work with their notes. Be concise, accurate, and direct.

## Environment
You run inside the user's Obsidian vault. Notes are markdown files identified by vault-relative paths (e.g. Projects/Idea.md).

## Reading notes
You have a readNote tool to read note content. When the user includes @path/to/note.md, call readNote with that path (without @) before answering questions about that note. If several notes are mentioned, read each one you need before responding.

If the user asks about a specific note without @mention, ask which note they mean instead of guessing. If readNote fails, say the note was not found — do not invent content. For general questions not tied to a note, answer without using readNote. When summarizing a note, prefer a concise summary over quoting the full text unless the user asks for more.

## Limits
You cannot create, edit, or delete notes. Only treat note content as known when readNote succeeded in this conversation.`;

const AGENT_MODE_INSTRUCTIONS = `${LAVA_SYSTEM_INSTRUCTIONS}

## External tools
You are in Agent mode. You may use the available external tools when they directly help complete the user's request. Before calling a tool, choose the target and arguments carefully. Never claim an external action succeeded until its tool result confirms it.`;

export interface AgentRunReference {
    sessionId: string;
    runId: string;
}

export interface LavaAgentLifecycle {
    currentRun: () => AgentRunReference | undefined;
    toolStarted: (operation: {
        operationId: string;
        runId: string;
        toolCallId: string;
        serverId?: string;
        toolName: string;
        authorization: ToolAuthorization;
        input: unknown;
    }) => Promise<void>;
    toolFinished: (operation: {
        operationId: string;
        runId: string;
        toolCallId: string;
        serverId?: string;
        toolName: string;
        authorization: ToolAuthorization;
        result?: unknown;
        error?: string;
        externalReference?: string;
    }) => Promise<void>;
}

export interface CreateLavaAgentOptions {
    mode: ChatMode;
    mcpTools?: ToolSet;
    descriptors?: ConnectedMcpTool[];
    conversationGrants?: McpConversationGrant[] | (() => McpConversationGrant[]);
    lifecycle?: LavaAgentLifecycle;
}

export function createLavaAgent(
    app: App,
    authStore: AuthStore,
    options: CreateLavaAgentOptions = { mode: 'chat' },
) {
    const descriptors = options.descriptors ?? [];
    const policyContext = (): ToolPolicyContext => ({
        mode: options.mode,
        tools: descriptors,
        conversationGrants:
            typeof options.conversationGrants === 'function'
                ? options.conversationGrants()
                : (options.conversationGrants ?? []),
    });
    const tools: ToolSet = {
        readNote: createReadNoteTool(app),
        ...(options.mode === 'agent' ? options.mcpTools : {}),
    };

    return new ToolLoopAgent({
        model: buildModel(authStore),
        instructions:
            options.mode === 'agent' ? AGENT_MODE_INSTRUCTIONS : LAVA_SYSTEM_INSTRUCTIONS,
        tools,
        toolApproval: ({ toolCall }) =>
            resolveToolPolicy(toolCall.toolName, policyContext()) === 'ask'
                ? 'user-approval'
                : 'not-applicable',
        onToolExecutionStart: async ({ toolCall }) => {
            if (toolCall.toolName === 'readNote' || !options.lifecycle) return;
            const run = options.lifecycle.currentRun();
            if (!run) return;
            const descriptor = descriptors.find((tool) => tool.id === toolCall.toolName);
            const operationId = `${run.runId}:${toolCall.toolCallId}`;
            await options.lifecycle.toolStarted({
                operationId,
                runId: run.runId,
                toolCallId: toolCall.toolCallId,
                serverId: descriptor?.serverId,
                toolName: descriptor?.toolName ?? toolCall.toolName,
                authorization: authorizationFor(toolCall.toolName, policyContext()),
                input: sanitizeToolValue(toolCall.input),
            });
        },
        onToolExecutionEnd: async ({ toolCall, toolOutput }) => {
            if (toolCall.toolName === 'readNote' || !options.lifecycle) return;
            const run = options.lifecycle.currentRun();
            if (!run) return;
            const descriptor = descriptors.find((tool) => tool.id === toolCall.toolName);
            const operationId = `${run.runId}:${toolCall.toolCallId}`;
            const isError = toolOutput.type === 'tool-error';
            const value: unknown = isError
                ? (toolOutput as { error: unknown }).error
                : (toolOutput as { output: unknown }).output;
            const applicationError = !isError && isMcpApplicationError(value);
            const failed = isError || applicationError;
            await options.lifecycle.toolFinished({
                operationId,
                runId: run.runId,
                toolCallId: toolCall.toolCallId,
                serverId: descriptor?.serverId,
                toolName: descriptor?.toolName ?? toolCall.toolName,
                authorization: authorizationFor(toolCall.toolName, policyContext()),
                result: failed ? undefined : sanitizeToolValue(value),
                error: failed ? errorMessage(value) : undefined,
                externalReference: failed ? undefined : findExternalReference(value),
            });
        },
    });
}

function authorizationFor(
    toolName: string,
    context: ToolPolicyContext,
): ToolAuthorization {
    const descriptor = context.tools.find((tool) => tool.id === toolName);
    if (!descriptor) return 'automatic';
    const hasConversationGrant = context.conversationGrants.some(
        (grant) =>
            grant.serverId === descriptor.serverId &&
            grant.toolName === descriptor.toolName &&
            grant.fingerprint === descriptor.fingerprint,
    );
    if (hasConversationGrant) return 'conversation';
    if (descriptor.policy === 'auto') return 'always';
    return 'once';
}

function errorMessage(value: unknown): string {
    if (value instanceof Error) return value.message;
    if (value && typeof value === 'object') {
        const result = value as { content?: unknown };
        if (Array.isArray(result.content)) {
            const text = result.content
                .filter(
                    (entry): entry is { type: 'text'; text: string } =>
                        Boolean(entry) &&
                        typeof entry === 'object' &&
                        (entry as { type?: unknown }).type === 'text' &&
                        typeof (entry as { text?: unknown }).text === 'string',
                )
                .map((entry) => entry.text)
                .join('\n');
            if (text) return text;
        }
        return 'The MCP server reported a tool error.';
    }
    return typeof value === 'string' ? value : 'Tool execution failed.';
}

function isMcpApplicationError(value: unknown): boolean {
    return (
        Boolean(value) &&
        typeof value === 'object' &&
        (value as { isError?: unknown }).isError === true
    );
}
