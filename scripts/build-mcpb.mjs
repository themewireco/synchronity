#!/usr/bin/env node
// Build the Synchronity Claude Desktop extension: zips desktop-extension/ -> synchronity.mcpb
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { rmSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'synchronity.mcpb');
rmSync(out, { force: true });
execSync(`cd "${join(root, 'desktop-extension')}" && zip -r -q "${out}" manifest.json server icon.png`, { stdio: 'inherit' });
console.log('Built', out);
