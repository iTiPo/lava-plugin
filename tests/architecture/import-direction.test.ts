import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = path.resolve(import.meta.dirname, '../../src');

/** Relative import edges that must not exist (from → to). */
const FORBIDDEN_EDGES: Array<{ from: string; to: string; reason: string }> = [
	{
		from: 'ai',
		to: 'chat',
		reason: 'AI orchestration must not depend on chat persistence/session types',
	},
	{
		from: 'mcp',
		to: 'chat',
		reason: 'MCP policy/tools must not depend on chat persistence/session types',
	},
	{
		from: 'mcp',
		to: 'ai',
		reason: 'MCP layer must stay below AI agent wiring',
	},
	{
		from: 'domain',
		to: 'ai',
		reason: 'Domain contracts must stay dependency-free of feature layers',
	},
	{
		from: 'domain',
		to: 'chat',
		reason: 'Domain contracts must stay dependency-free of feature layers',
	},
	{
		from: 'domain',
		to: 'mcp',
		reason: 'Domain contracts must stay dependency-free of feature layers',
	},
];

const IMPORT_RE =
	/(?:import|export)\s+(?:type\s+)?(?:[^'"\n]+?\s+from\s+)?['"](\.[^'"]+)['"]/g;

async function listSourceFiles(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await listSourceFiles(fullPath)));
			continue;
		}
		if (/\.(ts|svelte)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
			files.push(fullPath);
		}
	}
	return files;
}

function layerOf(filePath: string): string | undefined {
	const relative = path.relative(SRC_ROOT, filePath).split(path.sep);
	return relative[0];
}

function resolveImportLayer(fromFile: string, specifier: string): string | undefined {
	const resolved = path.resolve(path.dirname(fromFile), specifier);
	const withoutExt = resolved.replace(/\.(ts|js|svelte)$/, '');
	const candidates = [
		`${withoutExt}.ts`,
		`${withoutExt}.svelte`,
		path.join(withoutExt, 'index.ts'),
	];
	for (const candidate of candidates) {
		const relative = path.relative(SRC_ROOT, candidate);
		if (relative.startsWith('..')) continue;
		const parts = relative.split(path.sep);
		if (parts[0]) return parts[0];
	}
	const relativeDir = path.relative(SRC_ROOT, withoutExt);
	if (relativeDir.startsWith('..')) return undefined;
	return relativeDir.split(path.sep)[0];
}

describe('module dependency direction', () => {
	it('forbids ai/mcp/domain from importing upward into chat or peer layers', async () => {
		const files = await listSourceFiles(SRC_ROOT);
		const violations: string[] = [];

		for (const file of files) {
			const fromLayer = layerOf(file);
			if (!fromLayer) continue;

			const source = await readFile(file, 'utf8');
			for (const match of source.matchAll(IMPORT_RE)) {
				const specifier = match[1];
				if (!specifier?.startsWith('.')) continue;
				const toLayer = resolveImportLayer(file, specifier);
				if (!toLayer || toLayer === fromLayer) continue;

				for (const edge of FORBIDDEN_EDGES) {
					if (edge.from === fromLayer && edge.to === toLayer) {
						const relative = path.relative(SRC_ROOT, file);
						violations.push(
							`${relative} imports ${specifier} (${fromLayer} → ${toLayer}): ${edge.reason}`,
						);
					}
				}
			}
		}

		expect(violations).toEqual([]);
	});
});
