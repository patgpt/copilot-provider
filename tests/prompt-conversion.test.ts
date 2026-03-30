import { describe, expect, it } from "bun:test";

import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";

import { prepareCopilotPrompt } from "../src/prompt-conversion";

function createCallOptions(
	overrides: Partial<LanguageModelV3CallOptions>,
): LanguageModelV3CallOptions {
	return {
		prompt: [],
		...overrides,
	};
}

describe("prepareCopilotPrompt", () => {
	it("keeps a single user message as the direct Copilot prompt", () => {
		const prepared = prepareCopilotPrompt(
			createCallOptions({
				prompt: [
					{
						content: [
							{ text: "Explain quicksort in one paragraph.", type: "text" },
						],
						role: "user",
					},
				],
			}),
		);

		expect(prepared.prompt).toBe("Explain quicksort in one paragraph.");
		expect(prepared.systemMessage).toBeUndefined();
		expect(prepared.attachments).toBeUndefined();
		expect(prepared.warnings).toHaveLength(0);
	});

	it("forwards the latest user file part as a Copilot blob attachment", () => {
		const prepared = prepareCopilotPrompt(
			createCallOptions({
				prompt: [
					{
						content: [
							{ text: "What is in this image?", type: "text" },
							{
								data: new Uint8Array([1, 2, 3, 4]),
								filename: "diagram.png",
								mediaType: "image/png",
								type: "file",
							},
						],
						role: "user",
					},
				],
			}),
		);

		expect(prepared.attachments).toEqual([
			{
				data: Buffer.from([1, 2, 3, 4]).toString("base64"),
				displayName: "diagram.png",
				mimeType: "image/png",
				type: "blob",
			},
		]);
	});

	it("flattens multi-turn history into a transcript and warns about compatibility", () => {
		const prepared = prepareCopilotPrompt(
			createCallOptions({
				prompt: [
					{ content: "Answer crisply.", role: "system" },
					{
						content: [{ text: "What is Bun?", type: "text" }],
						role: "user",
					},
					{
						content: [{ text: "A JavaScript runtime.", type: "text" }],
						role: "assistant",
					},
					{
						content: [{ text: "Compare it with Node.js.", type: "text" }],
						role: "user",
					},
				],
			}),
		);

		expect(prepared.systemMessage).toBe("Answer crisply.");
		expect(prepared.prompt).toContain("<conversation>");
		expect(prepared.prompt).toContain("<assistant>");
		expect(
			prepared.warnings.some(
				(warning) =>
					warning.type === "compatibility" && warning.feature === "prompt",
			),
		).toBe(true);
	});

	it("injects JSON instructions into the Copilot system message", () => {
		const prepared = prepareCopilotPrompt(
			createCallOptions({
				prompt: [
					{
						content: [{ text: "Return a person object.", type: "text" }],
						role: "user",
					},
				],
				responseFormat: {
					schema: {
						properties: {
							name: { type: "string" },
						},
						required: ["name"],
						type: "object",
					},
					type: "json",
				},
			}),
		);

		expect(prepared.systemMessage).toContain("JSON schema:");
		expect(prepared.systemMessage).toContain(
			"You MUST answer with a JSON object",
		);
		expect(
			prepared.warnings.some(
				(warning) =>
					warning.type === "compatibility" &&
					warning.feature === "responseFormat",
			),
		).toBe(true);
	});
});
