import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { convertToLlm } from "../../src/core/messages.ts";
import { buildSessionContext, SessionManager } from "../../src/core/session-manager.ts";
import { validateToolMessageSequence } from "../../src/core/tool-message-validation.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

function messageEntries(sessionManager: SessionManager) {
	return sessionManager.getEntries().filter((entry) => entry.type === "message");
}

function contextAt(sessionManager: SessionManager, leafId: string): AgentMessage[] {
	return buildSessionContext(sessionManager.getEntries(), leafId).messages;
}

describe("AgentSession per-run persistence cursor", () => {
	const harnesses: Harness[] = [];
	const tempDirs: string[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
		while (tempDirs.length > 0) {
			const tempDir = tempDirs.pop();
			if (tempDir) rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("keeps a multi-tool run on its originating branch without stealing the selected leaf", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "pi-run-cursor-"));
		tempDirs.push(tempDir);
		const sessionDir = join(tempDir, "sessions");
		const sessionManager = SessionManager.create(tempDir, sessionDir);
		let releaseSlowTool: (() => void) | undefined;
		const slowToolRelease = new Promise<void>((resolve) => {
			releaseSlowTool = resolve;
		});
		const fastTool: AgentTool = {
			name: "fast",
			label: "Fast",
			description: "Complete immediately",
			parameters: Type.Object({}),
			execute: async () => ({ content: [{ type: "text", text: "fast result" }], details: {} }),
		};
		const slowTool: AgentTool = {
			name: "slow",
			label: "Slow",
			description: "Wait for test release",
			parameters: Type.Object({}),
			execute: async () => {
				await slowToolRelease;
				return { content: [{ type: "text", text: "slow result" }], details: {} };
			},
		};
		const harness = await createHarness({ sessionManager, tools: [fastTool, slowTool] });
		harnesses.push(harness);
		const fastCall = fauxToolCall("fast", {});
		const slowCall = fauxToolCall("slow", {});
		harness.setResponses([
			fauxAssistantMessage("seed reply"),
			fauxAssistantMessage([fastCall, slowCall], { stopReason: "toolUse" }),
			fauxAssistantMessage("background complete"),
		]);

		await harness.session.prompt("seed");
		const seedAssistant = messageEntries(sessionManager).find(
			(entry) => entry.message.role === "assistant" && getMessageText(entry.message) === "seed reply",
		);
		expect(seedAssistant).toBeDefined();

		const sawSlowToolStart = new Promise<void>((resolve) => {
			const unsubscribe = harness.session.subscribe((event) => {
				if (event.type === "tool_execution_start" && event.toolName === "slow") {
					unsubscribe();
					resolve();
				}
			});
		});
		const promptPromise = harness.session.prompt("run tools in background");
		await sawSlowToolStart;

		// Simulate an independent branch selector changing the visible leaf while this run owns a cursor.
		sessionManager.branch(seedAssistant!.id);
		harness.session.recordBashResult("pwd", {
			output: tempDir,
			exitCode: 0,
			cancelled: false,
			truncated: false,
		});
		releaseSlowTool?.();
		await promptPromise;

		expect(sessionManager.getLeafId()).toBe(seedAssistant!.id);
		const finalAssistant = messageEntries(sessionManager).find(
			(entry) => entry.message.role === "assistant" && getMessageText(entry.message) === "background complete",
		);
		expect(finalAssistant).toBeDefined();
		const backgroundLeaf = messageEntries(sessionManager).find(
			(entry) => entry.message.role === "bashExecution" && entry.message.command === "pwd",
		);
		expect(backgroundLeaf?.parentId).toBe(finalAssistant!.id);
		const runContext = contextAt(sessionManager, backgroundLeaf!.id);
		validateToolMessageSequence(convertToLlm(runContext));
		expect(
			runContext.filter((message) => message.role === "toolResult").map((message) => message.toolCallId),
		).toEqual([fastCall.id, slowCall.id]);
		expect(sessionManager.getTree()).toHaveLength(1);

		const sessionFile = sessionManager.getSessionFile();
		expect(sessionFile).toBeDefined();
		const reopened = SessionManager.open(sessionFile!, sessionDir, tempDir);
		expect(reopened.getLeafId()).toBe(seedAssistant!.id);
		validateToolMessageSequence(convertToLlm(contextAt(reopened, backgroundLeaf!.id)));
	});

	it("keeps cancellation results on the run branch without reclaiming the selected leaf", async () => {
		const sessionManager = SessionManager.inMemory();
		let toolStarted: (() => void) | undefined;
		const sawToolStart = new Promise<void>((resolve) => {
			toolStarted = resolve;
		});
		const abortableTool: AgentTool = {
			name: "abortable",
			label: "Abortable",
			description: "Wait until its run is aborted",
			parameters: Type.Object({}),
			execute: async (_toolCallId, _params, signal) => {
				if (!signal) throw new Error("Expected an abort signal");
				toolStarted?.();
				await new Promise<void>((resolve) => {
					if (signal.aborted) resolve();
					else signal.addEventListener("abort", () => resolve(), { once: true });
				});
				return { content: [{ type: "text", text: "aborted" }], details: {} };
			},
		};
		const harness = await createHarness({ sessionManager, tools: [abortableTool] });
		harnesses.push(harness);
		const abortableCall = fauxToolCall("abortable", {});
		harness.setResponses([
			fauxAssistantMessage("seed reply"),
			fauxAssistantMessage(abortableCall, { stopReason: "toolUse" }),
		]);

		await harness.session.prompt("seed");
		const seedAssistant = messageEntries(sessionManager).find(
			(entry) => entry.message.role === "assistant" && getMessageText(entry.message) === "seed reply",
		);
		expect(seedAssistant).toBeDefined();
		const promptPromise = harness.session.prompt("start abortable tool");
		await sawToolStart;
		sessionManager.branch(seedAssistant!.id);
		await harness.session.abort();
		await promptPromise;

		expect(sessionManager.getLeafId()).toBe(seedAssistant!.id);
		const backgroundLeaf = messageEntries(sessionManager).at(-1);
		expect(backgroundLeaf).toBeDefined();
		validateToolMessageSequence(convertToLlm(contextAt(sessionManager, backgroundLeaf!.id)));
	});

	it("turns malformed persisted tool context into a local error and allows tree recovery", async () => {
		const sessionManager = SessionManager.inMemory();
		sessionManager.appendMessage({ role: "user", content: "seed", timestamp: 1 });
		const seedAssistantId = sessionManager.appendMessage(fauxAssistantMessage("seed reply"));
		const malformedUserId = sessionManager.appendMessage({ role: "user", content: "bad turn", timestamp: 2 });
		const missingCall = fauxToolCall("missing", {});
		sessionManager.appendMessage(fauxAssistantMessage(missingCall, { stopReason: "toolUse" }));
		const harness = await createHarness({ sessionManager });
		harnesses.push(harness);
		harness.session.agent.state.messages = sessionManager.buildSessionContext().messages;
		harness.setResponses([fauxAssistantMessage("recovered")]);

		await harness.session.prompt("trigger local validation");

		expect(harness.getPendingResponseCount()).toBe(1);
		expect(harness.session.state.errorMessage).toMatch(/Invalid tool message sequence.*\/tree/);
		const failedAssistant = harness.session.messages.at(-1);
		expect(failedAssistant?.role).toBe("assistant");
		if (failedAssistant?.role === "assistant") {
			expect(failedAssistant.stopReason).toBe("error");
		}

		const navigation = await harness.session.navigateTree(malformedUserId, { summarize: false });
		expect(navigation.cancelled).toBe(false);
		expect(sessionManager.getLeafId()).toBe(seedAssistantId);
		await harness.session.prompt("recover on valid branch");
		expect(harness.getPendingResponseCount()).toBe(0);
		expect(getMessageText(harness.session.messages.at(-1))).toBe("recovered");
	});
});
