import type { ImageContent, TextContent } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "./types.ts";

/** Send a user message and wait for delivery without changing the existing ExtensionAPI contract. */
export async function sendUserMessageAndWait(
	pi: ExtensionAPI,
	content: string | (TextContent | ImageContent)[],
	options?: { deliverAs?: "steer" | "followUp" },
): Promise<void> {
	return pi.sendUserMessage(content, options);
}
