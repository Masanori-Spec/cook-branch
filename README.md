# CookBranch

**Choose authored branches. Export one ordinary Cooklang recipe.**

A small local-first workbench for explicitly authored ingredient alternatives and named instruction/section variants. Choose one version, review retained and removed content, then save `selected.cook` and a source-bound `choices.json` record.

日本語 / English · no runtime dependencies · no accounts · no server-side recipe processing

## Why this exists

The independent `@tmlmt/cooklang-parser` already interprets authored variants and explicit ingredient choices. CookBranch is a companion compiler for a deliberately bounded subset of its prerelease extension dialect, providing a portable `.cook` handoff and a reviewable decision record. It is not a new recipe-variant language or a general recipe manager.

Stock CookCLI accepts an unresolved extension source but reads its selection markers as prose. Mutually exclusive branches may both enter the recipe inventory and shopping list. This is a semantic handoff mismatch, not a CookCLI parser bug.

## Run

With Node.js 22 or newer:

```sh
npm run dev
```

Open `http://127.0.0.1:4173`, or run `npm run build` and open `dist/cook-branch.html` directly. The self-contained page has no external assets or runtime packages. A modern browser with Web Crypto is required.

1. Open or paste a `.cook` source; Orchard Bowl is an original example
2. Select default `*` or one exact named variant
3. Explicitly choose every active ingredient alternative, including the first option
4. Review retained instructions, ingredient occurrences, and removed branches
5. Download the selected recipe and optionally its choice record

Files and choices stay in the page and are not automatically saved. Source or choice edits immediately clear prepared output; a variant change clears occurrence decisions. Recipe sources are limited to 100,000 UTF-8 bytes. Choice records have a separate 8 MiB limit enforced before both export and import.

Records bind the exact source SHA-256 to the variant, choices, selected occurrences, removed branches, and output hash. Replaying validates the source and derived fields. These hashes are integrity bindings, not signatures or evidence of who made the choices.

## Supported profile

CookBranch v0.1 uses a bounded subset of `@tmlmt/cooklang-parser@3.0.0-alpha.47`:

- Shared untagged instructions and sections
- Default-only `*` and exact comma-separated named tags
- Intersection semantics: both the section and instruction must permit the variant
- Fully braced adjacent alternatives such as `@cooked barley{180%g}|cooked rice{200%g}`
- Explicit choices per occurrence, including repeated ingredient names
- Ordinary ingredients, cookware, timers and metadata
- Retained prose, ordering, written quantity/unit tokens, and original line endings

Unsupported or ambiguous syntax fails closed: grouped/optional alternatives, references, unit alternatives, scaling, attached preparation parentheses, comment-crossed tokens, mixed structural paragraphs, misplaced YAML, unknown variants and stale/foreign choices. See [the complete profile](docs/PROFILE.md).

Square-bracket annotations stay with their chosen alternative. Alpha.47 treats these as notes; stock CookCLI reads them as adjacent plain text. Structured note interoperability is not claimed. Token-like annotation content is rejected to avoid phantom downstream ingredients, cookware or timers.

No quantity arithmetic, substitutions, serving changes, dietary/allergen assessment or food-safety guarantee is provided. The author remains responsible for the recipe.

## Verification

Orchard Bowl has four independently authored expected combinations:

- Default/barley: barley 180 g, peas 60 g, lemon juice 15 ml; Base section, two steps, bowl, no timer
- Default/rice: cooked rice 200 g instead of barley, otherwise identical
- Herb/barley or herb/rice: herb dressing 25 ml and parsley 3 g instead of lemon; Base + Finish, three steps, bowl, named rest timer of two minutes

Actual compiler and browser exports are checked by three independent consumers:

1. A handwritten manifest and Python Decimal scanner
2. Pinned alpha.47 using explicit choices, never its inference helper
3. CookCLI 0.37.0 recipe JSON and shopping-list JSON in an isolated configuration

```sh
npm test
python3 scripts/fetch-oracles.py
node scripts/oracle-matrix.mjs
node scripts/oracle-profile.mjs
python3 -m unittest discover -s tests -p 'oracle_*.py' -v
npm run build
```

The native negative control confirms that unresolved source leaks mutually exclusive branches. Each independent validator must reject 15 deliberately damaged exports. A separate differential profile gate checks fractions, repeated ingredients, Unicode/CRLF and adversarial classification boundaries.

GitHub Actions uses Ubuntu 22.04 and sandboxed Chrome. Browser tests exercise Japanese/English, keyboard navigation, file/record import, deliberately delayed async operations, stale output, invalid files, responsive layouts, print capture and the offline page. All four actual UI downloads enter the three-oracle gate. Screenshots and print pages require separate visual inspection. Sandbox restrictions are not bypassed to make a browser test pass.

See [current verification status](docs/VERIFICATION.md) and [oracle provenance](docs/oracles.md). The bounded fixture gate is not proof of compatibility with every Cooklang application.

## Source and test tools

The runtime is original JavaScript, HTML and CSS. `npm ci --ignore-scripts` installs the pinned browser-test dependency. Independent parser packages and the native CLI are fetched into ignored `.cache/` paths and are never included in the app or source archive. Release packaging uses an explicit source/evidence allowlist.

The source is provided for inspection; no license grant is implied. Test tools retain their respective licenses.

## References

- [Cooklang specification](https://cooklang.org/docs/spec/)
- [Official alternatives discussion](https://github.com/cooklang/spec/discussions/68)
- [Independent extension guide](https://cooklang-parser.tmlmt.com/v3/guide-extensions.html)
- [CookCLI recipe command](https://cooklang.org/cli/commands/recipe/)
- [CookCLI 0.37.0](https://github.com/cooklang/cookcli/releases/tag/v0.37.0)

Research originally checked 2026-10-05; test artifacts refetched during reconstruction on 2026-10-06. No market-exclusivity or patent claim is made.
