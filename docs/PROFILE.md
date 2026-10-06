# Bounded syntax profile

This is a deliberately small subset of @tmlmt/cooklang-parser 3.0.0-alpha.47, not a promise to accept all Cooklang or every extension.

## Branches

`[herb]` at the start of an instruction and `== [herb] Finish ==` select an exact named variant. `[*]` means default only; untagged content is shared. Comma-separated names admit either exact variant, with case-sensitive matching. A retained instruction must pass both its own tags and its section's tags. Disjoint explicit scopes are rejected, even when another variant is selected.

Ingredient names and notes do not register variants. Variant names accept letters, digits, spaces, underscores, periods and hyphens. A tag is followed by whitespace; separately tagged instructions require blank-line separation.

Leading Unicode whitespace and a UTF-8 BOM are recognized consistently when finding/removing tags. Retained prefix bytes are preserved. Unknown variants and empty selected recipes fail closed.

## Ingredients and occurrence choices

```
Mix @cooked barley{180%g}|cooked rice{200%g} with @peas{60%g}.
```

Every active occurrence needs an explicit choice, including the first option. Identical ingredient names in different positions do not share decisions. Occurrence IDs bind to original UTF-16 source offsets, and the source hash binds exact UTF-8 bytes. Extra, foreign and inactive choices are rejected.

Quantities and units are opaque written strings. Fractions, Unicode and text quantities may be retained, but are never added, converted or scaled. Inventories list occurrences rather than totals.

A square-bracket annotation is retained with its selected token. Alpha.47 treats it as an option note; stock CookCLI reads it as adjacent plain text. Annotation content containing `@`, `#` or `~` is rejected because it could create phantom native tokens. Adjacent preparation parentheses, such as `@water{2%cup}(boiled)`, are outside this profile; a space-separated prose parenthesis remains prose.

## Structural boundaries

- YAML front matter is allowed only at the absolute source start, optionally after one BOM
- Section headers and legacy `>>` metadata blocks are blank-separated from instructions
- Consecutive `>>` lines are allowed as an opaque metadata-only paragraph
- Metadata cannot acquire a variant scope
- Leading comments must be separate blank-delimited paragraphs; a comment prefix followed by other content is rejected
- Standalone comment paragraphs are preserved, but cannot satisfy the requirement for a real recipe instruction
- Multiline block comments are outside the profile

Retained prose, metadata, order, cookware, timers and line endings are copied. Recognized selection markers, excluded branches and unchosen alternative tokens are removed. An imported CRLF file retains exact bytes until a textarea edit creates a new LF-normalized source and invalidates prior choices.

## Rejections

Grouped alternatives, optional modifiers/branches, recipe references, aliases, cookware units, unit alternatives, scaling, fixed/scalable modifiers, backslash escapes, malformed braces/notes/tags, comment delimiters crossing tokens, ambiguous structural paragraphs, invalid Unicode, NUL and standalone CR are rejected rather than silently flattened.

The UI accepts at most 100,000 UTF-8 source bytes. Records have a separate 8 MiB import/export cap. The pure compiler has a defensive source cap of 1,000,000 UTF-16 code units. A source within the UI limit can produce a larger receipt; both receipt creation and reading enforce the same cap.

## Receipts and asynchronous work

The receipt includes schema/dialect, source hash, variant, explicit choices, selected token records, removed branch records and output hash. Replaying recompiles and rechecks derived records. Compiler decisions are deeply snapshotted before the first asynchronous hash. UI operations use revision guards so delayed reads or hashes cannot revive stale output after a reset or edit.

Hashes are not signatures. A caller able to rewrite a receipt can compute new hashes; author identity and tamper-proof provenance are not claimed.
