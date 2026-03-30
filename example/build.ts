#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "bun";

const exampleDir = path.dirname(fileURLToPath(import.meta.url));
const outdir = path.join(exampleDir, "dist");

const formatFileSize = (bytes: number): string => {
	const units = ["B", "KB", "MB", "GB"];
	let size = bytes;
	let unitIndex = 0;

	while (size >= 1024 && unitIndex < units.length - 1) {
		size /= 1024;
		unitIndex++;
	}

	return `${size.toFixed(2)} ${units[unitIndex]}`;
};

console.log("\n🚀 Starting build process...\n");

if (existsSync(outdir)) {
	console.log(`🗑️ Cleaning previous build at ${outdir}`);
	await rm(outdir, { force: true, recursive: true });
}

await mkdir(outdir, { recursive: true });

const start = performance.now();

const result = await build({
	entrypoints: [path.join(exampleDir, "src/index.ts")],
	format: "esm",
	minify: true,
	outdir,
	packages: "external",
	sourcemap: "external",
	target: "bun",
	tsconfig: path.join(exampleDir, "tsconfig.json"),
});

if (!result.success) {
	for (const log of result.logs) {
		console.error(log.message);
	}

	throw new Error("Example build failed.");
}

const end = performance.now();

const outputTable = result.outputs.map((output) => ({
	File: path.relative(process.cwd(), output.path),
	Size: formatFileSize(output.size),
	Type: output.kind,
}));

console.table(outputTable);
const buildTime = (end - start).toFixed(2);

console.log(`\n✅ Build completed in ${buildTime}ms\n`);
