#!/usr/bin/env python3
"""Three independent semantic checks of a supplied Orchard Bowl .cook export."""
import argparse
from collections import defaultdict
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from oracle_support import ROOT, LOCK, verify_cache

KEYS = ('metadata', 'ingredients', 'cookware', 'timers', 'sections')
MANIFEST = json.loads((ROOT / 'fixtures/oracle-manifest.json').read_text())


def decimals(value):
    if isinstance(value, list):
        return [decimals(v) for v in value]
    if isinstance(value, dict):
        return {k: (Decimal(str(v)) if k == 'quantity' and v is not None and not isinstance(v, (dict, list))
                    else decimals(v)) for k, v in value.items()}
    return value


def expected(variant, grain):
    key = f"{'default' if variant == '*' else variant}-{grain}"
    spec = MANIFEST['cases'][key]
    return key, decimals({k: spec[k] for k in KEYS})


def require_equal(actual, wanted, label):
    if actual != wanted:
        raise AssertionError(f'{label} disagrees with handwritten expectations')


def handwritten_parse(text):
    """Small independent fixture scanner, deliberately NOT a general Cooklang parser.

    No compiler code, no third-party parser, no compiler snapshots. Decimal handles
    numeric equality, while ordered token objects retain every character of prose.
    """
    text = text.replace('\r\n', '\n')
    assert '\r' not in text
    header, body = text.split('\n---\n', 1)
    assert header.startswith('---\n'), 'Missing fixture metadata'
    metadata = {}
    for line in header[4:].splitlines():
        name, value = line.split(': ', 1)
        assert name in ('title', 'servings') and name not in metadata
        metadata[name] = int(value) if name == 'servings' else value
    result = dict(metadata=metadata, ingredients=[], cookware=[], timers=[], sections=[])
    token = re.compile(r'([@#~])([^@#~{}\n]+)\{([^{}]*)\}')
    for block in re.split(r'\n\s*\n', body.strip()):
        heading = re.fullmatch(r'== (.+) ==', block)
        if heading:
            result['sections'].append({'name': heading.group(1), 'steps': []})
            continue
        assert result['sections'], 'Step appears before a section'
        assert '\n' not in block, 'Unexpected multiline fixture step'
        items, end = [], 0
        for match in token.finditer(block):
            prose = block[end:match.start()]
            assert not any(c in prose for c in '@#~{}|[]'), 'Unrecognized output syntax'
            if prose:
                items.append({'type':'text', 'value':prose})
            marker, name, amount = match.groups()
            assert name == name.strip()
            if marker == '#':
                assert amount == '', 'Unexpected cookware quantity'
                value, kind, collection = {'name': name, 'quantity': None}, 'cookware', 'cookware'
            else:
                number, unit = amount.split('%')
                assert re.fullmatch(r'\d+(?:\.\d+)?', number), 'Unexpected fixture amount'
                value = {'name':name, 'quantity':Decimal(number), 'unit':unit}
                kind, collection = ('ingredient','ingredients') if marker == '@' else ('timer','timers')
            result[collection].append(value)
            items.append({'type':kind, **value})
            end = match.end()
        prose = block[end:]
        assert not any(c in prose for c in '@#~{}|[]'), 'Unrecognized output syntax'
        if prose:
            items.append({'type':'text','value':prose})
        result['sections'][-1]['steps'].append(items)
    return result


def native_number(q):
    assert q['value']['type'] == 'number'
    value = q['value']['value']
    assert value['type'] == 'regular', 'Matrix quantities must be regular numbers'
    return Decimal(str(value['value']))


def normalize_native(data):
    assert data['inline_quantities'] == [], 'Unexpected inline quantity'
    def component(item, kind):
        if kind != 'timer':
            assert item.get('alias') is None and item.get('note') is None
            assert not item.get('modifiers') and item.get('reference') is None
        q = item['quantity']
        value = {'name':item['name'], 'quantity':native_number(q) if q else None}
        if kind != 'cookware':
            value['unit'] = q['unit'] if q else None
        return value
    result = {
        'metadata':data['metadata']['map'],
        'ingredients':[component(i,'ingredient') for i in data['ingredients']],
        'cookware':[component(i,'cookware') for i in data['cookware']],
        'timers':[component(i,'timer') for i in data['timers']],
        'sections':[]
    }
    for section in data['sections']:
        steps = []
        for number, step in enumerate(section['content'], 1):
            assert step['type'] == 'step'
            assert step['value']['number'] == number, 'Native step numbering/order changed'
            items = []
            for item in step['value']['items']:
                kind = item['type']
                if kind == 'text':
                    items.append({'type':'text', 'value':item['value']})
                else:
                    collection = {'ingredient':'ingredients','cookware':'cookware','timer':'timers'}[kind]
                    items.append({'type':kind, **result[collection][item['index']]})
            steps.append(items)
        result['sections'].append({'name':section['name'], 'steps':steps})
    return result


def shopping_semantics(items):
    totals = defaultdict(Decimal)
    seen = set()
    for item in items:
        assert item['name'] not in seen, 'Shopping list contains duplicate ingredient groups'
        seen.add(item['name'])
        assert item['quantity'], 'Shopping item has no quantified amounts'
        for q in item['quantity']:
            totals[(item['name'], q['unit'])] += native_number(q)
    return dict(totals)


def expected_shopping(wanted):
    totals = defaultdict(Decimal)
    for item in wanted['ingredients']:
        totals[(item['name'], item['unit'])] += item['quantity']
    return dict(totals)


def native_json(binary, text):
    # Separate cwd and config directory: no project or user pantry/aisle config.
    with tempfile.TemporaryDirectory(prefix='cookbranch-native-') as directory:
        folder = Path(directory)
        recipe = folder / 'selected.cook'
        recipe.write_text(text, encoding='utf-8', newline='')
        config = folder / 'isolated-config'
        config.mkdir()
        env = dict(os.environ, COOK_CONFIG_DIR=str(config))
        def run(args):
            run = subprocess.run([str(binary), *args], cwd=folder, env=env,
                                 text=True, capture_output=True, timeout=30)
            assert run.returncode == 0, 'CookCLI rejected the supplied recipe'
            return json.loads(run.stdout, parse_float=Decimal)
        recipe_json = run(['recipe', 'selected.cook', '-f', 'json'])
        shopping_json = run(['shopping-list', 'selected.cook', '-f', 'json', '--ignore-pantry', '-p'])
        return recipe_json, shopping_json


def check_handwritten(text, wanted):
    actual = handwritten_parse(text)
    require_equal(actual, wanted, 'Decimal fixture scanner')
    return actual


def check_extension(file, variant, grain, wanted):
    result = subprocess.run(['node', str(ROOT/'scripts/oracle-extension.mjs'), str(file), variant, grain],
                            text=True, capture_output=True, timeout=30)
    assert result.returncode == 0, 'Pinned extension oracle rejected the supplied export'
    data = decimals(json.loads(result.stdout))
    require_equal(data['originalSelected'], wanted, 'Explicit extension selection')
    require_equal(data['exported'], wanted, 'Extension parser on actual export')
    require_equal(data['exported'], data['originalSelected'], 'Extension source/export agreement')
    return data


def check_native(binary, text, wanted):
    recipe, shopping = native_json(binary, text)
    actual = normalize_native(recipe)
    require_equal(actual, wanted, 'Native recipe inventory and ordered structure')
    require_equal(shopping_semantics(shopping), expected_shopping(wanted), 'Native shopping list')
    return {'recipe': actual, 'shopping': [
        {'name':name, 'quantity':quantity, 'unit':unit}
        for (name, unit), quantity in shopping_semantics(shopping).items()
    ]}


def validate(file, variant, grain, binary=None):
    binary = binary or verify_cache()
    key, wanted = expected(variant, grain)
    payload = Path(file).read_bytes()
    text = payload.decode('utf-8')
    scanned = check_handwritten(text, wanted)
    extension = check_extension(Path(file).resolve(), variant, grain, wanted)
    native = check_native(binary, text, wanted)
    return {'status':'pass', 'case':key, 'exportSha256':hashlib.sha256(payload).hexdigest(),
            'oracles':{'handwrittenDecimal': 'pass', 'pinnedExtension': 'pass',
                       'nativeRecipeAndShopping': 'pass'},
            'versions':{'extensionParser':extension['version'], 'cookcli':LOCK['native']['version']},
            'toolIntegrity': 'archives-and-installed-bytes-verified',
            'oraclePins': {'extensionTarballIntegrity': LOCK['packages'][0]['integrity'],
                           'cookcliArchiveSha256': LOCK['native']['sha256'],
                           'cookcliSourceCommit': LOCK['native']['sourceCommit']},
            'manifestSha256': hashlib.sha256((ROOT/'fixtures/oracle-manifest.json').read_bytes()).hexdigest(),
            'sourceFixtureSha256': hashlib.sha256((ROOT/'fixtures/orchard-bowl.cook').read_bytes()).hexdigest(),
            'explicitChoices':extension['explicitChoices'], 'normalized':scanned, 'native':native}


def negative_control(binary=None):
    binary = binary or verify_cache()
    text = (ROOT/'fixtures/orchard-bowl.cook').read_text()
    recipe, shopping = native_json(binary, text)
    names = [i['name'] for i in recipe['ingredients']]
    require_equal(names, ['cooked barley','peas','lemon juice','herb dressing','parsley'], 'Negative-control native ingredients')
    assert sum(len(s['content']) for s in recipe['sections']) == 4
    assert [s['name'] for s in recipe['sections']] == ['Base', '[herb] Finish']
    assert set(i['name'] for i in shopping) == set(names)
    _, selected = expected('herb', 'rice')
    assert shopping_semantics(shopping) != expected_shopping(selected)
    return {'status':'pass','nativeSourceIngredients':names,'nativeSourceSteps':4,
            'interpretation':'Unprepared extension syntax is ordinary native text and leaks both dressing branches; this is a semantic negative control, not a native parser bug.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--file', type=Path)
    parser.add_argument('--variant', choices=['*','herb'])
    parser.add_argument('--grain', choices=['barley','rice'])
    parser.add_argument('--report', type=Path, help='Optional share-safe JSON evidence')
    parser.add_argument('--negative-control', action='store_true')
    args = parser.parse_args()
    try:
        if args.negative_control:
            report = negative_control()
        else:
            if not all((args.file,args.variant,args.grain)):
                parser.error('--file, --variant and --grain are required together')
            report = validate(args.file, args.variant, args.grain)
        encoded = json.dumps(report, indent=2, default=str)+'\n'
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(encoded)
        print(encoded, end='')
    except (AssertionError, ValueError, KeyError, OSError, subprocess.SubprocessError) as error:
        print(json.dumps({'status':'fail','error':type(error).__name__,
                          'reason':str(error) if isinstance(error, AssertionError) else 'Oracle input, dependency, or execution failure'}))
        return 1
    return 0

if __name__ == '__main__':
    sys.exit(main())
