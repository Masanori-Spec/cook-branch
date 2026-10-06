/**
 * CookBranch: a deliberately bounded, lossless authored-variant materializer.
 * Runtime dependencies: none. Quantities are opaque written strings, never math.
 * Dialect: @tmlmt/cooklang-parser 3.0.0-alpha.47, supported subset only.
 */
export const DIALECT = '@tmlmt/cooklang-parser@3.0.0-alpha.47 / CookBranch subset v1';
export const RECEIPT_SCHEMA = 'cookbranch.receipt/v1';
const states = new WeakMap();

export class CookBranchError extends Error {
  constructor(code, message, location = {}) {
    super(message);
    this.name = 'CookBranchError';
    this.code = code;
    this.line = location.line ?? null;
    this.column = location.column ?? null;
  }
}

function fail(code, message, location) { throw new CookBranchError(code, message, location); }
let locatedSource = null, lineStarts = [];
function locate(source, offset) {
  if (source !== locatedSource) {
    locatedSource = source; lineStarts = [0];
    for (let i = 0; i < source.length; i++) if (source[i] === '\n') lineStarts.push(i + 1);
  }
  let low = 0, high = lineStarts.length;
  while (low + 1 < high) { const middle = (low + high) >>> 1; if (lineStarts[middle] <= offset) low = middle; else high = middle; }
  return { line: low + 1, column: offset - lineStarts[low] + 1 };
}
function frozen(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}
export async function hashSource(source) {
  if (typeof source !== 'string') fail('INVALID_SOURCE', 'Recipe source must be a string.');
  if (!globalThis.crypto?.subtle) fail('CRYPTO_UNAVAILABLE', 'SHA-256 requires a secure browser context or modern Node.js.');
  const hash = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function tagsAt(text, offset, source) {
  if (!text.startsWith('[')) return { tags: null, length: 0 };
  const end = text.indexOf(']');
  const location = locate(source, offset);
  if (end < 0) fail('MALFORMED_SCOPE', 'Unclosed variant marker.', location);
  const contents = text.slice(1, end);
  if (contents.includes('--') || contents.includes('[-') || contents.endsWith('-')) fail('UNSUPPORTED_COMMENT_BOUNDARY', 'Comment delimiters may not cross variant markers.', location);
  if (contents.includes('?')) fail('UNSUPPORTED_OPTIONAL', 'Optional steps and sections are not supported.', location);
  const tags = contents.split(',').map(t => t.trim());
  if (tags.some(t => !t || (t !== '*' && !/^[\p{L}\p{N}][\p{L}\p{N} _.-]*$/u.test(t)))) {
    fail('MALFORMED_SCOPE', 'Use exact comma-separated variant names, or * for default.', location);
  }
  if (new Set(tags).size !== tags.length) fail('MALFORMED_SCOPE', 'Duplicate variant names are not allowed in one marker.', location);
  const tail = text.slice(end + 1);
  if (tail.startsWith('[') || /^\s+\[/.test(tail)) fail('MALFORMED_SCOPE', 'Only one variant marker is allowed per step or section.', location);
  if (tail && !/^\s/.test(tail)) fail('MALFORMED_SCOPE', 'A variant marker must be followed by whitespace.', location);
  // Consume horizontal spacing only; a tag-only first line keeps its line break.
  return { tags, length: end + 1 + (tail.match(/^[ \t]*/)?.[0].length || 0) };
}

function tokenAt(text, start, base, source, kind = 'ingredient', alternative = false) {
  const prefixLength = alternative ? 0 : 1;
  const begin = start + prefixLength;
  const tail = text.slice(begin);
  const location = locate(source, base + start);
  if (!tail || /^[?&@+\-|]/.test(tail) || /^(?:\.\.?\/|\/)/.test(tail)) {
    fail('UNSUPPORTED_MODIFIER', 'Ingredient/cookware modifiers, references, and grouped alternatives are not supported.', location);
  }
  if (/^\s/.test(tail)) fail('MALFORMED_TOKEN', 'Token names must start immediately after their marker.', location);
  let name, content = '', end, braced = false;
  const candidate = tail.match(kind === 'timer' ? /^([^{}\r\n@#~|\[\]]*)\{/ : /^([^{}\r\n@#~|\[\](,;:!?]*)\{/);
  if (candidate) {
    name = candidate[1].trim();
    if (candidate[1] !== name) fail('MALFORMED_TOKEN', 'Whitespace before a quantity brace is outside the bounded dialect.', location);
    const open = begin + candidate[0].length - 1;
    const close = text.indexOf('}', open + 1);
    if (close < 0 || /[{}\r\n]/.test(text.slice(open + 1, close))) fail('MALFORMED_TOKEN', 'Unclosed or nested quantity token.', location);
    content = text.slice(open + 1, close);
    end = close + 1;
    braced = true;
  } else {
    if (alternative) fail('MALFORMED_ALTERNATIVE', 'Every alternative must have its own fully braced quantity token.', location);
    const single = tail.match(/^[^\s@#~\[\]{}(,;:!?|]+/u);
    if (single) single[0] = single[0].replace(/\.+$/, '');
    if (!single || !single[0] || kind === 'timer') fail('MALFORMED_TOKEN', 'Malformed ingredient, cookware, or timer token.', location);
    name = single[0];
    end = begin + name.length;
  }
  if ((!name && kind !== 'timer') || /^[?&@+\-|]/.test(name) || /^(?:\.\.?\/|\/)/.test(name)) {
    fail('MALFORMED_TOKEN', 'Missing or unsupported token name.', location);
  }
  if (name.includes('\\') || content.includes('\\')) fail('UNSUPPORTED_ESCAPE', 'Backslash escapes are outside the bounded dialect.', location);
  if (content.includes('|')) fail('UNSUPPORTED_UNIT_ALTERNATIVE', 'Unit alternatives are not supported.', location);
  if (content.includes('*') || content.includes('=')) fail('UNSUPPORTED_SCALING', 'Scaling and fixed/scalable modifiers are not supported.', location);
  if ((content.match(/%/g) || []).length > 1) fail('MALFORMED_TOKEN', 'A quantity token may contain at most one unit separator.', location);
  const separator = content.indexOf('%');
  const quantity = separator < 0 ? content : content.slice(0, separator);
  const unit = separator < 0 ? '' : content.slice(separator + 1);
  if (separator >= 0 && (!quantity.trim() || !unit.trim())) fail('MALFORMED_TOKEN', 'Both quantity and unit are required around %. ', location);
  if (kind === 'timer' && !quantity.trim()) fail('MALFORMED_TOKEN', 'Timers must include a written quantity.', location);
  if (kind === 'cookware' && separator >= 0) fail('UNSUPPORTED_COOKWARE_UNIT', 'Cookware units are outside the supported subset.', location);
  let note = '', noteRaw = '';
  if (kind === 'ingredient' && text[end] === '[') {
    const close = text.indexOf(']', end + 1);
    if (close < 0 || /[\[\r\n]/.test(text.slice(end + 1, close))) fail('MALFORMED_NOTE', 'Unclosed or nested ingredient note.', locate(source, base + end));
    note = text.slice(end + 1, close);
    if (/[@#~{}\\]/.test(note)) fail('UNSUPPORTED_NOTE_CONTENT', 'Ingredient notes must be plain text without token markers, braces, or escapes.', locate(source, base + end));
    noteRaw = text.slice(end, close + 1);
    end = close + 1;
  }
  if (kind === 'ingredient' && text[end] === '(') fail('UNSUPPORTED_PREPARATION', 'Ingredient preparation annotations are outside the bounded dialect.', location);
  const raw = text.slice(start, end);
  if (raw.includes('--') || raw.includes('[-') || raw.includes('-]')) fail('UNSUPPORTED_COMMENT_BOUNDARY', 'Comment delimiters may not cross ingredient, cookware, timer, quantity, or note tokens.', location);
  return { kind, name, quantity, unit, note, noteRaw, braced, raw, source: raw,
    token: alternative ? '@' + raw : raw, ...location, start: base + start, end: base + end, localEnd: end };
}

function withoutComments(text, base, source) {
  let result = '', i = 0;
  while (i < text.length) {
    if (text.startsWith('--', i)) { const end = text.indexOf('\n', i); i = end < 0 ? text.length : end; continue; }
    if (text.startsWith('[-', i)) {
      const end = text.indexOf('-]', i + 2);
      if (end < 0) fail('MALFORMED_COMMENT', 'Unclosed block comment.', locate(source, base + i));
      if (/[\r\n]/.test(text.slice(i, end))) fail('UNSUPPORTED_COMMENT_BOUNDARY', 'Multiline block comments are outside the bounded dialect.', locate(source, base + i));
      i = end + 2; continue;
    }
    result += text[i++];
  }
  return result;
}

function scanStep(text, base, source, stepId, sectionId) {
  const ingredients = [], alternatives = [], cookware = [], timers = [];
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('--', i)) { const e = text.indexOf('\n', i); i = e < 0 ? text.length : e + 1; continue; }
    if (text.startsWith('[-', i)) {
      const e = text.indexOf('-]', i + 2);
      if (e < 0) fail('MALFORMED_COMMENT', 'Unclosed block comment.', locate(source, base + i));
      i = e + 2; continue;
    }
    if (text[i] === '\\') { // Escapes can change what stock parsers inventory; do not guess.
      fail('UNSUPPORTED_ESCAPE', 'Backslash escapes are outside the bounded dialect.', locate(source, base + i));
    }
    if (text.startsWith('{{', i)) fail('UNSUPPORTED_SCALING', 'Arbitrary scalable quantities are not supported.', locate(source, base + i));
    if ('@#~'.includes(text[i])) {
      const kind = text[i] === '@' ? 'ingredient' : text[i] === '#' ? 'cookware' : 'timer';
      const first = tokenAt(text, i, base, source, kind);
      let end = first.localEnd;
      if (kind === 'ingredient') {
        const occurrenceId = `ingredient:${base + i}`;
        if (text[end] === '|') {
          if (!first.braced) fail('MALFORMED_ALTERNATIVE', 'Every alternative must have its own fully braced quantity token.', first);
          const id = `alt:${base + i}`;
          const options = [first];
          while (text[end] === '|') {
            const next = tokenAt(text, end + 1, base, source, 'ingredient', true);
            options.push(next); end = next.localEnd;
          }
          const publicOptions = options.map((option, index) => ({ ...option, id: `${id}:${index}`, index, occurrenceId, optionId: `${id}:${index}` }));
          ingredients.push(...publicOptions);
          alternatives.push({ id, occurrenceId, stepId, sectionId, start: base + i, end: base + end,
            ...locate(source, base + i), raw: text.slice(i, end), source: text.slice(i, end), options: publicOptions });
        } else ingredients.push({ ...first, id: occurrenceId, occurrenceId, optionId: null });
      } else {
        const token = { ...first, id: `${kind}:${base + i}`, occurrenceId: `${kind}:${base + i}`, optionId: null };
        (kind === 'cookware' ? cookware : timers).push(token);
      }
      i = end; continue;
    }
    if (text[i] === '|') fail('UNSUPPORTED_PIPE', 'Only adjacent fully braced inline ingredient alternatives may use |.', locate(source, base + i));
    if (text[i] === '{' || text[i] === '}') fail('MALFORMED_TOKEN', 'Unexpected quantity brace outside a token.', locate(source, base + i));
    i++;
  }
  return { ingredients, alternatives, cookware, timers };
}

function parse(source) {
  if (typeof source !== 'string') fail('INVALID_SOURCE', 'Recipe source must be a string.');
  if (source.length > 1_000_000) fail('SOURCE_TOO_LARGE', 'Recipe source is limited to 1,000,000 characters.');
  if (source.includes('\0') || /\r(?!\n)/.test(source)) fail('INVALID_SOURCE', 'NUL and standalone CR characters are not supported.');
  // SHA-256 uses UTF-8: reject malformed UTF-16 so distinct inputs cannot alias as U+FFFD.
  if (!source.isWellFormed()) fail('INVALID_SOURCE', 'Recipe source contains an unpaired Unicode surrogate.');
  const lines = [], re = /[^\n]*(?:\n|$)/g;
  let match;
  while ((match = re.exec(source)) && match[0]) {
    const raw = match[0], body = raw.replace(/\r?\n$/, '');
    lines.push({ raw, body, start: match.index });
  }
  const nodes = [], sections = [], steps = [], alternatives = [], variants = ['*'];
  const register = tags => { for (const tag of tags || []) if (!variants.includes(tag)) variants.push(tag); };
  let section = { id: 'section:root', name: '', tags: null, line: 1, column: 1, source: '', implicit: true, stepIds: [] };
  sections.push(section);
  let index = 0;
  function add(node, end) {
    // Whitespace following a node belongs to that node, so removing a step also removes its blank separators.
    while (end < lines.length && !lines[end].body.trim()) end++;
    node.end = end < lines.length ? lines[end].start : source.length;
    node.raw = source.slice(node.start, node.end);
    nodes.push(node); index = end;
  }
  if (lines[0]?.body.replace(/^\uFEFF/, '') === '---') {
    let end = 1;
    while (end < lines.length && lines[end].body !== '---') end++;
    if (end === lines.length) fail('MALFORMED_METADATA', 'Unclosed YAML front matter.', { line: 1, column: 1 });
    add({ type: 'metadata', start: 0, sectionId: null }, end + 1);
  }
  const remainderStart = index < lines.length ? lines[index].start : source.length;
  const laterFrontMatter = /---\r?\n[\s\S]*?\r?\n---/.exec(source.slice(remainderStart));
  if (laterFrontMatter) fail('UNSUPPORTED_METADATA_BOUNDARY', 'YAML front matter is supported only at the start of the source.', locate(source, remainderStart + laterFrontMatter.index));
  while (index < lines.length) {
    const line = lines[index], body = line.body;
    if (!body.trim()) { add({ type: 'whitespace', start: line.start, sectionId: section.id }, index + 1); continue; }
    if (body.trim() === '---') fail('UNSUPPORTED_METADATA_BOUNDARY', 'YAML front matter must begin at the start of the source, optionally after one BOM.', locate(source, line.start));
    let paragraphEnd = index + 1;
    while (paragraphEnd < lines.length && lines[paragraphEnd].body.trim()) paragraphEnd++;
    const paragraphLines = lines.slice(index, paragraphEnd);
    if (paragraphLines.length > 1 && paragraphLines.some(l => /^\s*(?:=|>>)/.test(l.body)) && !paragraphLines.every(l => /^\s*>>/.test(l.body))) {
      fail('UNSUPPORTED_PARAGRAPH_BOUNDARY', 'Separate section headers and metadata blocks from instructions with blank lines.', locate(source, line.start));
    }
    if (/^\s*>>/.test(body)) { add({ type: 'metadata', start: line.start, sectionId: null }, index + 1); continue; }
    if (/^\s*=/.test(body)) {
      const h = body.match(/^(\s*=+\s*)(.*?)(\s*=+\s*)?$/);
      let middle = h[2], prefixLength = h[1].length;
      const scope = tagsAt(middle, line.start + prefixLength, source);
      if (scope.tags) middle = middle.slice(scope.length);
      if (!middle.trim() && scope.tags) fail('MALFORMED_SECTION', 'A tagged section must have a name.', locate(source, line.start));
      if (middle.includes('[') || middle.includes(']')) fail('MALFORMED_SCOPE', 'Section variant tags must appear once at the start of the name.', locate(source, line.start));
      register(scope.tags);
      section = { id: `section:${line.start}`, name: middle.trim(), tags: scope.tags, ...locate(source, line.start), source: body, implicit: false, stepIds: [] };
      sections.push(section);
      add({ type: 'section', start: line.start, sectionId: section.id, markerStart: line.start + prefixLength, markerLength: scope.length }, index + 1);
      continue;
    }
    let end = index + 1;
    while (end < lines.length && lines[end].body.trim() && !/^\s*(?:=|>>)/.test(lines[end].body)) end++;
    const last = lines[end - 1];
    const contentEnd = last.start + last.body.length;
    const original = source.slice(line.start, contentEnd);
    const leading = original.match(/^[^\S\r\n]*/)[0].length;
    let scope = { tags: null, length: 0 };
    if (original.slice(leading).startsWith('[') && !original.slice(leading).startsWith('[-')) scope = tagsAt(original.slice(leading), line.start + leading, source);
    let markerLength = scope.length;
    // A tag on its own line can prefix the following step without leaking a blank output line.
    if (scope.tags && /^\r?\n/.test(original.slice(leading + markerLength))) markerLength += original.slice(leading + markerLength).startsWith('\r\n') ? 2 : 1;
    const stripped = original.slice(0, leading) + original.slice(leading + markerLength);
    if (scope.tags && !stripped.trim()) fail('MALFORMED_SCOPE', 'A variant marker must be attached to a step.', locate(source, line.start));
    if (/\r?\n[^\S\r\n]*\[(?!-)/.test(stripped)) fail('MALFORMED_SCOPE', 'Start separately tagged steps after a blank line.', locate(source, line.start));
    if (section.tags && scope.tags && !section.tags.some(t => scope.tags.includes(t))) {
      fail('CONTRADICTORY_SCOPE', 'This step and its section have no variant in common.', locate(source, line.start));
    }
    register(scope.tags);
    const uncommented = withoutComments(stripped, line.start, source);
    if (/^\s*(?:--|\[-)/.test(stripped) && uncommented.trim()) {
      fail('UNSUPPORTED_COMMENT_BOUNDARY', 'Keep leading comments in their own blank-separated paragraph.', locate(source, line.start));
    }
    if (scope.tags && /^\s*>>/.test(stripped)) fail('UNSUPPORTED_METADATA_SCOPE', 'Legacy metadata cannot carry a variant scope.', locate(source, line.start));
    const isNote = /^\s*>/.test(stripped);
    if (isNote && stripped.includes('{{')) fail('UNSUPPORTED_SCALING', 'Arbitrary scalable quantities in notes are not supported.', locate(source, line.start));
    const isComment = !uncommented.trim();
    const id = `step:${line.start}`;
    const contentBase = line.start + leading + markerLength;
    const tokens = isNote || isComment ? { ingredients: [], alternatives: [], cookware: [], timers: [] } : scanStep(original.slice(leading + markerLength), contentBase, source, id, section.id);
    const step = { id, type: isNote ? 'note' : isComment ? 'comment' : 'step', sectionId: section.id, tags: scope.tags,
      ...locate(source, line.start), source: original, body: stripped, ...tokens };
    steps.push(step); section.stepIds.push(id); alternatives.push(...tokens.alternatives);
    add({ type: 'step', id, start: line.start, contentEnd, sectionId: section.id, markerStart: line.start + leading, markerLength }, end);
  }
  if (!steps.some(step => step.type === 'step')) fail('EMPTY_RECIPE', 'Add at least one recipe instruction.');
  return { nodes, sections, steps, alternatives, variants };
}

export async function analyze(source) {
  const parsed = parse(source);
  const analysis = frozen({ sourceHash: await hashSource(source), dialect: DIALECT,
    variants: parsed.variants, sections: parsed.sections, steps: parsed.steps, alternatives: parsed.alternatives });
  states.set(analysis, { ...parsed, source });
  return analysis;
}
const active = (tags, variant) => tags === null || tags.includes(variant);
export function select(analysis, variant) {
  if (!states.has(analysis)) fail('INVALID_ANALYSIS', 'Use the object returned by analyze().');
  if (typeof variant !== 'string' || !analysis.variants.includes(variant)) fail('UNKNOWN_VARIANT', 'Choose one exact variant listed in this recipe.');
  const sections = analysis.sections.filter(s => active(s.tags, variant));
  const ids = new Set(sections.map(s => s.id));
  const steps = analysis.steps.filter(s => ids.has(s.sectionId) && active(s.tags, variant));
  const stepIds = new Set(steps.map(s => s.id));
  const alternatives = analysis.alternatives.filter(a => stepIds.has(a.stepId));
  const removedBranches = [
    ...analysis.sections.filter(s => !ids.has(s.id)).map(s => ({ type: 'section', id: s.id, line: s.line, source: s.source, reason: `Section does not include ${variant}.` })),
    ...analysis.steps.filter(s => !stepIds.has(s.id)).map(s => ({ type: s.type, id: s.id, line: s.line, source: s.source,
      reason: ids.has(s.sectionId) ? `Step does not include ${variant}.` : `Containing section does not include ${variant}.` }))
  ].sort((a, b) => a.line - b.line);
  return frozen({ variant, sections, steps, alternatives, removedBranches });
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
// Capture every caller-owned field before the first asynchronous hash operation.
// Reject accessors and non-plain values rather than invoking arbitrary serialization.
function snapshotDecision(value, ancestors = new Set(), depth = 0) {
  if (value === null || value === undefined || ['string', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (depth > 32 || (!Array.isArray(value) && !plainObject(value)) || ancestors.has(value)) {
    fail('INVALID_DECISION', 'Decisions must contain only acyclic plain data.');
  }
  const result = Array.isArray(value) ? [] : Object.create(null);
  ancestors.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !Object.hasOwn(descriptor, 'value')) fail('INVALID_DECISION', 'Decision fields must be plain data properties.');
    Object.defineProperty(result, key, { value: snapshotDecision(descriptor.value, ancestors, depth + 1), enumerable: true, writable: true, configurable: true });
  }
  ancestors.delete(value);
  return frozen(result);
}

function replaceRanges(source, begin, end, edits) {
  let out = '', cursor = begin;
  for (const edit of edits.filter(e => e.start >= begin && e.start < end).sort((a, b) => a.start - b.start)) {
    if (edit.start < cursor) fail('INTERNAL_OVERLAP', 'Overlapping edits are not allowed.');
    out += source.slice(cursor, edit.start) + edit.text; cursor = edit.end;
  }
  return out + source.slice(cursor, end);
}

export async function compile(source, decision) {
  if (!plainObject(decision)) fail('INVALID_DECISION', 'Supply an explicit source hash, variant, and choice map.');
  const allowed = new Set(['sourceHash', 'variant', 'choices', 'schema', 'dialect', 'outputHash', 'removedBranches', 'selectedOccurrences']);
  if (Reflect.ownKeys(decision).some(k => !allowed.has(k))) fail('UNSUPPORTED_DECISION', 'Unknown decision fields; scaling and inferred choices are not supported.');
  const choiceDescriptor = Object.getOwnPropertyDescriptor(decision, 'choices');
  if (!choiceDescriptor || !Object.hasOwn(choiceDescriptor, 'value') || !plainObject(choiceDescriptor.value)) fail('INVALID_CHOICES', 'Supply an explicit plain choice map, even when it is empty.');
  decision = snapshotDecision(decision);
  if (decision.schema !== undefined && decision.schema !== RECEIPT_SCHEMA) fail('INVALID_RECEIPT', 'Unknown receipt schema.');
  if (decision.dialect !== undefined && decision.dialect !== DIALECT) fail('INVALID_RECEIPT', 'Receipt dialect does not match this compiler.');
  const analysis = await analyze(source);
  if (decision.sourceHash !== analysis.sourceHash) fail('STALE_SOURCE', 'The source changed or its hash is missing. Analyze it again and make fresh choices.');
  const selected = select(analysis, decision.variant);
  if (!selected.steps.some(s => s.type === 'step')) fail('EMPTY_SELECTION', 'This variant has no active recipe instructions.');
  if (!plainObject(decision.choices)) fail('INVALID_CHOICES', 'Supply an explicit choice map, even when it is empty.');
  const needed = new Map(selected.alternatives.map(a => [a.id, a]));
  for (const key of Reflect.ownKeys(decision.choices)) if (!needed.has(key)) fail('STALE_CHOICE', 'A choice belongs to another occurrence or an inactive branch.');
  const choices = {}, picked = new Map();
  for (const alternative of selected.alternatives) {
    if (!Object.hasOwn(decision.choices, alternative.id)) fail('MISSING_CHOICE', 'Explicitly choose an option for every active alternative, including the first option.', alternative);
    const option = alternative.options.find(o => o.id === decision.choices[alternative.id]);
    if (!option) fail('INVALID_CHOICE', 'Choose an option belonging to this exact ingredient occurrence.', alternative);
    choices[alternative.id] = option.id; picked.set(alternative.occurrenceId, option);
  }
  const state = states.get(analysis), stepIds = new Set(selected.steps.map(s => s.id)), sectionIds = new Set(selected.sections.map(s => s.id));
  const edits = [];
  for (const node of state.nodes) if (node.markerLength) edits.push({ start: node.markerStart, end: node.markerStart + node.markerLength, text: '' });
  for (const alternative of selected.alternatives) edits.push({ start: alternative.start, end: alternative.end, text: picked.get(alternative.occurrenceId).token });
  let text = '';
  for (const node of state.nodes) {
    if (node.sectionId && !sectionIds.has(node.sectionId)) continue;
    if (node.type === 'step' && !stepIds.has(node.id)) continue;
    text += replaceRanges(source, node.start, node.end, edits);
  }
  const outputHash = await hashSource(text);
  if (decision.outputHash !== undefined && decision.outputHash !== outputHash) fail('INVALID_RECEIPT', 'The receipt output hash does not match these decisions.');
  const beforeIngredients = analysis.steps.flatMap(s => s.ingredients);
  const afterIngredients = selected.steps.flatMap(s => s.ingredients.filter(i => !i.optionId || picked.get(i.occurrenceId)?.id === i.id));
  const kept = new Set(afterIngredients.map(i => i.id));
  const stepTexts = new Map();
  for (const node of state.nodes.filter(n => n.type === 'step' && stepIds.has(n.id))) stepTexts.set(node.id, replaceRanges(source, node.start, node.contentEnd, edits));
  const toStep = (s, after = false) => ({ id: s.id, type: s.type, line: s.line, sectionId: s.sectionId, text: after ? stepTexts.get(s.id) : s.source });
  const byStepId = new Map(analysis.steps.map(s => [s.id, s]));
  const beforeSteps = analysis.steps.filter(s => s.type !== 'comment').map(s => toStep(s));
  const afterSteps = selected.steps.filter(s => s.type !== 'comment').map(s => toStep(s, true));
  const preview = {
    before: { steps: beforeSteps, ingredients: beforeIngredients, cookware: analysis.steps.flatMap(s => s.cookware), timers: analysis.steps.flatMap(s => s.timers) },
    after: { steps: afterSteps, ingredients: afterIngredients, cookware: selected.steps.flatMap(s => s.cookware), timers: selected.steps.flatMap(s => s.timers) },
    removedBranches: selected.removedBranches,
    ingredientDifferences: { removed: beforeIngredients.filter(i => !kept.has(i.id)), selected: [...picked.values()] },
    instructionDifferences: {
      removed: beforeSteps.filter(s => !stepIds.has(s.id)),
      changed: afterSteps.filter(s => byStepId.get(s.id).source !== s.text).map(s => ({ id: s.id, line: s.line, before: byStepId.get(s.id).source, after: s.text }))
    }
  };
  const selectedOccurrences = selected.alternatives.map(a => ({
    id: a.id, occurrenceId: a.occurrenceId, line: a.line, column: a.column,
    optionId: picked.get(a.occurrenceId).id, token: picked.get(a.occurrenceId).token
  }));
  for (const [key, value] of [['removedBranches', selected.removedBranches], ['selectedOccurrences', selectedOccurrences]]) {
    if (decision[key] !== undefined && JSON.stringify(decision[key]) !== JSON.stringify(value)) fail('INVALID_RECEIPT', 'Receipt display records do not match the authoritative source and choices.');
  }
  return frozen({ text, receipt: { schema: RECEIPT_SCHEMA, dialect: DIALECT, sourceHash: analysis.sourceHash, variant: decision.variant, choices, outputHash, removedBranches: selected.removedBranches, selectedOccurrences }, preview });
}
