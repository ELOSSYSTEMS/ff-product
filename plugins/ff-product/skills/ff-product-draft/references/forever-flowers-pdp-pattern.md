# Forever Flowers PDP Pattern

Verified storefront observations from `https://foreverflowers.co.il/` as of 2026-04-24:

- Public product data is available at `https://foreverflowers.co.il/products.json`.
- Product pages commonly expose these blocks in rendered content:
  - title
  - image gallery
  - price
  - dimensions
  - shipping
  - returns
  - care instructions
  - flower information
  - post-purchase process
- Some products include vase references directly in the product body or options.
- The storefront language is primarily Hebrew.

Verified admin-side defaults from live store analysis and operator clarification:

- This workflow uses exactly two product kinds:
  - `set`: bouquet and vase together as one product
  - `arrangement`: bouquet only
- `set` defaults:
  - product type: `סט מעוצב`
  - collection: `סטים`
- `arrangement` defaults:
  - product type: `סידור מעוצב`
  - collection: `סידורי פרחים`
- Both kinds use the default product template.
- Duplicate source products:
  - `arrangement` -> `gid://shopify/Product/9133866221806` (`סידור איזון`)
  - `set` -> `gid://shopify/Product/9190263324910` (`סט נוגה`)
- Collections are smart and follow product type automatically.
- Tags are inherited from the duplicated source product.
- Price is provided manually per new product.
- Default inventory target for new products and variants is `20`.
- Preferred generation direction:
  - use OpenAI for product copy only
  - use Gemini for image generation
- `arrangement` products currently inherit the same `אגרטל` variant structure.
- Arrangement pricing rule:
  - `עם אגרטל (שקוף)` = base price
  - `ללא אגרטל` = base price minus `20` NIS
- Required metafield overwrites:
  - `custom.description` as `rich_text_field`
  - `custom.dimensions` as `rich_text_field`
  - `custom.height` as `number_integer`
  - `custom.width` as `number_integer`
- Special-case templates outside this workflow:
  - `bespoke`
  - `gift-card`

Known unknowns:

- Internal tags
- collection assignments
- unpublished template settings
- SEO overrides
- metafields not rendered on the public storefront

Use this reference as the default storefront baseline. If Admin API access is available, prefer live Admin data over this file.
