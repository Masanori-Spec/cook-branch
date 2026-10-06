#!/usr/bin/env node
// Imports the compiler only to generate inputs, never expectations.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { analyze, select, compile } from '../src/compiler.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
assert(args.length === 0 || (args.length === 2 && args[0] === '--output-dir'), 'Use --output-dir DIRECTORY');
const out = path.resolve(args[1] || path.join(root, 'artifacts/oracles'));
await fs.mkdir(out, {recursive:true});
const manifest = JSON.parse(await fs.readFile(path.join(root, 'fixtures/oracle-manifest.json'), 'utf8'));
const source = await fs.readFile(path.join(root, 'fixtures/orchard-bowl.cook'), 'utf8');
const analysis = await analyze(source);
const results = [];
for (const [key, expected] of Object.entries(manifest.cases)) {
  const active = select(analysis, expected.variant);
  assert.equal(active.alternatives.length, 1, 'Original matrix has one active explicit alternative');
  const alternative = active.alternatives[0];
  assert.equal(alternative.options.length, 2);
  const choices = {[alternative.id]:alternative.options[expected.alternativeIndex].id};
  const compiled = await compile(source, {sourceHash:analysis.sourceHash, variant:expected.variant, choices});
  const output = path.join(out, `${key}.cook`);
  await fs.writeFile(output, compiled.text);
  await fs.writeFile(path.join(out, `${key}.receipt.json`), JSON.stringify(compiled.receipt,null,2)+'\n');
  const checked = spawnSync('python3', [path.join(root, 'scripts/oracle_validate.py'), '--file', output,
    '--variant',expected.variant,'--grain',expected.grain], {encoding:'utf8'});
  if (checked.status !== 0) {
    console.error(checked.stdout || 'Oracle validator failed');
    process.exit(1);
  }
  const report = JSON.parse(checked.stdout);
  assert.equal(report.status, 'pass');
  await fs.writeFile(path.join(out, `${key}.evidence.json`), JSON.stringify(report,null,2)+'\n');
  results.push({case:key, status:'pass', exportSha256:report.exportSha256, oracles:report.oracles});
  console.log(`PASS actual compiler export: ${key} (handwritten + extension + native recipe/shopping)`);
}
const control = spawnSync('python3',[path.join(root,'scripts/oracle_validate.py'),'--negative-control'],{encoding:'utf8'});
assert.equal(control.status,0,control.stdout || 'Native semantic negative control failed');
const negativeControl = JSON.parse(control.stdout);
await fs.writeFile(path.join(out,'negative-control.evidence.json'),JSON.stringify(negativeControl,null,2)+'\n');
await fs.writeFile(path.join(out,'matrix.evidence.json'),JSON.stringify({status:'pass',origin:'actual-compiler',
  fixture:'Orchard Bowl', cases:results, negativeControl},null,2)+'\n');
console.log('PASS native semantic negative control: unprepared extension source leaks both branches');
