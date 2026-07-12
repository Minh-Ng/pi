import type { Message } from "@earendil-works/pi-ai/compat";

function malformedToolSequence(detail: string): Error {
	return new Error(
		`Invalid tool message sequence: ${detail}. Use /tree to navigate to a point before the malformed messages and retry.`,
	);
}

/**
 * Validate provider-bound agent messages before conversion to provider-specific context.
 * Tool results must immediately follow the assistant tool-call batch and match every call exactly once.
 */
export function validateToolMessageSequence(messages: Message[]): void {
	const pendingToolCalls = new Set<string>();

	for (const message of messages) {
		if (message.role === "toolResult") {
			if (!pendingToolCalls.delete(message.toolCallId)) {
				throw malformedToolSequence(`tool result ${JSON.stringify(message.toolCallId)} has no unmatched tool call`);
			}
			continue;
		}

		if (pendingToolCalls.size > 0) {
			throw malformedToolSequence(
				`tool call(s) ${Array.from(pendingToolCalls, (id) => JSON.stringify(id)).join(", ")} are not followed by their results`,
			);
		}

		if (message.role !== "assistant" || message.stopReason === "error" || message.stopReason === "aborted") {
			continue;
		}

		for (const part of message.content) {
			if (part.type !== "toolCall") {
				continue;
			}
			if (pendingToolCalls.has(part.id)) {
				throw malformedToolSequence(`tool call id ${JSON.stringify(part.id)} is duplicated`);
			}
			pendingToolCalls.add(part.id);
		}
	}

	if (pendingToolCalls.size > 0) {
		throw malformedToolSequence(
			`tool call(s) ${Array.from(pendingToolCalls, (id) => JSON.stringify(id)).join(", ")} have no results`,
		);
	}
}
