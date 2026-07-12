import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { validateToolMessageSequence } from "../src/core/tool-message-validation.ts";

function userMessage(text: string) {
	return { role: "user" as const, content: text, timestamp: Date.now() };
}

function toolResult(toolCallId: string, toolName: string, text: string) {
	return {
		role: "toolResult" as const,
		toolCallId,
		toolName,
		content: [{ type: "text" as const, text }],
		isError: false,
		timestamp: Date.now(),
	};
}

describe("validateToolMessageSequence", () => {
	it("accepts a complete multi-tool batch", () => {
		const first = fauxToolCall("first", {});
		const second = fauxToolCall("second", {});
		expect(() =>
			validateToolMessageSequence([
				userMessage("run"),
				fauxAssistantMessage([first, second], { stopReason: "toolUse" }),
				toolResult(first.id, "first", "one"),
				toolResult(second.id, "second", "two"),
				fauxAssistantMessage("done"),
			]),
		).not.toThrow();
	});

	it("ignores unexecuted partial tool calls in terminal error responses", () => {
		const partialCall = fauxToolCall("partial", {});
		expect(() =>
			validateToolMessageSequence([
				fauxAssistantMessage(partialCall, { stopReason: "aborted" }),
				userMessage("retry"),
			]),
		).not.toThrow();
	});

	it("rejects orphaned and interrupted tool messages with recovery guidance", () => {
		const call = fauxToolCall("missing", {});
		expect(() => validateToolMessageSequence([toolResult(call.id, "missing", "orphan")])).toThrow(
			/no unmatched tool call.*\/tree/,
		);
		expect(() =>
			validateToolMessageSequence([fauxAssistantMessage(call, { stopReason: "toolUse" }), userMessage("interrupt")]),
		).toThrow(/not followed by their results.*\/tree/);
	});
});
