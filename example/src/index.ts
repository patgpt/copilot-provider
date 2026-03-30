import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { serve } from "bun";

import { createCopilot } from "../../src/index";
import index from "./index.html";

const defaultModel = Bun.env.BUN_PUBLIC_COPILOT_MODEL ?? "gpt-5";

function createChatModel(modelId = defaultModel) {
	const githubToken =
		Bun.env.COPILOT_GITHUB_TOKEN ?? Bun.env.GH_TOKEN ?? Bun.env.GITHUB_TOKEN;

	const provider = createCopilot(
		githubToken == null || githubToken.length === 0
			? {}
			: {
					githubToken,
					useLoggedInUser: false,
				},
	);

	return provider(modelId);
}

const server = serve({
	development: process.env.NODE_ENV !== "production" && {
		console: true,
		hmr: true,
	},
	routes: {
		"/*": index,
		"/api/chat": {
			async POST(request) {
				const body = (await request.json()) as {
					messages?: UIMessage[];
					model?: string;
				};

				const messages = body.messages ?? [];

				const result = streamText({
					abortSignal: request.signal,
					messages: await convertToModelMessages(messages),
					model: createChatModel(body.model),
					system:
						"You are a helpful assistant running through the local copilot-provider example. Be concise, accurate, and transparent about any platform limits.",
				});

				return result.toUIMessageStreamResponse({
					onError: (error) =>
						error instanceof Error
							? error.message
							: "The request failed before Copilot could respond.",
					originalMessages: messages,
				});
			},
		},

		"/api/hello": {
			async GET() {
				return Response.json({
					message: "Hello, world!",
					method: "GET",
				});
			},
			async PUT() {
				return Response.json({
					message: "Hello, world!",
					method: "PUT",
				});
			},
		},

		"/api/hello/:name": (request) =>
			Response.json({
				message: `Hello, ${request.params.name}!`,
			}),
	},
});

console.log(`🚀 Server running at ${server.url}`);
