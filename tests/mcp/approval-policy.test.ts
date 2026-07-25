import { describe, expect, it } from 'vitest';
import {
    countToolPolicies,
    reconcileManifestPolicies,
    resolveToolPolicy,
    syncConnectedToolPolicies,
    type ToolPolicyContext,
} from '../../src/mcp/approval-policy';
import type { ConnectedMcpTool, McpToolManifestEntry } from '../../src/mcp/types';

const baseContext: ToolPolicyContext = {
    mode: 'agent',
    conversationGrants: [],
    tools: [
        {
            id: 'mcp_github_create_issue',
            serverId: 'github',
            serverName: 'GitHub',
            toolName: 'create_issue',
            title: 'Create issue',
            fingerprint: 'fingerprint-1',
            readOnlyHint: false,
            policy: 'ask',
        },
        {
            id: 'mcp_github_list_issues',
            serverId: 'github',
            serverName: 'GitHub',
            toolName: 'list_issues',
            title: 'List issues',
            fingerprint: 'fingerprint-2',
            readOnlyHint: true,
            policy: 'auto',
        },
    ],
};

describe('tool access policy', () => {
    it('blocks all MCP tools in chat mode', () => {
        expect(
            resolveToolPolicy('mcp_github_create_issue', {
                ...baseContext,
                mode: 'chat',
            }),
        ).toBe('blocked');
        expect(resolveToolPolicy('readNote', { ...baseContext, mode: 'chat' })).toBe(
            'built-in',
        );
    });

    it('resolves ask and automatic policies', () => {
        expect(resolveToolPolicy('mcp_github_create_issue', baseContext)).toBe('ask');
        expect(resolveToolPolicy('mcp_github_list_issues', baseContext)).toBe('auto');
        expect(countToolPolicies(baseContext)).toEqual({ ask: 1, auto: 1 });
    });

    it('requires a matching fingerprint for conversation grants', () => {
        const granted: ToolPolicyContext = {
            ...baseContext,
            conversationGrants: [
                {
                    serverId: 'github',
                    toolName: 'create_issue',
                    fingerprint: 'fingerprint-1',
                },
            ],
        };
        expect(resolveToolPolicy('mcp_github_create_issue', granted)).toBe('auto');

        granted.conversationGrants[0]!.fingerprint = 'changed';
        expect(resolveToolPolicy('mcp_github_create_issue', granted)).toBe('ask');
    });

    it('syncs live descriptors from persisted settings policies', () => {
        const descriptors: ConnectedMcpTool[] = [
            {
                id: 'mcp_github_create_issue',
                serverId: 'github',
                serverName: 'GitHub',
                toolName: 'create_issue',
                title: 'Create issue',
                fingerprint: 'fingerprint-1',
                readOnlyHint: false,
                policy: 'ask',
            },
        ];

        expect(
            syncConnectedToolPolicies(descriptors, [
                {
                    name: 'create_issue',
                    fingerprint: 'fingerprint-1',
                    policy: 'auto',
                },
            ]),
        ).toBe(true);
        expect(descriptors[0]!.policy).toBe('auto');

        expect(
            syncConnectedToolPolicies(descriptors, [
                {
                    name: 'create_issue',
                    fingerprint: 'changed',
                    policy: 'auto',
                },
            ]),
        ).toBe(true);
        expect(descriptors[0]!.policy).toBe('ask');
    });

    it('reconciles manifest entries with newer settings policies', () => {
        const manifest: McpToolManifestEntry[] = [
            {
                name: 'create_issue',
                title: 'Create issue',
                fingerprint: 'fingerprint-1',
                readOnlyHint: false,
                policy: 'ask',
            },
        ];

        reconcileManifestPolicies(manifest, [
            {
                name: 'create_issue',
                fingerprint: 'fingerprint-1',
                policy: 'auto',
            },
        ]);
        expect(manifest[0]!.policy).toBe('auto');
    });
});
