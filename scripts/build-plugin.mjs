#!/usr/bin/env node
// Build the WooCommerce plugin zip from woocommerce/ -> dist artifact named by plugin version.
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, rmSync, mkdtempSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'woocommerce');
const php = readFileSync(join(src, 'synchronity-woocommerce.php'), 'utf8');
const version = (php.match(/^\s*\*\s*Version:\s*([0-9.]+)/m) || [])[1] || '0.0.0';

// Stage under the plugin slug directory so the zip extracts to a proper plugin folder.
const stage = mkdtempSync(join(tmpdir(), 'syn-wc-'));
const slugDir = join(stage, 'synchronity-for-woocommerce');
cpSync(src, slugDir, { recursive: true });

const out = join(root, `synchronity-woocommerce-v${version}.zip`);
rmSync(out, { force: true });
execSync(`cd "${stage}" && zip -r -q "${out}" synchronity-for-woocommerce`, { stdio: 'inherit' });
rmSync(stage, { recursive: true, force: true });
console.log('Built', out);
