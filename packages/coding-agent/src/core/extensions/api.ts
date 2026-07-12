import type { ImageContent, TextContent } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionRuntime } from "./types.ts";

type SendUserMessageAndWaitHandler = (
	content: string | (TextContent | ImageContent)[],
	options?: { deliverAs?: "steer" | "followUp" },
) => Promise<void>;

const apiRuntimes = new WeakMap<ExtensionAPI, ExtensionRuntime>();
const runtimeHandlers = new WeakMap<ExtensionRuntime, SendUserMessageAndWaitHandler>();

export function registerAwaitableExtensionAPI(api: ExtensionAPI, runtime: ExtensionRuntime): void {
	apiRuntimes.set(api, runtime);
}

export function bindSendUserMessageAndWait(runtime: ExtensionRuntime, handler: SendUserMessageAndWaitHandler): void {
	runtimeHandlers.set(runtime, handler);
}

/** Send a user message and wait for delivery without changing the existing ExtensionAPI contract. */
export async function sendUserMessageAndWait(
	pi: ExtensionAPI,
	content: string | (TextContent | ImageContent)[],
	options?: { deliverAs?: "steer" | "followUp" },
): Promise<void> {
	const runtime = apiRuntimes.get(pi);
	const handler = runtime && runtimeHandlers.get(runtime);
	if (!handler) {
		throw new Error("Awaitable user message delivery is unavailable for this ExtensionAPI instance.");
	}
	return handler(content, options);
}
