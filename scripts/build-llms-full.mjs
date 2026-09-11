#!/usr/bin/env node
/**
 * Builds `llms-full.txt`: every document an agent needs, concatenated in
 * reading order. Run `pnpm docs:llms` after changing any of the sources below
 * and commit the result — it is what LLM crawlers and coding agents fetch.
 *
 * No dependencies, no dates, no network: the output is a pure function of the
 * sources, so re-running it on an unchanged tree produces an unchanged file.
 */
import console from 'node:console';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BLOB = 'https://github.com/aitofy-dev/bugdeck/blob/main';
const OUTPUT = 'llms-full.txt';

const SOURCES = [
  'README.md',
  'packages/widget/README.md',
  'packages/server/README.md',
  'packages/core/README.md',
  'CONTRIBUTING.md',
  'CHANGELOG.md',
];

const IMAGE = /(?:\[\s*)?!\[[^\]]*\]\([^)]*\)(?:\s*\]\([^)]*\))?/g;
const FENCE = /^\s*(?:```|~~~)/;

/** A line that is nothing but badges or a screenshot carries nothing in text. */
const isImageOnly = (line) => line.trim() !== '' && line.replace(IMAGE, '').trim() === '';

/** Relative links break once the files are one document; point them at GitHub. */
const absolutize = (line) =>
  line.replace(/\]\(\.\/([^)]+)\)/g, (_m, path) => `](${BLOB}/${path})`);

/** One H1 per source file, so every other heading moves down a level. */
const demote = (line) => line.replace(/^(#{1,5}) /, '#$1 ');

function normalize(markdown) {
  let inFence = false;
  const lines = [];
  for (const line of markdown.split('\n')) {
    if (FENCE.test(line)) inFence = !inFence;
    if (!inFence && isImageOnly(line)) continue;
    lines.push(inFence ? line : demote(absolutize(line)));
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function section(path) {
  const markdown = await readFile(join(ROOT, path), 'utf8').catch(() => {
    console.error(`${OUTPUT}: cannot read ${path}. Run this from the repository root.`);
    process.exit(1);
  });
  return `# ${path}\n\n${normalize(markdown)}`;
}

const preamble = [
  '# bugdeck — every document in one file',
  '',
  '> Open-source Marker.io / BugHerd alternative: a self-hosted visual bug-report widget for',
  '> React apps. Screenshot or element pick, annotate, send — the report lands on your own',
  '> server, behind your own auth, and is filed into your issue tracker.',
  '',
  'Generated from the sources below by `scripts/build-llms-full.mjs`; edit those, never this.',
  'The short index with links to each file on its own is `llms.txt`.',
  '',
  ...SOURCES.map((path) => `- ${path}`),
].join('\n');

const sections = [];
for (const path of SOURCES) sections.push(await section(path));

await writeFile(join(ROOT, OUTPUT), `${[preamble, ...sections].join('\n\n---\n\n')}\n`);
console.log(`${OUTPUT}: ${SOURCES.length} documents`);
