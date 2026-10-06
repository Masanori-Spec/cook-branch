import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { analyze, select, compile, hashSource, CookBranchError, DIALECT, RECEIPT_SCHEMA } from '../src/compiler.js';

const orchard = `---
title: Orchard Bowl
servings: 2
---

== Base ==

Mix @cooked barley{180%g}|cooked rice{200%g} with @peas{60%g} in a #bowl{}.

[*] Fold in @lemon juice{15%ml}.

[herb] Fold in @herb dressing{25%ml}.

== [herb] Finish ==

Add @parsley{3%g}, then wait for ~rest{2%minutes}.
`;
async function decide(source, variant = '*', indexes = []) {
  const a = await analyze(source), selected = select(a, variant);
  return { sourceHash: a.sourceHash, variant, choices: Object.fromEntries(selected.alternatives.map((a, i) => [a.id, a.options[indexes[i] ?? 0].id])) };
}
async function run(source, variant = '*', indexes = []) { return compile(source, await decide(source, variant, indexes)); }
function code(expected) { return error => error instanceof CookBranchError && error.code === expected; }

for (const variant of ['*', 'herb']) for (const index of [0, 1]) {
  test(`orchard matrix: ${variant}, option ${index}`, async () => {
    const result = await run(orchard, variant, [index]);
    const grain = index === 0 ? '@cooked barley{180%g}' : '@cooked rice{200%g}';
    const expected = `---\ntitle: Orchard Bowl\nservings: 2\n---\n\n== Base ==\n\nMix ${grain} with @peas{60%g} in a #bowl{}.\n\n` +
      (variant === '*' ? 'Fold in @lemon juice{15%ml}.\n\n' : 'Fold in @herb dressing{25%ml}.\n\n== Finish ==\n\nAdd @parsley{3%g}, then wait for ~rest{2%minutes}.\n');
    assert.equal(result.text, expected);
    assert.deepEqual(result.preview.after.ingredients.map(i => [i.name, i.quantity, i.unit]), [
      index === 0 ? ['cooked barley', '180', 'g'] : ['cooked rice', '200', 'g'], ['peas', '60', 'g'],
      variant === '*' ? ['lemon juice', '15', 'ml'] : ['herb dressing', '25', 'ml'], ...(variant === '*' ? [] : [['parsley', '3', 'g']])
    ]);
    assert.equal(result.preview.after.cookware.length, 1);
    assert.equal(result.preview.after.timers.length, variant === '*' ? 0 : 1);
    assert.equal(result.preview.after.steps.length, variant === '*' ? 2 : 3);
    assert.equal(result.receipt.schema, RECEIPT_SCHEMA);
    assert.equal(result.receipt.dialect, DIALECT);
    assert.equal(result.receipt.selectedOccurrences.length, 1);
    assert.ok(result.receipt.removedBranches.length > 0);
    assert.equal(result.receipt.outputHash, createHash('sha256').update(expected).digest('hex'));
    assert.deepEqual(await compile(orchard, JSON.parse(JSON.stringify(result.receipt))), result);
  });
}

test('hash is genuine deterministic SHA-256 of the exact source bytes', async () => {
  assert.equal(await hashSource('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.notEqual(await hashSource('a\nb'), await hashSource('a\r\nb'));
  assert.notEqual(await hashSource('é'), await hashSource('e\u0301'));
});

test('explicit choice required even for the first option', async () => {
  const a = await analyze(orchard);
  await assert.rejects(compile(orchard, { sourceHash: a.sourceHash, variant: 'herb', choices: {} }), code('MISSING_CHOICE'));
  await assert.rejects(compile(orchard, { sourceHash: a.sourceHash, choices: {} }), code('UNKNOWN_VARIANT'));
});

test('repeated ingredient names have distinct occurrence-specific decisions', async () => {
  const source = 'Mix @milk{1%cup}|water{2%cup} and @milk{3%cup}|water{4%cup}.\n';
  const a = await analyze(source);
  assert.equal(new Set(a.alternatives.map(a => a.id)).size, 2);
  const output = await run(source, '*', [1, 0]);
  assert.equal(output.text, 'Mix @water{2%cup} and @milk{3%cup}.\n');
  const decision = await decide(source);
  decision.choices[a.alternatives[1].id] = a.alternatives[0].options[1].id;
  await assert.rejects(compile(source, decision), code('INVALID_CHOICE'));
});

test('fractions, textual quantities, ingredient notes and prose survive exactly', async () => {
  const source = 'Mix gently: @milk{1 1/2%cup}[herb]|crème fraîche{¾%cup}[not herb; optional flavor], then @salt{to taste}. Do not stir again!\n';
  const a = await analyze(source);
  assert.deepEqual(a.variants, ['*']);
  const result = await run(source, '*', [1]);
  assert.equal(result.text, 'Mix gently: @crème fraîche{¾%cup}[not herb; optional flavor], then @salt{to taste}. Do not stir again!\n');
  assert.equal(result.preview.after.ingredients[0].quantity, '¾');
  assert.equal(result.preview.after.ingredients[0].note, 'not herb; optional flavor');
});

test('CRLF, Unicode and source locations are preserved', async () => {
  const source = '>> title: 朝ごはん 🍚\r\n\r\n[和風] 混ぜる @米{1/2%合}|麦{1/3%合}。\r\n';
  const a = await analyze(source), alternative = a.alternatives[0];
  assert.equal(alternative.line, 3);
  assert.equal(alternative.column, 10);
  assert.equal(alternative.id, `alt:${source.indexOf('@')}`);
  const result = await run(source, '和風', [1]);
  assert.equal(result.text, '>> title: 朝ごはん 🍚\r\n\r\n混ぜる @麦{1/3%合}。\r\n');
  assert.equal(result.text.replaceAll('\r\n', '').includes('\n'), false);
});

test('exact, case-sensitive tags and section/step intersection', async () => {
  const source = '== [*,herb,herbal] Base ==\n\nShared prose.\n\n[herb,herbal] Both named.\n\n[herb] Herb only.\n\n[herbal] Herbal only.\n\n== [Herb] Other ==\n\nCapital only.\n';
  const a = await analyze(source);
  assert.deepEqual(a.variants, ['*', 'herb', 'herbal', 'Herb']);
  assert.equal(select(a, '*').steps.length, 1);
  assert.deepEqual(select(a, 'herb').steps.map(s => s.body), ['Shared prose.', 'Both named.', 'Herb only.']);
  assert.deepEqual(select(a, 'Herb').steps.map(s => s.body), ['Capital only.']);
  assert.throws(() => select(a, 'her'), code('UNKNOWN_VARIANT'));
  assert.throws(() => select(a, 'HERB'), code('UNKNOWN_VARIANT'));
});

test('step survives only when both section and step include variant', async () => {
  const source = '== [herb,hot] Base ==\n\n[herb,cold] Add @mint{2%g}.\n\n== Other ==\n\nFinish.';
  const a = await analyze(source);
  assert.equal(select(a, 'cold').steps.length, 1);
  assert.equal(select(a, 'hot').steps.length, 1);
  assert.equal(select(a, 'herb').steps.length, 2);
});

test('only surviving alternatives accept or require choices', async () => {
  const source = '[*] Add @apple{1}|pear{2}.\n\n[herb] Add @mint{3}|basil{4}.\n';
  const a = await analyze(source), d = await decide(source, 'herb', [1]);
  assert.equal(select(a, 'herb').alternatives.length, 1);
  assert.equal((await compile(source, d)).text, 'Add @basil{4}.\n');
  d.choices[a.alternatives[0].id] = a.alternatives[0].options[0].id;
  await assert.rejects(compile(source, d), code('STALE_CHOICE'));
});

test('any source edit invalidates the receipt, even a metadata edit', async () => {
  const result = await run(orchard, 'herb');
  await assert.rejects(compile(orchard.replace('Orchard Bowl', 'Another Bowl'), result.receipt), code('STALE_SOURCE'));
  await assert.rejects(compile(orchard + ' ', result.receipt), code('STALE_SOURCE'));
  await assert.rejects(compile(orchard, { variant: 'herb', choices: {} }), code('STALE_SOURCE'));
});

test('receipts detect tampered derived records and output hash', async () => {
  const result = await run(orchard, 'herb');
  for (const edit of [{ outputHash: 'bad' }, { schema: 'unknown' }, { dialect: 'unknown' }, { selectedOccurrences: [] }, { removedBranches: [] }]) {
    await assert.rejects(compile(orchard, { ...result.receipt, ...edit }), code('INVALID_RECEIPT'));
  }
});

test('metadata and comments remain opaque, with no invented choices', async () => {
  const source = '---\ntitle: "@fake{}|fiction{}"\nnotes: "[?] {{scale}}"\n---\n\n>> source: https://example.test/a|b\n\n-- @ghost{}|phantom{}\n\nMix @salt{} -- @fake{}|false{}\nwith care [- @other{}|never{} -].\n';
  const a = await analyze(source);
  assert.equal(a.alternatives.length, 0);
  assert.equal((await run(source)).text, source);
  assert.deepEqual((await run(source)).preview.after.ingredients.map(i => i.name), ['salt']);
});

test('ordinary notes stay prose and scoped notes are filtered', async () => {
  const source = '> A note with @literal{} text.\n\n[*] > Default note.\n\n[herb] > Herb note.\n\nStir.\n';
  const result = await run(source, 'herb');
  assert.equal(result.text, '> A note with @literal{} text.\n\n> Herb note.\n\nStir.\n');
  assert.deepEqual(result.preview.after.ingredients, []);
});

test('tag-only first line and multiline instruction retain intended step', async () => {
  const source = '[herb]\nFold @parsley{3%g}\nin very slowly.\n';
  const result = await run(source, 'herb');
  assert.equal(result.text, 'Fold @parsley{3%g}\nin very slowly.\n');
  assert.equal(result.preview.after.steps.length, 1);
});

test('ordinary no-alternative recipe round-trips without formatting changes', async () => {
  const source = '>> title: Plain\n\n= Start =\n\n  Fold @salt, @pepper and @olive oil{1/4%tbsp} in a #pan.\nKeep warm for ~{2%minutes}.\n';
  assert.equal((await run(source)).text, source);
});

test('preview explicitly lists removed branches, choices and full prose', async () => {
  const result = await run(orchard, 'herb', [1]);
  assert.equal(result.preview.before.ingredients.length, 6);
  assert.deepEqual(result.preview.ingredientDifferences.removed.map(i => i.name), ['cooked barley', 'lemon juice']);
  assert.equal(result.preview.ingredientDifferences.selected[0].name, 'cooked rice');
  assert.equal(result.preview.instructionDifferences.removed[0].text, '[*] Fold in @lemon juice{15%ml}.');
  assert.equal(result.preview.after.steps[0].text, 'Mix @cooked rice{200%g} with @peas{60%g} in a #bowl{}.');
});

const unsupported = [
  ['Add @|milk|milk{2}.', 'UNSUPPORTED_MODIFIER'],
  ['Add @?salt{2}.', 'UNSUPPORTED_MODIFIER'],
  ['Add @-salt{2}.', 'UNSUPPORTED_MODIFIER'],
  ['Add @&salt{2}.', 'UNSUPPORTED_MODIFIER'],
  ['Add @@sauce{}.', 'UNSUPPORTED_MODIFIER'],
  ['Add @./sauce{}.', 'UNSUPPORTED_MODIFIER'],
  ['Add @../sauce{}.', 'UNSUPPORTED_MODIFIER'],
  ['Use #?pan{}.', 'UNSUPPORTED_MODIFIER'],
  ['[?] Add salt.', 'UNSUPPORTED_OPTIONAL'],
  ['== [?herb] Base ==\n\nStir.', 'UNSUPPORTED_OPTIONAL'],
  ['Add @flour{100%g|3.5%oz}.', 'UNSUPPORTED_UNIT_ALTERNATIVE'],
  ['Cook for {{2%hours}}.', 'UNSUPPORTED_SCALING'],
  ['Add @flour{2*%g}.', 'UNSUPPORTED_SCALING'],
  ['Add @flour{=2%g}.', 'UNSUPPORTED_SCALING'],
  ['Add @milk{}|?water{}.', 'UNSUPPORTED_MODIFIER'],
  ['Add @milk{}|@water{}.', 'UNSUPPORTED_MODIFIER'],
  ['Use #pan{}|bowl{}.', 'UNSUPPORTED_PIPE'],
  ['Add @milk{} |water{}.', 'UNSUPPORTED_PIPE'],
  ['Add @name|alias{}.', 'MALFORMED_ALTERNATIVE'],
  ['Add @salt\\{}.', 'UNSUPPORTED_ESCAPE'],
];
for (const [source, expected] of unsupported) test(`rejects unsupported syntax: ${source}`, async () => {
  await assert.rejects(analyze(source), code(expected));
});

const malformed = [
  ['[herb Add salt.', 'MALFORMED_SCOPE'],
  ['[] Add salt.', 'MALFORMED_SCOPE'],
  ['[herb,] Add salt.', 'MALFORMED_SCOPE'],
  ['[herb,herb] Add salt.', 'MALFORMED_SCOPE'],
  ['[herb][hot] Add salt.', 'MALFORMED_SCOPE'],
  ['[herb] [hot] Add salt.', 'MALFORMED_SCOPE'],
  ['[herb]Add salt.', 'MALFORMED_SCOPE'],
  ['[herb]\n\nStir.', 'MALFORMED_SCOPE'],
  ['Stir.\n[herb] Add salt.', 'MALFORMED_SCOPE'],
  ['== [herb] Base ==\n\n[*] Add salt.', 'CONTRADICTORY_SCOPE'],
  ['== [herb] Base ==\n\n[hot] Add salt.', 'CONTRADICTORY_SCOPE'],
  ['Add @salt{2%g.', 'MALFORMED_TOKEN'],
  ['Add @salt{{2}%g}.', 'MALFORMED_TOKEN'],
  ['Add @salt{2%%g}.', 'MALFORMED_TOKEN'],
  ['Add @salt{2%}.', 'MALFORMED_TOKEN'],
  ['Add @salt{}[unclosed.', 'MALFORMED_NOTE'],
  ['Add @salt{}[nested[note]].', 'MALFORMED_NOTE'],
  ['Add @milk{}|water.', 'MALFORMED_ALTERNATIVE'],
  ['Add @milk|water{}.', 'MALFORMED_ALTERNATIVE'],
  ['Add @milk{}||water{}.', 'UNSUPPORTED_MODIFIER'],
  ['Add @milk{}|.', 'MALFORMED_ALTERNATIVE'],
  ['Stir {2}.', 'MALFORMED_TOKEN'],
  ['Wait ~rest{}.', 'MALFORMED_TOKEN'],
  ['Stir [- unfinished.', 'MALFORMED_COMMENT'],
  ['---\ntitle: Missing close\n\nStir.', 'MALFORMED_METADATA'],
  ['', 'EMPTY_RECIPE'],
  ['>> title: Metadata only', 'EMPTY_RECIPE'],
];
for (const [source, expected] of malformed) test(`rejects malformed syntax: ${source}`, async () => {
  await assert.rejects(analyze(source), code(expected));
});

test('invalid, inherited, array and foreign choice objects fail closed', async () => {
  const a = await analyze(orchard), d = await decide(orchard, 'herb');
  await assert.rejects(compile(orchard, null), code('INVALID_DECISION'));
  await assert.rejects(compile(orchard, { ...d, scaling: 2 }), code('UNSUPPORTED_DECISION'));
  await assert.rejects(compile(orchard, { ...d, choices: [] }), code('INVALID_CHOICES'));
  await assert.rejects(compile(orchard, { ...d, choices: Object.create(d.choices) }), code('INVALID_CHOICES'));
  await assert.rejects(compile(orchard, { ...d, choices: { foreign: 'choice' } }), code('STALE_CHOICE'));
  assert.throws(() => select(JSON.parse(JSON.stringify(a)), 'herb'), code('INVALID_ANALYSIS'));
});

test('analysis objects and output are immutable', async () => {
  const a = await analyze(orchard);
  assert.throws(() => a.variants.push('fake'), TypeError);
  assert.throws(() => a.alternatives[0].options[0].name = 'fake', TypeError);
  const result = await run(orchard);
  assert.throws(() => result.receipt.variant = 'herb', TypeError);
});

test('rejects malformed Unicode, NUL and standalone CR', async () => {
  for (const source of ['Stir\0.', 'Stir\r.', 'Stir \uD800.']) await assert.rejects(analyze(source), code('INVALID_SOURCE'));
  await assert.rejects(analyze(null), code('INVALID_SOURCE'));
  await assert.rejects(analyze('x'.repeat(1_000_001)), code('SOURCE_TOO_LARGE'));
});

test('an empty selected variant cannot produce a misleading blank export', async () => {
  const source = '[herb] Stir well.';
  await assert.rejects(run(source, '*'), code('EMPTY_SELECTION'));
});

test('punctuation cannot be swallowed as a multiword ingredient name', async () => {
  for (const source of ['Add @salt, then mix it{with care}.', 'Add @apple{1}|pear, peeled{2}.']) {
    await assert.rejects(analyze(source), error => error instanceof CookBranchError);
  }
});

test('whitespace cannot produce a selected token stock parsers cannot recognize', async () => {
  for (const source of ['Add @ milk{1}.', 'Add @milk {1}.', 'Add @milk{1}| water{1}.', 'Add @milk{1}|water {1}.']) {
    await assert.rejects(analyze(source), code('MALFORMED_TOKEN'));
  }
});

test('ordinary unbraced token punctuation follows Cooklang token boundaries', async () => {
  const source = 'Add @extra.virgin, @salt&pepper and @🍋. Use #8-inch-pan.';
  const result = await run(source);
  assert.equal(result.text, source);
  assert.deepEqual(result.preview.after.ingredients.map(i => i.name), ['extra.virgin', 'salt&pepper', '🍋']);
  assert.equal(result.preview.after.cookware[0].name, '8-inch-pan');
});

test('scalable values inside prose notes fail closed', async () => {
  await assert.rejects(analyze('> Energy {{500%kcal}}\n\nStir.'), code('UNSUPPORTED_SCALING'));
});

async function pauseDigest(callNumber, action) {
  const subtle = globalThis.crypto.subtle;
  const original = subtle.digest;
  let count = 0, enteredResolve, release;
  const entered = new Promise(resolve => { enteredResolve = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  subtle.digest = async function (...args) {
    if (++count === callNumber) { enteredResolve(); await gate; }
    return original.apply(this, args);
  };
  try { return await action(entered, release); }
  finally { release(); subtle.digest = original; }
}

test('decision variant cannot race output hashing and contradict the receipt', async () => {
  const source = '[*] Stir default.\n\n[herb] Stir herbs.\n';
  const decision = await decide(source, 'herb');
  const result = await pauseDigest(2, async (entered, release) => {
    const pending = compile(source, decision);
    await entered;
    decision.variant = '*';
    release();
    return pending;
  });
  assert.equal(result.text, 'Stir herbs.\n');
  assert.equal(result.receipt.variant, 'herb');
  assert.deepEqual(await compile(source, result.receipt), result);
});

for (const callNumber of [1, 2]) test(`all decision fields are snapshotted before digest ${callNumber}`, async () => {
  const initial = await run(orchard, 'herb', [1]);
  const decision = JSON.parse(JSON.stringify(initial.receipt));
  const result = await pauseDigest(callNumber, async (entered, release) => {
    const pending = compile(orchard, decision);
    await entered;
    decision.variant = '*';
    decision.sourceHash = 'edited';
    decision.outputHash = 'edited';
    decision.schema = 'edited';
    decision.dialect = 'edited';
    for (const key of Object.keys(decision.choices)) decision.choices[key] = 'foreign-option';
    decision.removedBranches[0].source = 'changed branch';
    decision.selectedOccurrences[0].token = '@changed{}';
    decision.removedBranches.push({ unexpected: true });
    release();
    return pending;
  });
  assert.deepEqual(result, initial);
  assert.deepEqual(await compile(orchard, result.receipt), result);
});

test('decision snapshot does not invoke getters or custom serialization', async () => {
  const decision = await decide(orchard, 'herb');
  let called = false;
  Object.defineProperty(decision, 'variant', { get() { called = true; return 'herb'; }, enumerable: true });
  await assert.rejects(compile(orchard, decision), code('INVALID_DECISION'));
  assert.equal(called, false);
  const withCycle = await decide(orchard, 'herb');
  withCycle.removedBranches = [withCycle];
  await assert.rejects(compile(orchard, withCycle), code('INVALID_DECISION'));
});

for (const source of [
  'Mix @milk--comment{1%cup}|water{2%cup}.\n',
  'Mix @milk{1--comment%cup}|water{2%cup}.\n',
  'Mix @milk{1%cup--comment}|water{2%cup}.\n',
  'Mix @milk{1%cup}[vegan--comment]|water{2%cup}.\n',
  'Mix @milk{1%cup}|water--comment{2%cup}.\n',
  'Mix @milk{1%cup}|water{2--comment%cup}.\n',
  'Mix @milk{1%cup}[- comment -]|water{2%cup}.\n',
  'Mix @milk{1[- comment -]%cup}|water{2%cup}.\n',
  'Mix @milk{1%cup}|water{2%cup}[- comment -].\n',
  'Use #pan--comment{1}.\n',
  'Wait ~rest{2--comment%minutes}.\n',
]) test(`comment delimiters cannot create unauthored token choices: ${source.trim()}`, async () => {
  await assert.rejects(analyze(source), code('UNSUPPORTED_COMMENT_BOUNDARY'));
});

test('ordinary comments between complete tokens stay opaque', async () => {
  const source = 'Mix @milk{1%cup}|water{2%cup}. -- @ghost{}|phantom{}\n';
  const a = await analyze(source);
  assert.equal(a.alternatives.length, 1);
  assert.equal((await run(source, '*', [1])).text, 'Mix @water{2%cup}. -- @ghost{}|phantom{}\n');
});

for (const source of [
  'Mix @milk{1%cup}|water{2%cup}(boiled).',
  'Mix @milk{1%cup}(whole)|water{2%cup}.',
  'Mix @milk{1%cup}|water{2%cup}(boiled)[vegan].',
  'Mix @milk{1%cup}[whole](cold)|water{2%cup}.',
  'Chop @onion(sliced).',
]) test(`preparation annotations cannot leak from unselected options: ${source}`, async () => {
  await assert.rejects(analyze(source), code('UNSUPPORTED_PREPARATION'));
});

test('separated prose parentheses stay shared prose', async () => {
  const source = 'Mix @milk{1%cup}|water{2%cup} (stir very gently).';
  assert.equal((await run(source)).text, 'Mix @milk{1%cup} (stir very gently).');
});

test('square bracket notes stay with only their explicitly selected option', async () => {
  const source = 'Mix @milk{1%cup}[whole]|water{2%cup}[boiled].';
  assert.equal((await run(source, '*', [0])).text, 'Mix @milk{1%cup}[whole].');
  assert.equal((await run(source, '*', [1])).text, 'Mix @water{2%cup}[boiled].');
});

test('token-like text inside opaque notes cannot create phantom stock-parser ingredients', async () => {
  for (const source of ['Mix @milk{1%cup}[with @salt{2%g}]|water{2%cup}.', 'Mix @milk{}|water{}[in #pan{}].', 'Mix @milk{}[wait ~rest{1%min}]|water{}.']) {
    await assert.rejects(analyze(source), code('UNSUPPORTED_NOTE_CONTENT'));
  }
  await assert.rejects(analyze('Mix @milk{}|water{}(with @salt{2%g}).'), code('UNSUPPORTED_PREPARATION'));
});

for (const source of ['[herb--comment] Add @milk{1}.', '== [herb--comment] Base ==\n\nStir.']) {
  test(`comment delimiters cannot invent variant scopes: ${source}`, async () => {
    await assert.rejects(analyze(source), code('UNSUPPORTED_COMMENT_BOUNDARY'));
  });
}

test('a Unicode BOM cannot hide a variant marker from branch selection', async () => {
  const source = '\uFEFF[herb] Add @mint{2%g}.\n\n[*] Stir.\n';
  const a = await analyze(source);
  assert.deepEqual(a.variants, ['*', 'herb']);
  assert.equal((await run(source, '*')).text, 'Stir.\n');
  assert.equal((await run(source, 'herb')).text, '\uFEFFAdd @mint{2%g}.\n\n');
  assert.equal(select(a, '*').steps.flatMap(s => s.ingredients).length, 0);
});

for (const source of [
  '[- comment -] [herb] Add @mint{2%g}.\n\nStir.\n',
  '[- one -] [- two -] [herb] Add @mint{2%g}.\n\nStir.\n',
  '[- comment -] > Literal @mint{2%g}.\n\nStir.\n',
  '[herb] [- comment -] > Literal @mint{2%g}.\n\nStir.\n',
  '[- comment -] == [herb] Hidden heading ==\n\nAdd @mint{2%g}.\n',
]) test(`comments cannot expose an otherwise hidden structural prefix: ${source}`, async () => {
  await assert.rejects(analyze(source), code(source.startsWith('[herb]') ? 'MALFORMED_SCOPE' : 'UNSUPPORTED_COMMENT_BOUNDARY'));
});

test('leading comments must be separate from following instructions', async () => {
  const source = '[- comment -] Add @milk{1}|water{2}.';
  await assert.rejects(analyze(source), code('UNSUPPORTED_COMMENT_BOUNDARY'));
});

test('all Unicode leading whitespace recognized upstream exposes the same scope', async () => {
  for (const prefix of ['\u00A0', '\u2003', '\u3000', '\t\uFEFF\u00A0']) {
    const source = `${prefix}[herb] Add @mint{2%g}.\n\n[*] Stir.\n`;
    assert.equal((await run(source, '*')).text, 'Stir.\n');
    assert.equal((await run(source, 'herb')).text, `${prefix}Add @mint{2%g}.\n\n`);
  }
});

for (const source of [
  '>> title: Test\n[*] Mix @milk{1}|water{2}.\n\n[herb] Stir.\n',
  'Stir.\n>> servings: 2\n[herb] Add @mint{2%g}.\n',
  '== Base ==\nAdd @milk{1}|water{2}.\n',
  'Stir.\n== [herb] Base ==\n\nAdd @mint{2%g}.\n',
  '== First ==\n== Second ==\n\nStir.\n',
  '>> title: Test\n== [herb] Base ==\n\nStir.\n',
]) test(`structural boundaries require isolated paragraphs: ${source}`, async () => {
  await assert.rejects(analyze(source), code('UNSUPPORTED_PARAGRAPH_BOUNDARY'));
});

test('consecutive legacy metadata lines form an opaque block separated by blanks', async () => {
  const source = '>> title: Test\n>> servings: 2\n\nStir.';
  assert.equal((await run(source)).text, source);
});

test('legacy metadata cannot acquire new scoped meaning in an export', async () => {
  await assert.rejects(analyze('[herb] >> servings: 2\n\nStir.'), code('UNSUPPORTED_METADATA_SCOPE'));
});

for (const source of [
  '[- a -]\n[- b -] [herb] Add @mint{2%g}.\n\nStir.\n',
  '-- a\n[- b -] [herb] Add @mint{2%g}.\n\nStir.\n',
  '[- a -]\n-- b\n[- c -] [herb] Add @mint{2%g}.\n\nStir.\n',
]) test(`chained or mixed leading comments cannot hide scopes: ${source}`, async () => {
  await assert.rejects(analyze(source), code('UNSUPPORTED_COMMENT_BOUNDARY'));
});

test('block comments alone are never recipe instructions', async () => {
  await assert.rejects(analyze('[- note only -]'), code('EMPTY_RECIPE'));
  await assert.rejects(analyze('-- note only\n[- another -]'), code('EMPTY_RECIPE'));
  const source = '[- note only -]\n\n[herb] Stir.';
  await assert.rejects(run(source, '*'), code('EMPTY_SELECTION'));
});

for (const source of [
  '\u00a0---\ntitle: "@milk{1}|water{2}"\n---\n\nStir.',
  'Stir.\n\n---\ntitle: "@milk{1}|water{2}"\n---\n\nFinish.',
]) test(`unsupported YAML placement cannot invent ingredient choices: ${source}`, async () => {
  await assert.rejects(analyze(source), code('UNSUPPORTED_METADATA_BOUNDARY'));
});

test('YAML recognition cannot hide inside an instruction paragraph', async () => {
  for (const source of ['Stir.\n---\ntitle: "@milk{1}|water{2}"\n---\nFinish.', 'Stir ---\ntitle: "@milk{1}|water{2}"\n--- then finish.']) {
    await assert.rejects(analyze(source), code('UNSUPPORTED_METADATA_BOUNDARY'));
  }
});
