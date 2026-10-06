# Verification status

This source tree was reconstructed on 2026-10-06 after the previous local workspace files became unavailable. Verification below refers only to fresh execution on these reconstructed files; previous pass counts are not treated as current evidence.

Freshly executed:

- 129 Node tests: 123 compiler, two byte-limit/receipt tests and four build/server tests
- All four actual compiler-generated Orchard Bowl recipes passed the independent handwritten Decimal, alpha.47 explicit-choice and native CookCLI recipe/shopping checks
- Six oracle mutation/integrity test methods passed, including 45 independent semantic mutation rejections
- All external oracle archives were refetched and integrity-checked
- All 36 pinned-consumer differential profile cases passed
- Self-contained offline app built; exact embedded source/CSS bytes and extracted module syntax checked
- Fresh independent read-only review passed after catching and verifying the offline-build dollar-expansion fix; historical compiler cases and all four current native/extension/handwritten outputs were independently rechecked

Remaining gates:

- Exact final archive member/hash verification
- Hosted Ubuntu 22.04 sandboxed Chrome interactions, including delayed async races
- All four actual browser downloads checked by the three independent oracles
- Desktop/mobile Japanese/English and print-page pixel review
- Final publication/commit verification and release archive refresh

No browser verification is claimed here. No local browser launch was attempted during reconstruction. A native or unit-test pass alone is not an end-to-end UI pass.
