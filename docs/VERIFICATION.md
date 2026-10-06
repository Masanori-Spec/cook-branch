# Verification status

## Verified source build

Source commit: [`11b84498c46bd01905cd92ac7bdb709ec29d63e7`](https://github.com/Masanori-Spec/cook-branch/commit/11b84498c46bd01905cd92ac7bdb709ec29d63e7)

Hosted workflow: [successful run 37401462594](https://github.com/Masanori-Spec/cook-branch/actions/runs/37401462594), checked 2026-10-06. Both compiler-and-oracles and browser-download-oracles completed successfully on Ubuntu 22.04. Chrome ran with its sandbox enabled.

- 129 Node tests passed: 123 compiler, two byte-limit/receipt and four build/server tests
- Four actual compiler exports passed handwritten Decimal/ordered structure, explicit-choice alpha.47 and native CookCLI recipe/shopping checks
- Six mutation/integrity test methods passed, including 15 semantic mutants independently rejected by each of three validators (45 rejections)
- All 36 differential profile cases passed
- All external oracle archives were refetched and checked against pinned integrity
- 39 browser checks passed, including deliberately delayed file, record and hash races, keyboard controls, stale-output clearing, bad inputs, CRLF/BOM handling and large-record reimport
- All four files actually downloaded through the browser passed all three independent oracles
- The offline page exported identical selected-recipe bytes, with zero runtime errors or external requests
- The hosted offline artifact matches the locally reviewed artifact SHA-256: `32488e213de82bc2d6dd77fc84867a9d18f0ffb24881e29557460074c3f55b40`

## Visual review

All nine screenshots and the rendered print page were independently inspected. Desktop Japanese/English initial, reviewed, diff and error states, 320/390-pixel layouts, and the one-page print showed no visual blocker. Japanese characters rendered, controls stayed within the viewport, and retained/removed content remained visible. The source textarea intentionally allows horizontal scrolling for long lines.

Non-blocking polish: English count labels use plural wording at one (`1 choices`, `1 removed branches`). Runtime was preserved rather than changing the tested build for this copy-only issue. This review is not a formal accessibility/contrast certification, and it does not establish correctness for arbitrary unsupported recipes.

Public-safe JSON summaries in `evidence/browser-report.json`, `evidence/hosted-verification.json` and `evidence/visual-review.json` identify the named run, exact source and export hashes, image dimensions and screenshot/PDF hashes. Full screenshots and consumer reports are in that workflow's artifact downloads.

## Reconstruction and review provenance

This source tree was reconstructed on 2026-10-06 after its previous local files became unavailable. Every pass reported above was executed afresh. The reconstructed compiler independently matched its previously recorded SHA-256; no blanket claim of identical UI/build bytes was made.

Fresh read-only review reran historical compiler failures and all four consumer cases. It also found an offline-build replacement-string bug that collapsed dollar signs; replacement callbacks fixed it, and a regression now compares exact embedded JavaScript/CSS bytes and parses the extracted script. The final source backup's 42 payload entries and manifest were independently verified before publication.

This document's evidence applies to the exact source commit linked above. The closeout changes documentation/evidence only; final-head CI and archive/Library refresh are handled after that patch lands. Source-review snapshots in earlier evidence files retain their historical pending-gate fields rather than being rewritten to imply they had already seen hosted results.
