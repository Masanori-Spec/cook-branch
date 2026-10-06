#!/usr/bin/env node
// Independent published parser. No compiler imports, matching heuristics, or implicit choices.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = path.resolve(process.env.COOKBRANCH_ORACLE_CACHE || path.join(root, '.cache/oracles'));
const {Recipe, isSectionActive, isStepActive} = await import(pathToFileURL(path.join(cache, 'node_modules/@tmlmt/cooklang-parser/dist/index.mjs')));
const [file, variant, grain] = process.argv.slice(2);
assert(file && ['*', 'herb'].includes(variant) && ['barley', 'rice'].includes(grain), 'file variant grain required');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'fixtures/oracle-manifest.json'), 'utf8'));
const spec = manifest.cases[`${variant === '*' ? 'default' : variant}-${grain}`];
const source = new Recipe(await fs.readFile(path.join(root, 'fixtures/orchard-bowl.cook'), 'utf8'));
const generated = new Recipe(await fs.readFile(file, 'utf8'));
assert.deepEqual([...source.choices.ingredientItems.keys()], ['ingredient-item-0']);
assert.equal(source.choices.ingredientItems.get('ingredient-item-0').length, 2);
assert.equal(source.choices.ingredientGroups.size, 0);
// Explicit caller-selected index. Never derive a decision from names or notes.
const choices = {variant, ingredientItems: new Map([['ingredient-item-0', spec.alternativeIndex]])};
assert.equal(generated.choices.ingredientItems.size, 0, 'Export leaked inline alternatives');
assert.equal(generated.choices.ingredientGroups.size, 0, 'Export leaked grouped alternatives');
assert.deepEqual(generated.choices.variants, [], 'Export leaked variant tags');
function quantity(q) {
  if (q === undefined || q === null) return null;
  assert.equal(q.type, 'fixed', 'Matrix requires fixed numeric quantities');
  assert.equal(q.value.type, 'decimal', 'Matrix quantities are exact integers');
  assert(Number.isSafeInteger(q.value.decimal), 'Matrix amount is not an exact safe integer');
  return String(q.value.decimal);
}
function normalized(recipe, selection) {
  const cookware = new Map();
  const timers = [];
  const ingredients = recipe.getIngredientQuantities({choices: selection})
    .filter(i => i.quantities?.length)
    .flatMap(i => i.quantities.map(q => ({name:i.name, quantity:quantity(q.quantity), unit:q.unit ?? null})));
  const sections = recipe.sections.filter(s => isSectionActive(s, selection.variant)).map(section => ({
    name:section.name ?? null,
    steps:section.content.filter(s => s.type !== 'step' || isStepActive(s, selection.variant)).map(step => {
      assert.equal(step.type, 'step', 'Unexpected non-step content');
      return step.items.map(item => {
        if (item.type === 'text') {
          assert(!item.attribute && !item.href, 'Unexpected formatted text');
          return {type:'text', value:item.value};
        }
        if (item.type === 'ingredient') {
          let index = 0;
          if (item.alternatives.length > 1) {
            assert(selection.ingredientItems.has(item.id), `Missing explicit choice for ${item.id}`);
            index = selection.ingredientItems.get(item.id);
          }
          const alt = item.alternatives[index];
          assert(alt, 'Explicit option does not exist');
          assert(!alt.note && !alt.flags?.length, 'Unexpected ingredient modifiers');
          return {type:'ingredient', name:recipe.ingredients[alt.index].name,
            quantity:quantity(alt.quantity), unit:alt.unit?.name ?? null};
        }
        if (item.type === 'cookware') {
          const c = recipe.cookware[item.index];
          assert(!c.flags?.length, 'Unexpected cookware modifiers');
          const value = {name:c.name, quantity:quantity(item.quantity)};
          cookware.set(item.index, value);
          return {type:'cookware', ...value};
        }
        if (item.type === 'timer') {
          const t = recipe.timers[item.index];
          const value = {name:t.name ?? null, quantity:quantity(t.duration), unit:t.unit};
          timers.push(value);
          return {type:'timer', ...value};
        }
        assert.fail(`Unexpected item type ${item.type}`);
      });
    })
  })).filter(section => section.steps.length);
  return {metadata:recipe.metadata, ingredients, cookware:[...cookware.values()], timers, sections};
}
const originalSelected = normalized(source, choices);
const exported = normalized(generated, {variant:'*', ingredientItems:new Map()});
console.log(JSON.stringify({version:'3.0.0-alpha.47', explicitChoices:{variant, ingredientItems:[...choices.ingredientItems]}, originalSelected, exported}));
