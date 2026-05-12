# Image Generation Approval Safety Plan

## Scope restatement
- Goal: harden generated-image prompt quality, size-guide validation, Gemini image-wrapper parity, slot-specific retry behavior, and fail-closed approval/media selection.
- In-scope files: `src/openai-client.mjs`, `src/server.mjs`, `src/gemini-client.mjs`, and frontend selection code only if failed generated images can still be selected/uploaded by default.
- Out of scope: Shopify write behavior except the generated-media selection gate that controls whether failed generated media reaches Shopify payload creation.
- Time/scope: one bounded implementation pass with narrow syntax/import verification and available smoke checks.

## Constraints
- Preserve current architecture and public API names unless a signature update is needed for dimensions.
- Keep the change set minimal and reversible.
- Keep provider behavior equivalent where practical.
- Fail closed for generated media approval.
- Keep failed images visible for manual review and download.
- Do not introduce broad rewrites.
- Do not use brittle model-culture wording in prompts.

## Evidence read before planning
- `src/openai-client.mjs` contains `normalizeImageDirectivePrompt`, `normalizeCopyPlan`, `validateDerivedImage`, and `buildImageRetryPrompt`.
- `src/server.mjs` contains `generateImagesForPlan`, `buildCleanSizeGuidePrompt`, `buildImageAppendImagePlan`, and `resolveGeneratedMediaPayload`.
- `src/gemini-client.mjs` wraps image prompts and currently includes brittle "Nano Banana 2 behavior" wording.
- `public/app.js` renders generated image choices and currently selects the first provider per slot without checking validation state.
- `package.json` has no test/lint/typecheck scripts; it has app, desktop, catalog, Shopify, and draft workflow scripts.

## Builder
1. Update OpenAI prompt normalization.
   - Add dimension helpers for integer `heightCm` and `widthCm`.
   - Pass dimensions from `normalizeCopyPlan` into `normalizeImageDirectivePrompt`.
   - For `slot === "size-guide"`, require exact `height {heightCm} cm` and `width {widthCm} cm` labels when present.
   - Forbid invented, rounded, swapped, approximate, or inconsistent measurements.
   - Fail closed when a size-guide directive is normalized without both integer dimensions, because current new and hydrated existing workflows require both dimensions.

2. Update existing-product image append prompts.
   - Replace example-based size-guide label wording with exact dimension wording.
   - Make `buildCleanSizeGuidePrompt` accept `heightCm` and `widthCm` and fail closed without both values.

3. Add size-guide-specific validation.
   - Extend `validateDerivedImage` parameters with `heightCm` and `widthCm`.
   - Add slot-specific validator rules for clean measurement graphics, centered/full product visibility, exact required guides, exact labels, forbidden props, and non-lifestyle presentation.
   - Pass dimensions from `generateImagesForPlan`.

4. Harden retries.
   - Extend `buildImageRetryPrompt` options with `slot`, `heightCm`, and `widthCm`.
   - For size-guide retries, add exact identity, exact dimensions, exact labels, measurement-only correction, no product identity/scale changes, and no props/lifestyle context.
   - Update retry call sites in `server.mjs`.

5. Harden Gemini image wrapper.
   - Replace generic language and remove "Nano Banana 2 behavior".
   - Add explicit source-of-truth, 1:1 identity, dried/preserved, no-water, no stylization, and allowed-change constraints.

6. Fail closed for approval and media selection.
   - Add `approvedForUpload: validationPassed` to generated image objects.
   - Reject generated media payload items unless `approvedForUpload === true`.
   - Update frontend image radio/checkbox rendering so failed images remain visible but disabled by default with warnings.
   - Update selected-media collection to reject unapproved images even if the DOM is manipulated.

7. Verify.
   - Run syntax/import checks for changed modules.
   - Run available non-destructive checks only. Do not run Shopify or draft workflow scripts.
   - Grep/inspect for exact size-guide wording, removed brittle wording, approval gate, and frontend disabled behavior.

## Adversarial reviewer
- Risk: failing closed on missing dimensions could block a future optional size-guide workflow. Current evidence shows new and hydrated existing flows require integer dimensions, so this is acceptable for size-guide generation.
- Risk: adding `approvedForUpload` alone is insufficient if the frontend or API still accepts failed media. The server must enforce the approval flag in `resolveGeneratedMediaPayload`, and the frontend must disable failed options.
- Risk: radio groups with only failed options could leave a slot with no selectable option. This is acceptable fail-closed behavior; the write action should block with a clear selection error rather than upload failed media.
- Risk: Gemini-specific wrapper constraints could conflict with the already-normalized prompt. Repetition is acceptable because it reinforces provider parity without changing the architecture.
- Risk: validation is model-based, not deterministic image analysis. The safest local improvement is explicit validator instructions plus fail-closed media selection; full deterministic OCR/vision checks would be a larger architecture change and is out of scope.
- Risk: changing Shopify write internals could create production risk. Keep Shopify code untouched except the upstream generated-media payload gate in `server.mjs`.

## Reconciliation
- Use centralized prompt normalization and server-side payload gating as the primary safety controls.
- Use frontend disabled state as operator UX, not the only safety boundary.
- Fail closed on size-guide generation without exact dimensions because all currently verified size-guide workflows should have dimensions.
- Avoid public API renames; only internal function signatures receive dimension/options parameters.
- Do not keep "Nano Banana 2 behavior"; no project-level evidence justifies it.

## Atomic work unit
- Unit: image prompt, validation, retry, provider parity, and approval gating hardening for generated image media.
- Files expected to change: `src/openai-client.mjs`, `src/server.mjs`, `src/gemini-client.mjs`, `public/app.js`, and possibly `public/styles.css`.
- Acceptance criteria:
  - Size-guide prompts use exact provided dimensions and forbid invented/rounded/swapped/approximate values.
  - Size-guide validation can fail bad measurement graphics, missing/wrong labels, missing guides, props, lifestyle scenes, and non-centered/non-full products.
  - Gemini image wrapper uses explicit provider-neutral constraints and no brittle model-culture wording.
  - Retry prompts are slot-aware, with strict size-guide correction language.
  - Failed generated images remain visible but are not approved/uploadable by default.
  - Modified modules parse successfully.

## Ledger-ready status row
| Unit | Status | Scope | Verification | Notes |
| --- | --- | --- | --- | --- |
| FF_PRODUCT_IMAGE_APPROVAL_SAFETY | READY | Prompt, validation, retry, Gemini wrapper, and generated-media approval gating | Syntax/import checks plus grep/manual inspection | `workspace/state/FEATURE_STATUS.md` was not found in this repo root, so this row is plan-local only. |

## NEXT_ACTION
Execute `FF_PRODUCT_IMAGE_APPROVAL_SAFETY` as one bounded implementation unit.

## Rollback considerations
- Revert the small edits in the listed files.
- Remove `approvedForUpload` gating only if a deliberate manual override design is added and reviewed.
- Keep failed generated files on disk; rollback does not require deleting generated artifacts.

## Verification expectations
- `node --check src/openai-client.mjs`
- `node --check src/server.mjs`
- `node --check src/gemini-client.mjs`
- `node --check public/app.js`
- Manual code inspection/grep for:
  - exact `height {heightCm} cm` / `width {widthCm} cm` prompt logic
  - size-guide validator rules
  - no "Nano Banana" wording
  - `approvedForUpload` server and frontend gating
  - no unrelated Shopify write edits

## Readiness verdict
READY

Next handoff: `$project-build`
