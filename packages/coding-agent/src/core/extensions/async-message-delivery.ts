import type { ImageContent, TextContent } from "@earendil-works/pi-ai/compat";
import type { ExtensionRuntime } from "./types.ts";

/**
 * Private bridge for ExtensionAPI.sendUserMessageAsync().
 *
 * Keep this handler out of ExtensionRuntime and ExtensionActions: those are existing
 * public contracts used by extension hosts. AgentSession binds the async operation
 * after creating the runtime, and the loader delegates the additive API method here.
 */
type SendUserMessageAsyncHandler = (
	content: string | (TextContent | ImageContent)[],
	options?: { deliverAs?: "steer" | "followUp" },
) => Promise<void>;

const handlers = new WeakMap<ExtensionRuntime, SendUserMessageAsyncHandler>();

export function bindSendUserMessageAsync(runtime: ExtensionRuntime, handler: SendUserMessageAsyncHandler): void {
	handlers.set(runtime, handler);
}

export async function sendUserMessageAsync(
	runtime: ExtensionRuntime,
	content: string | (TextContent | ImageContent)[],
	options?: { deliverAs?: "steer" | "followUp" },
): Promise<void> {
	runtime.assertActive();
	const handler = handlers.get(runtime);
	if (!handler) {
		throw new Error("Extension runtime not initialized. Action methods cannot be called during extension loading.");
	}
	return handler(content, options);
}
