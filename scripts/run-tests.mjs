#!/usr/bin/env node
// Runs `node --check` on every source file, then every tests/test-*.mjs in its own process.
import { readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const walk = dir => readdirSync(dir).flatMap(f => {
  const p = path.join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : /\.(m?js|cjs)$/.test(f) ? [p] : [];
});
let failed = 0;
const sources = [...walk(path.join(root, 'src')), path.join(root, 'server.cjs'), ...walk(path.join(root, 'scripts'))];
for (const file of sources) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) { failed++; console.log(`FAIL check ${path.relative(root, file)}\n${r.stderr}`); }
}
console.log(`check: ${sources.length - failed}/${sources.length}`);
const tests = readdirSync(path.join(root, 'tests')).filter(f => /^test-.*\.mjs$/.test(f)).sort();
let passed = 0;
for (const t of tests) {
  const started = Date.now();
  const r = spawnSync(process.execPath, [path.join(root, 'tests', t)], { encoding: 'utf8', cwd: root, timeout: 240000 });
  const ms = Date.now() - started;
  if (r.status === 0) { passed++; console.log(`ok   ${t} (${ms} ms) ${r.stdout.trim().split('\n').pop()}`); }
  else { failed++; console.log(`FAIL ${t} (${ms} ms)\n${(r.stdout + r.stderr).trim().split('\n').slice(-25).join('\n')}`); }
}
console.log(`tests: ${passed}/${tests.length}`);
process.exit(failed ? 1 : 0);
