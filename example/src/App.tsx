"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { SparklesIcon } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";

import {
	Conversation,
	ConversationContent,
	ConversationEmptyState,
	ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
	Message,
	MessageContent,
	MessageResponse,
} from "@/components/ai-elements/message";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import {
	PromptInput,
	PromptInputSubmit,
	PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { Spinner } from "@/components/ui/spinner";

const starterPrompts = [
	"Give me a quick overview of how this copilot-provider works.",
	"Write a release note for version 0.1.0 of this package.",
	"Summarize the current limitations of using GitHub Copilot through this provider.",
];

interface SuggestionItemProps {
	onSuggestionClick: (text: string) => void;
	text: string;
}

const SuggestionItem = memo(
	({ text, onSuggestionClick }: SuggestionItemProps) => {
		const handleClick = useCallback(
			() => onSuggestionClick(text),
			[onSuggestionClick, text],
		);

		return <Suggestion onClick={handleClick} suggestion={text} />;
	},
);

SuggestionItem.displayName = "SuggestionItem";

function renderMessagePart(part: UIMessage["parts"][number], key: string) {
	switch (part.type) {
		case "text":
			return <MessageResponse key={key}>{part.text}</MessageResponse>;
		case "reasoning":
			return (
				<div
					className="rounded-md border border-dashed border-border/70 bg-muted/40 px-3 py-2 text-muted-foreground text-xs"
					key={key}
				>
					{part.text}
				</div>
			);
		case "file":
			return (
				<div
					className="rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-sm"
					key={key}
				>
					Attached file: {part.filename ?? part.mediaType ?? "Unnamed file"}
				</div>
			);
		default:
			return null;
	}
}

export function App() {
	const [message, setMessage] = useState("");
	const { messages, sendMessage, status, stop, error } = useChat({
		transport: new DefaultChatTransport({
			api: "/api/chat",
		}),
	});

	const isLoading = status === "submitted" || status === "streaming";
	const activeHint = useMemo(
		() =>
			error == null
				? "Provide COPILOT_GITHUB_TOKEN, GH_TOKEN, or GITHUB_TOKEN in the repo root .env and this demo will stream with the local provider."
				: error.message,
		[error],
	);

	const handleSendMessage = useCallback(
		async (promptMessage: PromptInputMessage) => {
			const trimmedText = promptMessage.text.trim();
			const hasText = trimmedText.length > 0;
			const hasAttachments = promptMessage.files.length > 0;

			if (!(hasText || hasAttachments) || isLoading) {
				return;
			}

			setMessage("");

			if (hasText && hasAttachments) {
				await sendMessage({ files: promptMessage.files, text: trimmedText });
				return;
			}

			if (hasAttachments) {
				await sendMessage({ files: promptMessage.files });
				return;
			}

			await sendMessage({ text: trimmedText });
		},
		[isLoading, sendMessage],
	);

	const handleSuggestionClick = useCallback((suggestion: string) => {
		setMessage(suggestion);
	}, []);

	const handleTextChange = useCallback(
		(event: React.ChangeEvent<HTMLTextAreaElement>) => {
			setMessage(event.target.value);
		},
		[],
	);

	return (
		<div className="grid min-h-screen w-full bg-background text-foreground lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,420px)]">
			<section className="flex min-h-screen flex-col border-border/70 lg:border-r">
				<div className="border-border/70 border-b px-6 py-5">
					<div className="flex items-center gap-3">
						<div className="rounded-full bg-primary/10 p-2 text-primary">
							<SparklesIcon className="size-5" />
						</div>
						<div>
							<p className="font-medium text-lg">copilot-provider demo</p>
							<p className="text-muted-foreground text-sm">
								AI SDK `useChat` hooked up to the local provider.
							</p>
						</div>
					</div>
				</div>

				<Conversation>
					<ConversationContent className="mx-auto w-full max-w-4xl px-6 py-8">
						{messages.length === 0 ? (
							<ConversationEmptyState
								description="Ask anything once your GitHub token is configured. Attachments from the latest user message are forwarded too."
								icon={<SparklesIcon className="size-8" />}
								title="Ready when you are"
							>
								<div className="space-y-6">
									<div className="space-y-2 text-center">
										<h2 className="font-semibold text-3xl">
											Chat with GitHub Copilot through your provider
										</h2>
										<p className="mx-auto max-w-2xl text-muted-foreground text-sm">
											This example streams responses from `/api/chat` using
											`streamText`, `convertToModelMessages`, and the provider
											exported from this repository.
										</p>
									</div>
									<Suggestions>
										{starterPrompts.map((prompt) => (
											<SuggestionItem
												key={prompt}
												onSuggestionClick={handleSuggestionClick}
												text={prompt}
											/>
										))}
									</Suggestions>
								</div>
							</ConversationEmptyState>
						) : (
							messages.map((chatMessage) => (
								<Message from={chatMessage.role} key={chatMessage.id}>
									<MessageContent>
										{chatMessage.parts.map((part, index) =>
											renderMessagePart(part, `${chatMessage.id}-${index}`),
										)}
									</MessageContent>
								</Message>
							))
						)}

						{status === "submitted" && (
							<Message from="assistant">
								<MessageContent>
									<p className="flex items-center gap-2 text-muted-foreground text-sm">
										<Spinner />
										Sending your message to Copilot...
									</p>
								</MessageContent>
							</Message>
						)}
					</ConversationContent>

					<ConversationScrollButton />
				</Conversation>

				<div className="border-border/70 border-t bg-background/95 px-6 py-4 backdrop-blur">
					<div className="mx-auto w-full max-w-4xl space-y-3">
						{error && (
							<div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-destructive text-sm">
								{error.message}
							</div>
						)}

						<PromptInput className="relative" onSubmit={handleSendMessage}>
							<PromptInputTextarea
								className="min-h-18 pr-14"
								onChange={handleTextChange}
								placeholder="Ask Copilot anything supported by your local provider..."
								value={message}
							/>
							<PromptInputSubmit
								className="absolute right-2 bottom-2"
								disabled={status === "submitted"}
								onStop={stop}
								status={status}
							/>
						</PromptInput>

						<p className="text-muted-foreground text-xs">{activeHint}</p>
					</div>
				</div>
			</section>

			<aside className="border-border/70 border-t bg-muted/20 px-6 py-8 lg:border-t-0">
				<div className="mx-auto flex h-full max-w-md flex-col gap-6">
					<div className="space-y-2">
						<p className="font-medium text-lg">How this example works</p>
						<p className="text-muted-foreground text-sm">
							The Bun server exposes `/api/chat`, converts UI messages into
							model messages, and streams the response back to the client with
							the local provider.
						</p>
					</div>

					<div className="space-y-3 rounded-2xl border border-border/70 bg-background p-5 shadow-sm">
						<h3 className="font-medium">Authentication</h3>
						<ul className="list-disc space-y-2 pl-5 text-muted-foreground text-sm">
							<li>Set `COPILOT_GITHUB_TOKEN` in the repo root `.env` file.</li>
							<li>
								You can also rely on `GH_TOKEN` or `GITHUB_TOKEN` if that is how
								you authenticate locally.
							</li>
							<li>
								If you are already authenticated with the GitHub Copilot
								tooling, the provider can reuse that session.
							</li>
						</ul>
					</div>

					<div className="space-y-3 rounded-2xl border border-border/70 bg-background p-5 shadow-sm">
						<h3 className="font-medium">Request path</h3>
						<div className="rounded-lg bg-muted px-3 py-2 font-mono text-sm">
							POST /api/chat
						</div>
						<p className="text-muted-foreground text-sm">
							The route uses `streamText()` and returns
							`toUIMessageStreamResponse()` so the chat hook can parse the
							stream correctly.
						</p>
					</div>

					<div className="space-y-3 rounded-2xl border border-border/70 bg-background p-5 shadow-sm">
						<h3 className="font-medium">Why it should work with a key</h3>
						<p className="text-muted-foreground text-sm">
							Yes — if a user provides a valid GitHub token, this demo passes it
							to the local provider and the request streams through the GitHub
							Copilot SDK.
						</p>
					</div>
				</div>
			</aside>
		</div>
	);
}
