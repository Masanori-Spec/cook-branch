# Independent CookBranch export verification

## What the gate proves

The original **Orchard Bowl** source has an explicit default/herb variant and a barley/rice ingredient alternative. The four-case gate obtains every tested `.cook` file from `src/compiler.js`; it does **not** substitute a handwritten expected recipe for an app-generated export. The validator also accepts a supplied file, so the same checks can consume the browser's actual downloaded `selected.cook`.

| Case | Grain | Dressing | Sections / steps | Cookware | Timer |
| --- | --- | --- | --- | --- | --- |
| default-barley | cooked barley 180 g | lemon juice 15 ml | Base / 2 | bowl | none |
| default-rice | cooked rice 200 g | lemon juice 15 ml | Base / 2 | bowl | none |
| herb-barley | cooked barley 180 g | herb dressing 25 ml, parsley 3 g | Base + Finish / 3 | bowl | rest, 2 minutes |
| herb-rice | cooked rice 200 g | herb dressing 25 ml, parsley 3 g | Base + Finish / 3 | bowl | rest, 2 minutes |

Every case also contains peas 60 g, title `Orchard Bowl`, and servings `2`. The quantity strings, metadata, inventories, ordered sections, ordered steps, component identities, and every retained prose fragment are recorded by hand in `fixtures/oracle-manifest.json`. Four handwritten readable exports are in `fixtures/expected/`; they are review references and are never used as generated output by the matrix runner.

This is a bounded fixture conformance gate, not a general Cooklang validator, a nutrition checker, or proof of compatibility with every Cooklang application. Compiler unit tests separately exercise supported and rejected dialect boundaries. Browser behavior only counts as verified when the browser test actually runs and passes its downloaded file into this validator.

## Three checks, separate from the compiler

1. **Handwritten manifest + Python Decimal.** A deliberately small standalone scanner reads the supplied export. It parses the fixture's metadata, numeric braced tokens, sections and steps, and retains exact ordered prose/component structure. It imports no application code or third-party parser. `Decimal` is used for quantity equality and shopping totals; floats do not become expected values.
2. **Published independent extension parser.** `@tmlmt/cooklang-parser` is pinned to `3.0.0-alpha.47`. The authored source is parsed using the explicit requested variant and explicit `ingredient-item-0` alternative index (`0` barley, `1` rice). No automatic-choice helper or ingredient-note/name substring inference is used. Section and step activity both apply. The oracle compares the selected source and a fresh parse of the actual export against the handwritten manifest, including ordered token structure, cookware and timers. Unselected parser ingredient objects without quantities are excluded. An export that still has variant tags or alternatives fails.
3. **Official native consumer.** CookCLI `0.37.0` parses the actual export with `cook recipe selected.cook -f json` and generates `cook shopping-list selected.cook -f json --ignore-pantry -p`. Each run uses an isolated temporary working directory and `COOK_CONFIG_DIR`; no real pantry or user configuration is consulted. JSON numbers are read as `Decimal`. Inventory, exact ordered section/step token structure, per-section step numbers, metadata, cookware, timer, and unscaled shopping-list quantities/units must match. Shopping list order is not semantic; its name/unit totals are.

No compiler-derived expected snapshots, preview totals, or compiler helper parsers are used as an oracle. `scripts/oracle-matrix.mjs` and `scripts/oracle-profile.mjs` import the compiler only to generate tested outputs. The profile also invokes `analyze` to confirm fail-closed boundaries. A matrix gate returns `pass` only after all three checks agree.

## Reproduce (Linux x86_64, Node 22+, Python 3, curl)

```sh
python3 scripts/fetch-oracles.py
node scripts/oracle-matrix.mjs
node scripts/oracle-profile.mjs
python3 -m unittest discover -s tests -p 'oracle_*.py' -v
```

To validate a browser-downloaded file:

```sh
python3 scripts/oracle_validate.py \
  --file artifacts/browser/selected.cook \
  --variant herb --grain rice \
  --report artifacts/browser/download-oracles.json
```

For the default variant, quote `--variant '*'` so the shell cannot expand it. `--file` must be the actual downloaded bytes, not a regenerated recipe. All three gates run for this supplied file; a download SHA-256 is included in its report.

The matrix writes generated exports, decision receipts and path-free JSON reports under `artifacts/oracles/`. An alternate directory can be chosen with `node scripts/oracle-matrix.mjs --output-dir DIRECTORY`. Each report identifies its case, exact export SHA-256, oracle versions, explicit extension choices and normalized semantic evidence. Reports contain only original fixture content and no machine paths or user recipes.

## Pinned test-only tools

`fixtures/oracle-lock.json` pins the exact HTTPS URL and integrity of every downloaded archive:

- CookCLI `0.37.0`, Linux x86_64 musl release archive
  - Release source commit: `29f6a37618a4d7a73a553e4295a8ae501410b676`
  - Archive SHA-256: `73366635acc24a483f566e2d3cf3ed6b31028f61a22048c6dd6066b051b2ba28`
  - Extracted binary SHA-256: `8fd52bb59611ea710642599e7bbca4239b36ce3cdee27790d5ef216856daf211`
- Extension parser `3.0.0-alpha.47`, archive SHA-512 SRI in the lock file
- Exact imported runtime dependencies: `big.js` `7.0.1`, `smol-toml` `1.9.0`, `yalps` `0.6.4`, and `heap` `0.2.7`, each with archive SHA-512 SRI

The parser's published manifest also declares `unrun`; this build bundles its generated regex code and does not import `unrun` at runtime. The test cache therefore installs the inspected bundle's actual imported dependency closure, not a speculative package installation. No package lifecycle scripts execute.

The fetcher verifies bytes before extracting any tool. Every validator invocation rechecks the native archive and binary digests, every package archive's integrity, package name/version, and every extracted package file against the verified archive. It fails closed on missing or altered dependencies. The default cache is `.cache/oracles/`, excluded from Git and distribution. Set `COOKBRANCH_ORACLE_CACHE` to a temporary directory if desired. For an offline run, seed an archive directory using the exact filenames in the lock, then run `python3 scripts/fetch-oracles.py --archive-dir DIRECTORY --offline`.

**Never ship these binaries or this dependency tree in the app, source archive, or static deployment.** They are external test consumers only. The source distribution includes scripts, lock metadata, fixtures, documentation, and deliberately selected safe evidence. The app remains self-contained.

The `smol-toml` `1.9.0` pin was established from its official exact-version npm metadata and checked against freshly downloaded archive bytes. Other tools were also downloaded and integrity-checked afresh. Any accompanying results describe their actual execution; they do not establish byte equivalence with a previous source tree or imply that browser tests ran.

## Negative control and mutation sensitivity

`python3 scripts/oracle_validate.py --negative-control` feeds the unprepared extension source to native CookCLI. The official parser inventories cooked barley, peas, lemon juice, herb dressing, and parsley, with four steps. Both dressing branches survive because the extension markers are ordinary text to that consumer. This demonstrates why materialization matters. **It is not a native parser bug.**

Mutation tests first run and validate the real compiler matrix. They then damage its herb/rice export. Each of the three validators must independently reject all 15 mutants: ingredient quantity, ingredient unit, inactive dressing leak, inactive grain leak, timer loss, timer quantity, timer unit, cookware loss, cookware identity, step loss, section loss, step order, prose loss, metadata change, and the unprepared source. Success is checked before mutation rejection, so a missing dependency cannot be counted as a successful rejection. Additional tests check shopping semantics and byte-integrity enforcement.

## Bounded-profile classification regressions

`node scripts/oracle-profile.mjs` runs an additional pinned-consumer gate and writes `artifacts/oracles/profile.evidence.json` (or choose `--report FILE`). Its four handwritten positive cases cover repeated ingredient names, exact fractions, Unicode/CRLF, and comma-tag section/step intersections. Every ingredient choice uses an explicit fixed occurrence ID/index. Each case checks literal expected output bytes and independently parsed source/export structure and quantities. Fractions are normalized with exact integer rational arithmetic, not floating-point arithmetic.

The same gate records actual upstream interpretations before asserting safe compiler behavior:

- `--` inside an apparent ingredient token ends the source instruction in alpha.47. The apparent following alternative does not exist. CookBranch rejects comment-delimiter/token overlap.
- Parenthesized preparation immediately attached to the final alternative belongs to that ingredient. Keeping it after selecting a different ingredient changes its meaning. CookBranch rejects this syntax; whitespace-separated parenthetical prose is a different construct.
- BOM before a variant step, section, YAML frontmatter or note is interpreted by the consumer as leading whitespace. CookBranch retains the prefix bytes for surviving nodes while preserving consumer classification. The gate also checks NBSP, em-space and ideographic-space prefixes for both default and named variants.
- Leading block comments, including chained/mixed comment prefixes across newlines, can expose a variant tag, note marker or section marker after the consumer strips comments. CookBranch conservatively rejects any leading comment prefix followed by meaningful content in the same paragraph, and multiline block comments. Standalone comment-only paragraphs are preserved alongside real instructions but cannot satisfy a nonempty recipe or selected variant.
- YAML frontmatter is accepted only at the absolute start of the source, optionally following one BOM. The gate checks that indented and later YAML blocks are rejected, including a later metadata value containing an apparent ingredient token that alpha.47 does not inventory.
- Mixed `>>` lines and instructions can be classified as one note or one untagged step by alpha.47. The gate checks these actual classifications and compiler rejection. The bounded profile conservatively requires blank-separated section headers as well, including nearby heading/metadata combinations that the consumer itself could understand.
- Square-bracket annotations are plain adjacent text for native CookCLI. In deliberate unsafe consumer probes, `@salt`, `#pan` and `~rest` within that text become real ingredients, cookware and timers. The gate independently checks those exact native inventories and requires `UNSUPPORTED_NOTE_CONTENT` from the compiler for all three marker classes.

There are 36 recorded cases: four positive content cases, two token/preparation rejections, twenty-seven classification cases, and three native annotation probes. These are bounded regression evidence, not a claim that all inputs or all Cooklang dialects are exhaustively covered. The rejection cases are never presented as successfully compiled recipes.

## Primary sources

- [Cooklang specification](https://cooklang.org/docs/spec/)
- [Extension dialect guide](https://cooklang-parser.tmlmt.com/v3/guide-extensions.html)
- [Parser package source](https://github.com/tmlmt/cooklang-parser)
- [CookCLI v0.37.0 release](https://github.com/cooklang/cookcli/releases/tag/v0.37.0)
- [Pinned CookCLI source commit](https://github.com/cooklang/cookcli/commit/29f6a37618a4d7a73a553e4295a8ae501410b676)
- [Official recipe command](https://cooklang.org/cli/commands/recipe/)
- [Exact-version smol-toml metadata](https://registry.npmjs.org/smol-toml/1.9.0)
