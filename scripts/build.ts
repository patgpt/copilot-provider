/// <reference types="bun-types" />

import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, spawn } from "bun";

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const distDir = path.join(rootDir, "dist");
const cleanOnly = process.argv.includes("--clean-only");

async function cleanDist() {
	if (existsSync(distDir)) {
		await rm(distDir, { force: true, recursive: true });
	}

	if (!cleanOnly) {
		await mkdir(distDir, { recursive: true });
	}
}

function printLogs(
	logs: Array<{
		message: string;
		position?: {
			column?: number;
			file?: string;
			line?: number;
		} | null;
	}>,
) {
	for (const log of logs) {
		const location = log.position
			? `${log.position.file}:${log.position.line}:${log.position.column}`
			: undefined;
		const prefix = location == null ? "" : `${location} - `;
		console.error(`${prefix}${log.message}`);
	}
}

async function buildJavaScript() {
	const result = await build({
		entrypoints: [path.join(rootDir, "src/index.ts")],
		format: "esm",
		minify: true,
		outdir: distDir,
		packages: "external",
		sourcemap: "external",
		target: "node",
		tsconfig: path.join(rootDir, "tsconfig.json"),
	});

	if (!result.success) {
		printLogs(result.logs);
		throw new Error("JavaScript build failed.");
	}

	return result.outputs.map((output) => path.relative(rootDir, output.path));
}

async function buildTypes() {
	const processHandle = spawn({
		cmd: [process.execPath, "x", "tsc", "-p", "tsconfig.build.json"],
		cwd: rootDir,
		stderr: "inherit",
		stdout: "inherit",
	});

	const exitCode = await processHandle.exited;

	if (exitCode !== 0) {
		throw new Error(`Declaration build failed with exit code ${exitCode}.`);
	}
}

async function main() {
	await cleanDist();

	if (cleanOnly) {
		console.log("🧹 Cleaned dist/");
		return;
	}

	const startedAt = performance.now();
	const outputs = await buildJavaScript();
	await buildTypes();
	const elapsed = (performance.now() - startedAt).toFixed(2);

	console.log(
		`✅ Built ${outputs.length} file${outputs.length === 1 ? "" : "s"} in ${elapsed}ms`,
	);
	for (const output of outputs) {
		console.log(`   • ${output}`);
	}
}

await main();
