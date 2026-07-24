import type { ChatMode } from '../domain/chat';
import type {
	ConnectedMcpTool,
	McpConversationGrant,
	McpToolPolicy,
} from './types';

export interface ToolPolicyContext {
	mode: ChatMode;
	tools: ConnectedMcpTool[];
	conversationGrants: McpConversationGrant[];
}

export function resolveToolPolicy(
	toolId: string,
	context: ToolPolicyContext,
): McpToolPolicy | 'built-in' {
	if (toolId === 'readNote') return 'built-in';
	if (context.mode !== 'agent') return 'blocked';
	const descriptor = context.tools.find((tool) => tool.id === toolId);
	if (!descriptor) return 'blocked';
	if (descriptor.policy === 'blocked') return 'blocked';
	if (
		context.conversationGrants.some(
			(grant) =>
				grant.serverId === descriptor.serverId &&
				grant.toolName === descriptor.toolName &&
				grant.fingerprint === descriptor.fingerprint,
		)
	) {
		return 'auto';
	}
	return descriptor.policy;
}

export function countToolPolicies(context: ToolPolicyContext): {
	ask: number;
	auto: number;
} {
	let ask = 0;
	let auto = 0;
	for (const tool of context.tools) {
		const policy = resolveToolPolicy(tool.id, context);
		if (policy === 'ask') ask++;
		if (policy === 'auto') auto++;
	}
	return { ask, auto };
}
