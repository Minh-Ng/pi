import { describe, expect, it } from "vitest";
import { SessionManager } from "../../src/core/session-manager.ts";

function userMessage(text: string, timestamp: number) {
	return { role: "user" as const, content: text, timestamp };
}

describe("SessionManager explicit-parent appends", () => {
	it("persists a background branch without stealing the visible leaf", () => {
		const session = SessionManager.inMemory();
		const visibleLeafId = session.appendMessage(userMessage("visible", 1));

		const background = session.appendMessageAt(userMessage("background", 2), visibleLeafId);
		expect(background.advancedLeaf).toBe(false);
		expect(session.getLeafId()).toBe(visibleLeafId);

		const backgroundFollowUp = session.appendMessageAt(userMessage("background follow-up", 3), background.id);
		expect(backgroundFollowUp.advancedLeaf).toBe(false);
		expect(session.getLeafId()).toBe(visibleLeafId);
		expect(session.getBranch(backgroundFollowUp.id).map((entry) => entry.id)).toEqual([
			visibleLeafId,
			background.id,
			backgroundFollowUp.id,
		]);
	});

	it("advances the leaf only when compare-and-swap ownership still matches", () => {
		const session = SessionManager.inMemory();
		const initialLeafId = session.appendMessage(userMessage("initial", 1));

		const owned = session.appendMessageAt(userMessage("owned", 2), initialLeafId, {
			advanceLeafIfCurrent: initialLeafId,
		});
		expect(owned.advancedLeaf).toBe(true);
		expect(session.getLeafId()).toBe(owned.id);

		const stale = session.appendMessageAt(userMessage("stale", 3), initialLeafId, {
			advanceLeafIfCurrent: initialLeafId,
		});
		expect(stale.advancedLeaf).toBe(false);
		expect(session.getLeafId()).toBe(owned.id);
	});
});
