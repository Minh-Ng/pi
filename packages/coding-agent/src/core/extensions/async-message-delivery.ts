import type { ImageContent, TextContent } from "@earendil-works/pi-ai/compat";
import type { ExtensionRuntime } from "./types.ts";

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
