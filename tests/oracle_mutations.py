"""Prove each independent validator rejects damaged ACTUAL compiler exports."""
import json
from pathlib import Path
import subprocess
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch
import copy

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from oracle_validate import (check_extension, check_handwritten, check_native, expected,
                             validate, verify_cache, native_json, shopping_semantics, expected_shopping, require_equal)
import oracle_support


class IndependentOracleMutationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='cookbranch-mutations-')
        cls.directory = Path(cls.temp.name)
        cls.binary = verify_cache()
        run = subprocess.run(['node', str(ROOT/'scripts/oracle-matrix.mjs'), '--output-dir', str(cls.directory/'matrix')],
                             text=True, capture_output=True, timeout=120)
        if run.returncode:
            raise RuntimeError('Actual compiler matrix must pass before mutation tests: '+run.stdout)
        cls.base = (cls.directory/'matrix/herb-rice.cook').read_text()
        _, cls.wanted = expected('herb','rice')
        validate(cls.directory/'matrix/herb-rice.cook','herb','rice',cls.binary)
        cls.mutations = {
            'changed_quantity': cls.base.replace('{200%g}','{201%g}'),
            'changed_unit': cls.base.replace('{200%g}','{200%kg}'),
            'inactive_dressing_leak': cls.base+'\nFold in @lemon juice{15%ml}.\n',
            'inactive_grain_leak': cls.base.replace(' with @peas',' and @cooked barley{180%g} with @peas'),
            'timer_loss': cls.base.replace('~rest{2%minutes}','two minutes'),
            'timer_quantity_change': cls.base.replace('~rest{2%minutes}','~rest{3%minutes}'),
            'timer_unit_change': cls.base.replace('~rest{2%minutes}','~rest{2%hours}'),
            'cookware_loss': cls.base.replace('#bowl{}','bowl'),
            'cookware_name_change': cls.base.replace('#bowl{}','#pan{}'),
            'step_loss': cls.base.replace('Fold in @herb dressing{25%ml}.\n',''),
            'section_loss': cls.base.replace('== Finish ==\n',''),
            'step_order_change': cls.base.replace('Mix @cooked rice{200%g} with @peas{60%g} in a #bowl{}.\n\nFold in @herb dressing{25%ml}.',
                                                   'Fold in @herb dressing{25%ml}.\n\nMix @cooked rice{200%g} with @peas{60%g} in a #bowl{}.'),
            'prose_loss': cls.base.replace(', then wait for ', ', '),
            'metadata_change': cls.base.replace('servings: 2','servings: 3'),
            'unprepared_source': (ROOT/'fixtures/orchard-bowl.cook').read_text(),
        }
        assert all(text != cls.base for text in cls.mutations.values()), 'An intended mutation was not applied'

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_handwritten_decimal_scanner_rejects_every_mutation(self):
        for name, text in self.mutations.items():
            with self.subTest(mutation=name), self.assertRaises((AssertionError, ValueError)):
                check_handwritten(text, self.wanted)

    def test_pinned_extension_rejects_every_mutation(self):
        for name, text in self.mutations.items():
            file = self.directory/'mutated.cook'
            file.write_text(text)
            with self.subTest(mutation=name), self.assertRaises(AssertionError):
                check_extension(file,'herb','rice',self.wanted)

    def test_native_recipe_and_shopping_reject_every_mutation(self):
        for name, text in self.mutations.items():
            with self.subTest(mutation=name), self.assertRaises(AssertionError):
                check_native(self.binary,text,self.wanted)

    def test_shopping_semantics_reject_changed_missing_and_duplicate_items(self):
        _, shopping = native_json(self.binary, self.base)
        wanted = expected_shopping(self.wanted)
        require_equal(shopping_semantics(shopping), wanted, 'Shopping baseline')
        cases = []
        changed = copy.deepcopy(shopping)
        changed[0]['quantity'][0]['value']['value']['value'] += 1
        cases.append(changed)
        changed = copy.deepcopy(shopping)
        changed[0]['quantity'][0]['unit'] = 'kg'
        cases.append(changed)
        cases.append(copy.deepcopy(shopping[1:]))
        cases.append(copy.deepcopy(shopping + [shopping[0]]))
        for index, items in enumerate(cases):
            with self.subTest(mutation=index), self.assertRaises(AssertionError):
                require_equal(shopping_semantics(items), wanted, 'Mutated shopping list')

    def test_oracle_cache_rejects_changed_archive_binary_and_installed_parser(self):
        isolated = self.directory/'integrity-cache'
        shutil.copytree(oracle_support.CACHE, isolated)
        with patch.object(oracle_support, 'CACHE', isolated):
            verify_cache()
            parser_lock = oracle_support.LOCK['packages'][0]
            targets = [isolated/'native/cook',
                       isolated/'archives'/parser_lock['archive'],
                       isolated/'node_modules/@tmlmt/cooklang-parser/dist/index.mjs']
            for index, target in enumerate(targets):
                original = target.read_bytes()
                target.write_bytes(original + b'altered')
                try:
                    with self.subTest(mutation=index), self.assertRaises(AssertionError):
                        verify_cache()
                finally:
                    target.write_bytes(original)
            verify_cache()

    def test_share_safe_evidence_has_no_machine_paths(self):
        report = validate(self.directory/'matrix/herb-rice.cook','herb','rice',self.binary)
        encoded = json.dumps(report, default=str)
        self.assertNotIn(str(ROOT),encoded)
        self.assertNotIn(str(self.directory),encoded)
        self.assertEqual(report['status'],'pass')

if __name__ == '__main__':
    unittest.main(verbosity=2)
