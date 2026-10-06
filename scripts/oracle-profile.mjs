#!/usr/bin/env node
// Extra bounded-profile regressions. Expectations below are handwritten, not
// generated from compiler helpers, preview output, or consumer snapshots.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {analyze, select, compile} from '../src/compiler.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verified = spawnSync('python3', ['-c',
  'import sys;sys.path.insert(0,sys.argv[1]);from oracle_support import verify_cache;verify_cache()',
  path.join(root,'scripts')], {encoding:'utf8'});
assert.equal(verified.status,0,'Pinned consumer archive/installed-byte integrity verification failed');
const cache = path.resolve(process.env.COOKBRANCH_ORACLE_CACHE || path.join(root,'.cache/oracles'));
const {Recipe, isSectionActive, isStepActive} = await import(pathToFileURL(path.join(cache,'node_modules/@tmlmt/cooklang-parser/dist/index.mjs')));

const cases = [
  {
    name:'repeated-names', variant:'*', compilerIndices:[0,0],
    choices:[['ingredient-item-0',0],['ingredient-item-1',0]],
    source:'== Mix ==\n\nMix @milk{1%cup}|water{2%cup}.\n\nAdd @milk{3%cup}|water{4%cup}.\n',
    expectedText:'== Mix ==\n\nMix @milk{1%cup}.\n\nAdd @milk{3%cup}.\n',
    expected:{metadata:{},ingredientQuantities:[['milk','1/1','cup',null],['milk','3/1','cup',null]],sections:[{name:'Mix',steps:[
      [['text','Mix '],['ingredient','milk','1/1','cup',null],['text','.']],
      [['text','Add '],['ingredient','milk','3/1','cup',null],['text','.']]
    ]}]}
  },
  {
    name:'fractions', variant:'*', compilerIndices:[1], choices:[['ingredient-item-0',1]],
    source:'== Measure ==\n\nAdd @flour{1/2%cup}|oats{3/4%cup} and @salt{1/4%tsp}.\n',
    expectedText:'== Measure ==\n\nAdd @oats{3/4%cup} and @salt{1/4%tsp}.\n',
    expected:{metadata:{},ingredientQuantities:[['oats','3/4','cup',null],['salt','1/4','tsp',null]],sections:[{name:'Measure',steps:[
      [['text','Add '],['ingredient','oats','3/4','cup',null],['text',' and '],['ingredient','salt','1/4','tsp',null],['text','.']]
    ]}]}
  },
  {
    name:'unicode-crlf', variant:'vegan', compilerIndices:[1], choices:[['ingredient-item-0',1]],
    source:'== 準備 ==\r\n\r\n[vegan] 混ぜる @牛乳{100%ml}|豆乳{125%ml} と @米{60%g}。\r\n\r\n[*] Add @milk{20%ml}.\r\n',
    expectedText:'== 準備 ==\r\n\r\n混ぜる @豆乳{125%ml} と @米{60%g}。\r\n\r\n',
    expected:{metadata:{},ingredientQuantities:[['豆乳','125/1','ml',null],['米','60/1','g',null]],sections:[{name:'準備',steps:[
      [['text','混ぜる '],['ingredient','豆乳','125/1','ml',null],['text',' と '],['ingredient','米','60/1','g',null],['text','。']]
    ]}]}
  },
  {
    name:'comma-tag-intersection', variant:'blue', compilerIndices:[1], choices:[['ingredient-item-0',1]],
    source:'== [red, blue] Base ==\n\n[blue, green] Add @peas{10%g}|beans{12%g}.\n\n[red] Add @salt{1%g}.\n\n== [green] Finish ==\n\n[green] Add @oil{2%ml}.\n',
    expectedText:'== Base ==\n\nAdd @beans{12%g}.\n\n',
    expected:{metadata:{},ingredientQuantities:[['beans','12/1','g',null]],sections:[{name:'Base',steps:[
      [['text','Add '],['ingredient','beans','12/1','g',null],['text','.']]
    ]}]}
  }
];
function rational(numerator, denominator) {
  let n = BigInt(numerator), d = BigInt(denominator);
  assert(d > 0n, 'Invalid denominator');
  let a = n < 0n ? -n : n, b = d;
  while (b) [a,b] = [b,a%b];
  return `${n/a}/${d/a}`;
}
function quantity(q) {
  if (!q) return null;
  assert.equal(q.type,'fixed');
  const value = q.value;
  if (value.type === 'fraction') {
    assert(Number.isSafeInteger(value.num) && Number.isSafeInteger(value.den));
    return rational(value.num,value.den);
  }
  assert.equal(value.type,'decimal');
  assert(Number.isFinite(value.decimal));
  const written = String(value.decimal);
  assert(/^\d+(?:\.\d+)?$/.test(written));
  const [whole,fraction=''] = written.split('.');
  return rational(whole+fraction,10n**BigInt(fraction.length));
}
function normalized(recipe, choices) {
  const ingredientQuantities = recipe.getIngredientQuantities({choices})
    .filter(i=>i.quantities?.length)
    .flatMap(i=>i.quantities.map(q=>[i.name,quantity(q.quantity),q.unit ?? null,i.preparation ?? null]));
  const sections = recipe.sections.filter(s=>isSectionActive(s,choices.variant)).map(section=>({
    name:section.name ?? '', steps:section.content.filter(s=>s.type!=='step'||isStepActive(s,choices.variant)).map(step=>{
      assert.equal(step.type,'step');
      return step.items.map(item=>{
        if(item.type==='text') return ['text',item.value];
        assert.equal(item.type,'ingredient','Profile fixture unexpectedly contains another item type');
        let index=0;
        if(item.alternatives.length>1) {
          assert(choices.ingredientItems.has(item.id),'Missing explicit per-occurrence choice');
          index=choices.ingredientItems.get(item.id);
        }
        const alt=item.alternatives[index];
        assert(alt);
        const ingredient=recipe.ingredients[alt.index];
        return ['ingredient',ingredient.name,quantity(alt.quantity),alt.unit?.name ?? null,ingredient.preparation ?? null];
      });
    })
  })).filter(s=>s.steps.length);
  return {metadata:recipe.metadata,ingredientQuantities,sections};
}
const results=[];
for(const fixture of cases) {
  const original=new Recipe(fixture.source);
  const explicit={variant:fixture.variant,ingredientItems:new Map(fixture.choices)};
  assert.deepEqual([...original.choices.ingredientItems.keys()],fixture.choices.map(([id])=>id));
  const selected=normalized(original,explicit);
  assert.deepEqual(selected,fixture.expected,`${fixture.name}: independent source interpretation`);
  const analysis=await analyze(fixture.source);
  const active=select(analysis,fixture.variant);
  assert.equal(active.alternatives.length,fixture.compilerIndices.length);
  const choices=Object.fromEntries(active.alternatives.map((a,index)=>[a.id,a.options[fixture.compilerIndices[index]].id]));
  const exported=await compile(fixture.source,{sourceHash:analysis.sourceHash,variant:fixture.variant,choices});
  assert.equal(exported.text,fixture.expectedText,`${fixture.name}: handwritten exact output including line endings`);
  const reparsed=new Recipe(exported.text);
  assert.equal(reparsed.choices.ingredientItems.size,0);
  assert.deepEqual(reparsed.choices.variants,[]);
  const consumed=normalized(reparsed,{variant:'*',ingredientItems:new Map()});
  assert.deepEqual(consumed,fixture.expected,`${fixture.name}: independent export interpretation`);
  assert.deepEqual(consumed,selected,`${fixture.name}: source/export semantics`);
  results.push({case:fixture.name,status:'pass',explicitChoices:fixture.choices,
    exportSha256:createHash('sha256').update(exported.text).digest('hex'),normalized:consumed});
  console.log(`PASS pinned consumer profile: ${fixture.name}`);
}
// Consumer facts are asserted literally; unsafe strings are never accepted as
// successful compilation fixtures.
const commentSource='Mix @milk--comment{1%cup}|water{2%cup}.\n';
const commentRecipe=new Recipe(commentSource);
assert.deepEqual([...commentRecipe.choices.ingredientItems.keys()],[]);
assert.deepEqual(commentRecipe.ingredients.map(i=>({name:i.name,quantityCount:i.quantities?.length ?? 0})),
  [{name:'milk',quantityCount:0}]);
assert.deepEqual(commentRecipe.sections[0].content[0].items.map(i=>i.type),['text','ingredient']);
await assert.rejects(()=>analyze(commentSource),{code:'UNSUPPORTED_COMMENT_BOUNDARY'});
const preparationSource='Use @milk{1%cup}|water{2%cup}(cold).\n';
const preparationRecipe=new Recipe(preparationSource);
assert.deepEqual(preparationRecipe.ingredients.map(i=>[i.name,i.preparation ?? null]),[['milk',null],['water','cold']]);
const firstChoice={variant:'*',ingredientItems:new Map([['ingredient-item-0',0]])};
const selectedPreparation=normalized(preparationRecipe,firstChoice);
assert.deepEqual(selectedPreparation.sections[0].steps[0],[['text','Use '],['ingredient','milk','1/1','cup',null],['text','.']]);
const naiveRecipe=new Recipe('Use @milk{1%cup}(cold).\n');
assert.deepEqual(naiveRecipe.ingredients.map(i=>[i.name,i.preparation ?? null]),[['milk','cold']]);
assert.notDeepEqual(normalized(naiveRecipe,{variant:'*',ingredientItems:new Map()}),selectedPreparation);
await assert.rejects(()=>analyze(preparationSource),{code:'UNSUPPORTED_PREPARATION'});
const rejected=[
  {case:'comment-boundary',status:'pass',compilerCode:'UNSUPPORTED_COMMENT_BOUNDARY',
    independentConsumerFact:'The -- delimiter ends the step after unquantified milk; there is no authored alternative.'},
  {case:'attached-preparation',status:'pass',compilerCode:'UNSUPPORTED_PREPARATION',
    independentConsumerFact:'(cold) belongs to water preparation. Retaining it after choosing milk would assign preparation to the wrong ingredient.'}
];
for(const item of rejected) console.log(`PASS pinned consumer rejection: ${item.case}`);

// Classification invariants: whitespace/comment removal must not turn a scoped
// step, note or section into an ordinary unscoped instruction.
function classification(recipe) {
  return {metadata:recipe.metadata,sections:recipe.sections.map(section=>[
    section.name ?? '',section.variants ?? [],
    ...section.content.map(item=>[item.type,item.variants ?? []])
  ])};
}
function selectedContent(recipe,variant) {
  return {metadata:recipe.metadata,sections:recipe.sections.filter(s=>isSectionActive(s,variant)).map(section=>({
    name:section.name ?? '',content:section.content.filter(item=>isStepActive(item,variant)).map(item=>({
      type:item.type,items:item.items.map(token=>{
        if(token.type==='text') return ['text',token.value];
        assert.equal(token.type,'ingredient');
        assert.equal(token.alternatives.length,1,'Classification fixture must not infer ingredient choices');
        const alt=token.alternatives[0];
        return ['ingredient',recipe.ingredients[alt.index].name,quantity(alt.quantity),alt.unit?.name ?? null];
      })
    }))
  })).filter(s=>s.content.length)};
}
const classificationCases=[
  {name:'bom-step',source:'\uFEFF[herb] Add @mint{2%g}.\n\n[*] Stir.\n',
   expected:{metadata:{},sections:[['',[],['step',['herb']],['step',['*']]]]},
   outputs:[['*','Stir.\n'],['herb','\uFEFFAdd @mint{2%g}.\n\n']]},
  {name:'bom-section',source:'\uFEFF== [herb] Prep ==\n\nAdd @mint{2%g}.\n',
   expected:{metadata:{},sections:[['Prep',['herb'],['step',[]]]]},
   outputs:[['herb','\uFEFF== Prep ==\n\nAdd @mint{2%g}.\n']]},
  {name:'bom-metadata',source:'\uFEFF---\ntitle: Test\n---\n\nStir.\n',
   expected:{metadata:{title:'Test'},sections:[['',[],['step',[]]]]},
   outputs:[['*','\uFEFF---\ntitle: Test\n---\n\nStir.\n']]},
  {name:'bom-note',source:'\uFEFF> Remember.\n\nStir.\n',
   expected:{metadata:{},sections:[['',[],['note',[]],['step',[]]]]},
   outputs:[['*','\uFEFF> Remember.\n\nStir.\n']]},
  {name:'comment-prefix-ordinary',source:'[- comment -] Stir.\n',
   expected:{metadata:{},sections:[['',[],['step',[]]]]},reject:'UNSUPPORTED_COMMENT_BOUNDARY'},
  {name:'mixed-comments-across-newline',source:'-- first\n[- second -] [herb] Add @mint{2%g}.\n\nStir.\n',
   expected:{metadata:{},sections:[['',[],['step',['herb']],['step',[]]]]},reject:'UNSUPPORTED_COMMENT_BOUNDARY'},
  {name:'multiline-block-comment',source:'[- first\nsecond -]\n\nStir.\n',
   expected:{metadata:{},sections:[['',[],['step',[]],['step',[]]]]},reject:'UNSUPPORTED_COMMENT_BOUNDARY'},
  {name:'comment-only-empty-recipe',source:'[- note only -]\n',
   expected:{metadata:{},sections:[]},reject:'EMPTY_RECIPE'},
  {name:'standalone-comment-with-instruction',source:'[- note only -]\n\nStir.\n',
   expected:{metadata:{},sections:[['',[],['step',[]]]]},outputs:[['*','[- note only -]\n\nStir.\n']]},
  {name:'indented-yaml',source:'\u00a0---\ntitle: Test\n---\n\nStir.\n',
   expected:{metadata:{title:'Test'},sections:[['',[],['step',[]]]]},reject:'UNSUPPORTED_METADATA_BOUNDARY'},
  {name:'later-yaml',source:'Stir.\n\n---\ntitle: "@ghost{4%g}"\n---\n',
   expected:{metadata:{title:'"@ghost{4%g}"'},sections:[['',[],['step',[]]]]},expectedIngredients:[],reject:'UNSUPPORTED_METADATA_BOUNDARY'},
  {name:'comment-exposes-tag',source:'[- comment -] [herb] Add @mint{2%g}.\n\nStir.\n',
   expected:{metadata:{},sections:[['',[],['step',['herb']],['step',[]]]]},reject:'UNSUPPORTED_COMMENT_BOUNDARY'},
  {name:'comment-exposes-note',source:'[- comment -] > Remember.\n\nStir.\n',
   expected:{metadata:{},sections:[['',[],['note',[]],['step',[]]]]},reject:'UNSUPPORTED_COMMENT_BOUNDARY'},
  {name:'comment-exposes-section',source:'[- comment -] == [herb] Prep ==\n\nAdd @mint{2%g}.\n',
   expected:{metadata:{},sections:[['Prep',['herb'],['step',[]]]]},reject:'UNSUPPORTED_COMMENT_BOUNDARY'},
  {name:'chained-comments-expose-tag',source:'[- one -][- two -] [herb] Add @mint{2%g}.\n\nStir.\n',
   expected:{metadata:{},sections:[['',[],['step',['herb']],['step',[]]]]},reject:'UNSUPPORTED_COMMENT_BOUNDARY'},
  {name:'chained-comments-expose-note',source:'[- one -] [- two -] > Remember.\n\nStir.\n',
   expected:{metadata:{},sections:[['',[],['note',[]],['step',[]]]]},reject:'UNSUPPORTED_COMMENT_BOUNDARY'},
  {name:'chained-comments-expose-tagged-note',source:'[- one -][- two -] [herb] > Remember.\n\nStir.\n',
   expected:{metadata:{},sections:[['',[],['note',['herb']],['step',[]]]]},reject:'UNSUPPORTED_COMMENT_BOUNDARY'},
  {name:'mixed-metadata-before-tag',source:'>> title: Test\n[*] Mix @milk{1}|water{2}.\n\n[herb] Stir.\n',
   expected:{metadata:{},sections:[['',[],['note',[]],['step',['herb']]]]},reject:'UNSUPPORTED_PARAGRAPH_BOUNDARY'},
  {name:'mixed-metadata-after-step',source:'Stir.\n>> servings: 2\n[herb] Add @mint{2%g}.\n',
   expected:{metadata:{},sections:[['',[],['step',[]]]]},reject:'UNSUPPORTED_PARAGRAPH_BOUNDARY'},
  {name:'metadata-after-heading',source:'== Prep ==\n>> title: Test\n\nStir.\n',
   expected:{metadata:{},sections:[['Prep',[],['note',[]],['step',[]]]]},reject:'UNSUPPORTED_PARAGRAPH_BOUNDARY'},
  {name:'metadata-before-heading',source:'>> title: Test\n== Prep ==\n\nStir.\n',
   expected:{metadata:{},sections:[['',[],['note',[]]],['Prep',[],['step',[]]]]},reject:'UNSUPPORTED_PARAGRAPH_BOUNDARY'},
  {name:'heading-after-step',source:'Stir.\n== [herb] Prep ==\n\nAdd @mint{2%g}.\n',
   expected:{metadata:{},sections:[['',[],['step',[]]],['Prep',['herb'],['step',[]]]]},reject:'UNSUPPORTED_PARAGRAPH_BOUNDARY'},
  {name:'heading-before-tag',source:'== Prep ==\n[herb] Add @mint{2%g}.\n\n[*] Stir.\n',
   expected:{metadata:{},sections:[['Prep',[],['step',['herb']],['step',['*']]]]},reject:'UNSUPPORTED_PARAGRAPH_BOUNDARY'}
];
const classificationResults=[];
for(const fixture of classificationCases) {
  const original=new Recipe(fixture.source);
  assert.deepEqual(classification(original),fixture.expected,`${fixture.name}: literal consumer classification`);
  if(fixture.expectedIngredients) assert.deepEqual(original.ingredients.map(i=>i.name),fixture.expectedIngredients);
  if(fixture.reject) {
    await assert.rejects(()=>analyze(fixture.source),{code:fixture.reject},`${fixture.name}: must fail closed`);
    classificationResults.push({case:fixture.name,status:'pass',result:'rejected',code:fixture.reject,consumerClassification:fixture.expected});
  } else {
    const analysis=await analyze(fixture.source);
    for(const [variant,expectedText] of fixture.outputs) {
      const compiled=await compile(fixture.source,{sourceHash:analysis.sourceHash,variant,choices:{}});
      assert.equal(compiled.text,expectedText,`${fixture.name}/${variant}: handwritten output`);
      assert.deepEqual(selectedContent(new Recipe(compiled.text),'*'),selectedContent(original,variant),
        `${fixture.name}/${variant}: selected source/export classification and token semantics`);
    }
    classificationResults.push({case:fixture.name,status:'pass',result:'preserved',variants:fixture.outputs.map(([v])=>v),consumerClassification:fixture.expected});
  }
  console.log(`PASS pinned consumer classification: ${fixture.name}`);
}
const commentInactiveSource='[- note only -]\n\n[herb] Stir.\n';
const commentInactiveRecipe=new Recipe(commentInactiveSource);
assert.deepEqual(classification(commentInactiveRecipe),{metadata:{},sections:[['',[],['step',['herb']]]]});
assert.deepEqual(selectedContent(commentInactiveRecipe,'*'),{metadata:{},sections:[]});
const commentInactiveAnalysis=await analyze(commentInactiveSource);
await assert.rejects(()=>compile(commentInactiveSource,{sourceHash:commentInactiveAnalysis.sourceHash,variant:'*',choices:{}}),{code:'EMPTY_SELECTION'});
classificationResults.push({case:'comment-only-empty-selection',status:'pass',result:'rejected',code:'EMPTY_SELECTION'});
console.log('PASS pinned consumer classification: comment-only-empty-selection');
for(const [name,prefix] of [['nbsp','\u00a0'],['em-space','\u2003'],['ideographic-space','\u3000']]) {
  const source=prefix+'[herb] Add @mint{2%g}.\n\n[*] Stir.\n';
  const original=new Recipe(source);
  assert.deepEqual(classification(original),{metadata:{},sections:[['',[],['step',['herb']],['step',['*']]]]});
  const analysis=await analyze(source);
  for(const variant of ['*','herb']) {
    const compiled=await compile(source,{sourceHash:analysis.sourceHash,variant,choices:{}});
    assert.equal(compiled.text,variant==='*'?'Stir.\n':prefix+'Add @mint{2%g}.\n\n');
    assert.deepEqual(selectedContent(new Recipe(compiled.text),'*'),selectedContent(original,variant));
  }
  classificationResults.push({case:`leading-${name}`,status:'pass',result:'preserved',variants:['*','herb']});
  console.log(`PASS pinned consumer classification: leading-${name}`);
}
const annotationProbes=[
  {name:'ingredient',source:'Add @milk{1%cup}[with @salt{2%g}]|water{2%cup}.\n',
   unsafe:'Add @milk{1%cup}[with @salt{2%g}].\n',native:{ingredients:['milk','salt'],cookware:[],timers:[]}},
  {name:'cookware',source:'Add @milk{1%cup}[in #pan{}]|water{2%cup}.\n',
   unsafe:'Add @milk{1%cup}[in #pan{}].\n',native:{ingredients:['milk'],cookware:['pan'],timers:[]}},
  {name:'timer',source:'Add @milk{1%cup}[after ~rest{2%minutes}]|water{2%cup}.\n',
   unsafe:'Add @milk{1%cup}[after ~rest{2%minutes}].\n',native:{ingredients:['milk'],cookware:[],timers:['rest']}}
];
const nativeProbeCode=`import json,sys
sys.path.insert(0,sys.argv[1])
from oracle_validate import native_json
from oracle_support import verify_cache
binary=verify_cache()
results=[]
for text in json.load(sys.stdin):
    recipe,_=native_json(binary,text)
    results.append({kind:[item['name'] for item in recipe[kind]] for kind in ('ingredients','cookware','timers')})
print(json.dumps(results))`;
const nativeProbe=spawnSync('python3',['-c',nativeProbeCode,path.join(root,'scripts')],
  {input:JSON.stringify(annotationProbes.map(p=>p.unsafe)),encoding:'utf8'});
assert.equal(nativeProbe.status,0,'Native annotation consumer probes failed');
const nativeFacts=JSON.parse(nativeProbe.stdout);
const downstreamAnnotationFacts=[];
for(const [index,probe] of annotationProbes.entries()) {
  const original=new Recipe(probe.source);
  assert.deepEqual(original.ingredients.map(i=>i.name),['milk','water']);
  assert.deepEqual(original.cookware,[]);
  assert.deepEqual(original.timers,[]);
  assert.deepEqual(nativeFacts[index],probe.native,'Native sees tokens inside square-bracket annotation prose');
  await assert.rejects(()=>analyze(probe.source),{code:'UNSUPPORTED_NOTE_CONTENT'});
  downstreamAnnotationFacts.push({case:probe.name,status:'pass',compilerCode:'UNSUPPORTED_NOTE_CONTENT',nativeInventory:probe.native});
  console.log(`PASS downstream annotation rejection: ${probe.name}`);
}
const report={status:'pass',consumer:'@tmlmt/cooklang-parser@3.0.0-alpha.47',
  toolIntegrity:'archives-and-installed-bytes-verified',positiveCases:results,rejectedCases:rejected,
  classificationCases:classificationResults,downstreamAnnotationFacts};
const args=process.argv.slice(2);
assert(args.length===0||(args.length===2&&args[0]==='--report'),'Use --report FILE');
const reportFile=path.resolve(args[1]||path.join(root,'artifacts/oracles/profile.evidence.json'));
await fs.mkdir(path.dirname(reportFile),{recursive:true});
await fs.writeFile(reportFile,JSON.stringify(report,null,2)+'\n');
