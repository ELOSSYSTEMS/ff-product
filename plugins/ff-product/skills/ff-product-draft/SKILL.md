---
name: ff-product-draft
description: Create Forever Flowers draft Shopify products from 1-3 bouquet photos and minimal operator input. Use when Codex needs to analyze the public storefront catalog, preserve bouquet and vase identity across five PDP image briefs, generate Shopify-ready copy, and stop at draft creation rather than publish.
---

# FF Product Draft

## Overview

Use this skill for the FF Product workflow: learn the store's current PDP patterns, prepare product data from bouquet photos, and create draft-only Shopify products when Admin API credentials are available.

## Workflow

1. Inspect the public storefront first.
2. Preserve the exact bouquet and vase identity; allow only staging, crop, lighting, and scene changes.
3. Prepare five image targets:
   - studio
   - zoomed detail
   - size guide with a clear scale reference
   - in-home scene 1
   - in-home scene 2
4. Generate Shopify-ready product content with draft-only intent.
5. Create the draft product only after verifying credentials and required fields.

## Constraints

- Treat `draft only` as a hard rule. Do not publish automatically.
- Do not invent admin-side defaults that were not verified from the storefront or Admin API.
- If Admin API credentials are missing or fail, stop after producing the product payload and image brief set.
- Keep copy aligned with the current Forever Flowers storefront tone and section structure.
- Use OpenAI for product copy only; use Gemini for image generation.
- Treat `set` and `arrangement` as the only valid product kinds for this workflow.
- Map kinds to defaults:
  - `set` -> product type `סט מעוצב`
  - `arrangement` -> product type `סידור מעוצב`
- Use the default product template for both kinds.
- Overwrite these fields after duplication:
  - title
  - description
  - `custom.description`
  - images
  - price
  - `custom.dimensions`
  - `custom.height`
  - `custom.width`
- Inherit these fields from the duplicated source unless the operator says otherwise:
  - collections via product type
  - tags
  - base variant structure
- Default new product and variant inventory to `20`.
- Duplicate sources:
  - `arrangement` -> `gid://shopify/Product/9133866221806`
  - `set` -> `gid://shopify/Product/9190263324910`

## Commands

- `npm run catalog:sample`
  - Fetch a small public storefront product sample from `products.json`.
- `npm run catalog:analyze`
  - Summarize storefront product structure and common PDP blocks.
- `npm run shopify:test`
  - Verify Admin API token exchange and fetch a small product sample.
- `npm run shopify:analyze`
  - Analyze admin-side product defaults, status mix, template suffix usage, and option/tag patterns.
- `npm run draft:dry-run -- --input <path>`
  - Validate and print the draft payload without writing to Shopify.
- `npm run draft:create -- --input <path>`
  - Create the draft product in Shopify when credentials are valid.

## References

- Read [references/forever-flowers-pdp-pattern.md](./references/forever-flowers-pdp-pattern.md) before generating copy or mapping sections.
- Use the app CLI in the project root for live verification and payload generation.
