import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  buildDescriptionRichText,
  buildWorkflowMetafields
} from "./metafields.mjs";
import { extractTitleStem } from "./naming.mjs";
import {
  isWorkflowProduct,
  listRelevantProductTypes,
  resolveProductProfile
} from "./product-profile.mjs";

const PRODUCT_SAMPLE_QUERY = `
  query ProductSample($first: Int!) {
    products(first: $first) {
      nodes {
        id
        title
        handle
        status
        vendor
        productType
        templateSuffix
        tags
      }
    }
  }
`;

const PRODUCT_ANALYSIS_QUERY = `
  query ProductAnalysis($first: Int!) {
    products(first: $first, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        title
        handle
        status
        vendor
        productType
        templateSuffix
        tags
        seo {
          title
          description
        }
        totalInventory
        tracksInventory
        hasOnlyDefaultVariant
        options {
          name
          optionValues {
            name
          }
        }
        media(first: 10) {
          nodes {
            mediaContentType
          }
        }
        variants(first: 10) {
          nodes {
            title
            sku
            price
            compareAtPrice
            inventoryPolicy
          }
        }
      }
    }
  }
`;

const PRODUCT_NAMING_CONTEXT_QUERY = `
  query ProductNamingContext($first: Int!, $after: String) {
    products(first: $first, after: $after, sortKey: TITLE) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        handle
        productType
        status
      }
    }
  }
`;

const PRODUCT_BY_ID_QUERY = `
  query ProductById($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      status
      vendor
      productType
      templateSuffix
      tags
      seo {
        title
        description
      }
      variants(first: 20) {
        nodes {
          title
          price
          compareAtPrice
        }
      }
      metafields(first: 50, namespace: "custom") {
        nodes {
          namespace
          key
          type
          value
        }
      }
      media(first: 20) {
        nodes {
          mediaContentType
          ... on MediaImage {
            id
            alt
            originalSource {
              url
              fileSize
            }
            image {
              url
            }
          }
        }
      }
    }
  }
`;

const PRODUCT_BY_HANDLE_QUERY = `
  query ProductByHandle($first: Int!, $query: String!) {
    products(first: $first, query: $query) {
      nodes {
        id
        title
        handle
        status
        vendor
        productType
        templateSuffix
        tags
      seo {
        title
        description
      }
      variants(first: 20) {
        nodes {
          title
          price
          compareAtPrice
        }
      }
      metafields(first: 50, namespace: "custom") {
        nodes {
          namespace
          key
          type
          value
        }
      }
      media(first: 20) {
        nodes {
          mediaContentType
          ... on MediaImage {
            id
            alt
            originalSource {
              url
              fileSize
            }
            image {
              url
            }
          }
        }
      }
      }
    }
  }
`;

const COLLECTION_PRODUCTS_BY_HANDLE_QUERY = `
  query CollectionProductsByHandle($handle: String!, $first: Int!, $after: String) {
    collectionByHandle(handle: $handle) {
      id
      title
      handle
      products(first: $first, after: $after, sortKey: TITLE) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          title
          handle
          status
          vendor
          productType
          templateSuffix
          tags
          seo {
            title
            description
          }
          variants(first: 20) {
            nodes {
              title
              price
              compareAtPrice
            }
          }
          metafields(first: 50, namespace: "custom") {
            nodes {
              namespace
              key
              type
              value
            }
          }
          media(first: 20) {
            nodes {
              mediaContentType
              ... on MediaImage {
                id
                alt
                originalSource {
                  url
                  fileSize
                }
                image {
                  url
                }
              }
            }
          }
        }
      }
    }
  }
`;

const PRODUCT_DUPLICATE_MUTATION = `
  mutation DuplicateProduct($productId: ID!, $newTitle: String!, $newStatus: ProductStatus) {
    productDuplicate(
      productId: $productId
      newTitle: $newTitle
      newStatus: $newStatus
      includeImages: false
      includeTranslations: false
      synchronous: true
    ) {
      newProduct {
        id
        title
        handle
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_UPDATE_MUTATION = `
  mutation UpdateProduct($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product {
        id
        title
        handle
        status
        templateSuffix
        productType
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_VARIANT_STATE_QUERY = `
  query ProductVariantState($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      status
      variants(first: 20) {
        nodes {
          id
          title
          price
          compareAtPrice
          inventoryPolicy
          inventoryItem {
            id
            tracked
          }
        }
      }
    }
  }
`;

const PRODUCT_VARIANTS_BULK_UPDATE_MUTATION = `
  mutation UpdateProductVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
        title
        price
        compareAtPrice
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const INVENTORY_SET_QUANTITIES_MUTATION = `
  mutation inventorySetQuantities($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) {
    inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
      inventoryAdjustmentGroup {
        createdAt
        reason
        referenceDocumentUri
        changes {
          name
          delta
          quantityAfterChange
        }
      }
      userErrors {
        code
        field
        message
      }
    }
  }
`;

const STAGED_UPLOADS_CREATE_MUTATION = `
  mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters {
          name
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_CREATE_MEDIA_MUTATION = `
  mutation ProductCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media {
        id
        alt
        status
      }
      mediaUserErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_DELETE_MEDIA_MUTATION = `
  mutation ProductDeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
    productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
      deletedMediaIds
      deletedProductImageIds
      mediaUserErrors {
        field
        message
      }
    }
  }
`;

export async function getAccessToken(config) {
  const response = await fetch(
    `https://${config.storeDomain}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.clientId,
        client_secret: config.clientSecret
      })
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Token exchange failed with ${response.status}: ${body.slice(0, 400)}`
    );
  }

  const payload = await response.json();
  if (!payload.access_token) {
    throw new Error("Token exchange succeeded without an access_token.");
  }

  return payload.access_token;
}

export async function shopifyGraphql(config, query, variables = {}) {
  const token = await getAccessToken(config);
  const response = await fetch(
    `https://${config.storeDomain}/admin/api/${config.apiVersion}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token
      },
      body: JSON.stringify({ query, variables })
    }
  );

  if (!response.ok) {
    throw new Error(`GraphQL request failed with ${response.status}.`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(payload.errors)}`);
  }

  return payload.data;
}

function formatMoneyValue(value) {
  return Number(value).toFixed(2);
}

function countValues(items) {
  const counts = new Map();

  for (const item of items) {
    if (
      item === null ||
      item === undefined ||
      item === ""
    ) {
      continue;
    }

    counts.set(item, (counts.get(item) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([value, count]) => ({ value, count }));
}

function summarizeTemplateSuffix(products) {
  const suffixes = countValues(
    products.map((product) => product.templateSuffix ?? "default")
  );

  return {
    dominant: suffixes[0] ?? null,
    distribution: suffixes
  };
}

function mergeMetafields(metafields) {
  const keyed = new Map();

  for (const metafield of metafields) {
    if (!metafield?.namespace || !metafield?.key) {
      continue;
    }

    keyed.set(`${metafield.namespace}.${metafield.key}`, metafield);
  }

  return [...keyed.values()];
}

function mergeTags(tags) {
  return [...new Set(
    (tags ?? [])
      .flatMap((value) => Array.isArray(value) ? value : [value])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
  )];
}

function buildDescriptionMetafield(descriptionHtml) {
  if (!descriptionHtml) {
    return null;
  }

  return {
    namespace: "custom",
    key: "description",
    type: "rich_text_field",
    value: buildDescriptionRichText(descriptionHtml)
  };
}

function parseListMetafieldValue(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [value];
  }
}

function buildCustomBadgesMetafield(metafields, badge) {
  const existingBadgesMetafield = (metafields ?? []).find(
    (metafield) => metafield?.namespace === "custom" && metafield?.key === "badges"
  );
  const badges = mergeTags([
    ...parseListMetafieldValue(existingBadgesMetafield?.value),
    badge
  ]);

  return {
    namespace: "custom",
    key: "badges",
    type: "list.single_line_text_field",
    value: JSON.stringify(badges)
  };
}

function ensureNoUserErrors(errors, operation) {
  if (!errors?.length) {
    return;
  }

  throw new Error(
    `${operation} returned userErrors: ${JSON.stringify(errors)}`
  );
}

function ensureNoMediaUserErrors(errors, operation) {
  if (!errors?.length) {
    return;
  }

  throw new Error(
    `${operation} returned mediaUserErrors: ${JSON.stringify(errors)}`
  );
}

function inferMimeType(filename) {
  const lower = String(filename ?? "").toLowerCase();
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  if (lower.endsWith(".gif")) {
    return "image/gif";
  }

  return "image/jpeg";
}

function normalizeProductMedia(media, payload = {}) {
  return Array.isArray(media)
    ? media.map((mediaItem, index) => ({
        sourcePath: mediaItem.sourcePath ?? null,
        url: mediaItem.url ?? null,
        slot: mediaItem.slot ?? `image-${index + 1}`,
        filename:
          mediaItem.filename ??
          `${mediaItem.slot ?? `image-${index + 1}`}.${(
            mediaItem.url ?? mediaItem.sourcePath ?? ""
          ).toLowerCase().endsWith(".png")
            ? "png"
            : "jpg"}`,
        mimeType:
          mediaItem.mimeType ??
          inferMimeType(
            mediaItem.filename ?? mediaItem.url ?? mediaItem.sourcePath ?? ""
          ),
        alt:
          mediaItem.alt ??
          `${payload.title ?? payload.existingProductHandle ?? payload.existingProductId ?? "Product"} - ${mediaItem.slot ?? `image ${index + 1}`}`
      }))
    : [];
}

function buildVariantUpdates(currentVariants, payload) {
  if (payload.variantPricingPlan?.length) {
    const variantsByTitle = new Map(
      currentVariants.map((variant) => [variant.title, variant])
    );

    return payload.variantPricingPlan.map((plan) => {
      const match = variantsByTitle.get(plan.title);
      if (!match) {
        throw new Error(
          `Variant pricing plan could not find a duplicated variant titled "${plan.title}".`
        );
      }

      return {
        id: match.id,
        price: formatMoneyValue(plan.price),
        compareAtPrice: formatMoneyValue(plan.price)
      };
    });
  }

  if (payload.basePrice === null || payload.basePrice === undefined) {
    return [];
  }

  if (currentVariants.length !== 1) {
    throw new Error(
      "Base-price-only updates are allowed only when the duplicated product has exactly one variant."
    );
  }

  return [
    {
      id: currentVariants[0].id,
      price: formatMoneyValue(payload.basePrice),
      compareAtPrice: formatMoneyValue(payload.basePrice)
    }
  ];
}

async function fetchProductVariantState(config, productId) {
  const data = await shopifyGraphql(config, PRODUCT_VARIANT_STATE_QUERY, {
    id: productId
  });

  if (!data.product) {
    throw new Error(`Could not load duplicated product ${productId}.`);
  }

  return data.product;
}

async function duplicateProduct(config, payload) {
  const data = await shopifyGraphql(config, PRODUCT_DUPLICATE_MUTATION, {
    productId: payload.duplicateSourceProductId,
    newTitle: payload.title,
    newStatus: payload.status
  });

  ensureNoUserErrors(data.productDuplicate.userErrors, "productDuplicate");
  return data.productDuplicate.newProduct;
}

async function updateProductFields(config, productId, payload) {
  const productInput = {
    id: productId,
    title: payload.title,
    descriptionHtml: payload.descriptionHtml,
    vendor: payload.vendor,
    productType: payload.productType,
    tags: payload.tags,
    seo: payload.seo,
    status: payload.status,
    metafields: payload.metafields
  };

  if (payload.templateSuffix === null) {
    productInput.templateSuffix = "";
  } else if (payload.templateSuffix !== undefined) {
    productInput.templateSuffix = payload.templateSuffix;
  }

  const data = await shopifyGraphql(config, PRODUCT_UPDATE_MUTATION, {
    product: productInput
  });

  ensureNoUserErrors(data.productUpdate.userErrors, "productUpdate");
  return data.productUpdate.product;
}

async function updateVariantPrices(config, productId, payload) {
  const product = await fetchProductVariantState(config, productId);
  const updates = buildVariantUpdates(product.variants.nodes, payload);

  if (!updates.length) {
    return {
      skipped: true,
      reason: "No variant price updates were required.",
      product
    };
  }

  const data = await shopifyGraphql(
    config,
    PRODUCT_VARIANTS_BULK_UPDATE_MUTATION,
    {
      productId,
      variants: updates
    }
  );

  ensureNoUserErrors(
    data.productVariantsBulkUpdate.userErrors,
    "productVariantsBulkUpdate"
  );

  return {
    skipped: false,
    updatedVariants: data.productVariantsBulkUpdate.productVariants,
    product
  };
}

async function createStagedUploadTarget(config, mediaItem) {
  const bytes = await readFile(mediaItem.sourcePath);
  const data = await shopifyGraphql(config, STAGED_UPLOADS_CREATE_MUTATION, {
    input: [
      {
        filename: mediaItem.filename,
        mimeType: mediaItem.mimeType,
        resource: "IMAGE",
        httpMethod: "POST"
      }
    ]
  });

  ensureNoUserErrors(
    data.stagedUploadsCreate.userErrors,
    "stagedUploadsCreate"
  );

  const target = data.stagedUploadsCreate.stagedTargets?.[0];
  if (!target?.url || !target?.resourceUrl) {
    throw new Error("stagedUploadsCreate did not return a valid staged target.");
  }

  const form = new FormData();
  for (const parameter of target.parameters ?? []) {
    form.append(parameter.name, parameter.value);
  }

  form.append(
    "file",
    new File([bytes], mediaItem.filename, { type: mediaItem.mimeType })
  );

  const uploadResponse = await fetch(target.url, {
    method: "POST",
    body: form
  });

  if (!uploadResponse.ok) {
    throw new Error(
      `Shopify staged upload failed with ${uploadResponse.status}: ${await uploadResponse.text()}`
    );
  }

  return target.resourceUrl;
}

async function uploadProductMedia(config, productId, payload) {
  if (!payload.media?.length) {
    return {
      skipped: true,
      reason: "No media were provided for upload."
    };
  }

  try {
    const mediaInputs = [];

    for (const mediaItem of payload.media) {
      const originalSource = await createStagedUploadTarget(config, mediaItem);
      mediaInputs.push({
        alt: mediaItem.alt,
        mediaContentType: "IMAGE",
        originalSource
      });
    }

    const data = await shopifyGraphql(
      config,
      PRODUCT_CREATE_MEDIA_MUTATION,
      {
        productId,
        media: mediaInputs
      }
    );

    ensureNoMediaUserErrors(
      data.productCreateMedia.mediaUserErrors,
      "productCreateMedia"
    );

    return {
      skipped: false,
      media: data.productCreateMedia.media
    };
  } catch (error) {
    const message = String(error.message ?? error);
    if (message.includes("write_files") || message.includes("ACCESS_DENIED")) {
      return {
        skipped: true,
        reason: `Media upload skipped: ${message}`
      };
    }

    throw error;
  }
}

async function replaceExistingProductMedia(config, productId, payload) {
  if (!payload.media?.length) {
    throw new Error("Replacing existing media requires at least one selected image.");
  }

  if (payload.existingMediaIds?.length) {
    const data = await shopifyGraphql(config, PRODUCT_DELETE_MEDIA_MUTATION, {
      productId,
      mediaIds: payload.existingMediaIds
    });

    ensureNoMediaUserErrors(
      data.productDeleteMedia.mediaUserErrors,
      "productDeleteMedia"
    );
  }

  return uploadProductMedia(config, productId, payload);
}

async function setInventoryQuantities(config, productId, payload) {
  const product = await fetchProductVariantState(config, productId);
  const trackedInventoryItems = product.variants.nodes
    .filter((variant) => variant.inventoryItem?.tracked)
    .map((variant) => ({
      inventoryItemId: variant.inventoryItem.id,
      locationId: config.locationId,
      quantity: payload.inventoryTarget,
      changeFromQuantity: null
    }));

  if (!trackedInventoryItems.length) {
    return {
      skipped: true,
      reason: "No tracked inventory items were found on the duplicated product."
    };
  }

  if (!config.locationId) {
    return {
      skipped: true,
      reason:
        "Inventory update skipped because SHOPIFY_LOCATION_ID is not configured."
    };
  }

  try {
    const data = await shopifyGraphql(config, INVENTORY_SET_QUANTITIES_MUTATION, {
      input: {
        name: "available",
        reason: "correction",
        ignoreCompareQuantity: true,
        referenceDocumentUri: `gid://ff-product/DraftProduct/${productId.split("/").pop()}`,
        quantities: trackedInventoryItems
      },
      idempotencyKey: randomUUID()
    });

    ensureNoUserErrors(
      data.inventorySetQuantities.userErrors,
      "inventorySetQuantities"
    );

    return {
      skipped: false,
      inventoryAdjustmentGroup: data.inventorySetQuantities.inventoryAdjustmentGroup
    };
  } catch (error) {
    const message = String(error.message ?? error);
    if (
      message.includes("write_inventory") ||
      message.includes("read_inventory") ||
      message.includes("read_locations") ||
      message.includes("ACCESS_DENIED")
    ) {
      return {
        skipped: true,
        reason: `Inventory update skipped: ${message}`
      };
    }

    throw error;
  }
}

export function normalizeDraftInput(payload) {
  if (!payload?.title) {
    throw new Error("Draft product input requires a title.");
  }

  const writeAction = payload.writeAction ?? "create-draft";
  const profile = payload.kind ? resolveProductProfile(payload.kind) : null;
  const heightCm = Number.isInteger(payload.heightCm) ? payload.heightCm : null;
  const widthCm = Number.isInteger(payload.widthCm) ? payload.widthCm : null;
  const generatedMetafields = profile
    ? buildWorkflowMetafields({
        kind: profile.kind,
        heightCm,
        widthCm
      })
    : [];
  const generatedDescriptionMetafield = buildDescriptionMetafield(
    payload.descriptionHtml
  );
  const providedMetafields = Array.isArray(payload.metafields) ? payload.metafields : [];
  const generatedNewBadgeMetafield =
    writeAction === "create-draft"
      ? buildCustomBadgesMetafield(providedMetafields, "NEW")
      : null;
  const metafields = mergeMetafields([
    ...generatedMetafields,
    ...(generatedDescriptionMetafield ? [generatedDescriptionMetafield] : []),
    ...providedMetafields,
    ...(generatedNewBadgeMetafield ? [generatedNewBadgeMetafield] : [])
  ]);
  const rawBasePrice =
    payload.price ?? payload.basePrice ?? null;
  const basePrice =
    rawBasePrice === null || rawBasePrice === undefined || rawBasePrice === ""
      ? null
      : Number(rawBasePrice);

  if (basePrice !== null && Number.isNaN(basePrice)) {
    throw new Error("Draft product input price must be numeric.");
  }

  return {
    mode: payload.mode ?? "new",
    writeAction,
    replaceExistingMedia: Boolean(payload.replaceExistingMedia),
    existingProductId: payload.existingProductId ?? null,
    existingProductHandle: payload.existingProductHandle ?? null,
    existingMediaIds: Array.isArray(payload.existingMediaIds)
      ? payload.existingMediaIds.map((value) => String(value ?? "").trim()).filter(Boolean)
      : [],
    title: payload.title,
    descriptionHtml: payload.descriptionHtml ?? "",
    vendor: payload.vendor ?? "FOREVER FLOWERS",
    productType: payload.productType ?? profile?.productType ?? "",
    tags: mergeTags(payload.tags ?? []),
    templateSuffix:
      payload.templateSuffix !== undefined
        ? payload.templateSuffix
        : (profile?.templateSuffix ?? null),
    seo: payload.seo ?? null,
    status: payload.status ?? "DRAFT",
    metafields,
    inventoryTarget: payload.inventoryTarget ?? profile?.inventoryTarget ?? 20,
    media: normalizeProductMedia(payload.media, payload),
    duplicateSourceProductId:
      payload.duplicateSourceProductId ?? profile?.duplicateSourceProductId ?? null,
    basePrice,
    variantPricingPlan:
      payload.variantPricingPlan ??
      (profile?.kind === "arrangement" && basePrice !== null
        ? [
            {
              title: "עם אגרטל (שקוף)",
              price: basePrice,
              inventoryTarget: payload.inventoryTarget ?? profile.inventoryTarget
            },
            {
              title: "ללא אגרטל",
              price: basePrice - 20,
              inventoryTarget: payload.inventoryTarget ?? profile.inventoryTarget
            }
          ]
      : null)
  };
}

function normalizeExistingProductReference(reference) {
  const value = String(reference ?? "").trim();
  if (!value) {
    throw new Error("Existing product reference is required.");
  }

  if (value.startsWith("gid://shopify/Product/")) {
    return {
      type: "gid",
      id: value
    };
  }

  if (/^\d+$/.test(value)) {
    return {
      type: "gid",
      id: `gid://shopify/Product/${value}`
    };
  }

  return {
    type: "handle",
    handle: value
  };
}

export async function fetchProductByReference(config, reference) {
  const normalized = normalizeExistingProductReference(reference);

  if (normalized.type === "gid") {
    const data = await shopifyGraphql(config, PRODUCT_BY_ID_QUERY, {
      id: normalized.id
    });

    if (!data.product) {
      throw new Error(`No Shopify product found for ${reference}.`);
    }

    return data.product;
  }

  const data = await shopifyGraphql(config, PRODUCT_BY_HANDLE_QUERY, {
    first: 1,
    query: `handle:${normalized.handle}`
  });

  const product = data.products?.nodes?.[0];
  if (!product) {
    throw new Error(`No Shopify product found for ${reference}.`);
  }

  return product;
}

export async function fetchActiveProductsByCollectionHandles(config, handles) {
  const normalizedHandles = [...new Set(
    (handles ?? [])
      .map((handle) => String(handle ?? "").trim().replace(/^\/+|\/+$/g, ""))
      .filter(Boolean)
  )];

  if (!normalizedHandles.length) {
    throw new Error("Enter at least one collection handle.");
  }

  const collections = [];
  const productsById = new Map();

  for (const handle of normalizedHandles) {
    let after = null;
    let collectionSummary = null;
    let totalProducts = 0;
    let activeProducts = 0;

    for (let page = 0; page < 20; page += 1) {
      const data = await shopifyGraphql(config, COLLECTION_PRODUCTS_BY_HANDLE_QUERY, {
        handle,
        first: 100,
        after
      });

      const collection = data.collectionByHandle;
      if (!collection) {
        throw new Error(`No Shopify collection found for handle "${handle}".`);
      }

      collectionSummary ??= {
        id: collection.id,
        title: collection.title,
        handle: collection.handle
      };

      const connection = collection.products;
      for (const product of connection.nodes ?? []) {
        totalProducts += 1;
        if (product.status !== "ACTIVE") {
          continue;
        }

        activeProducts += 1;
        const existing = productsById.get(product.id);
        productsById.set(product.id, {
          ...product,
          collectionHandles: [
            ...new Set([...(existing?.collectionHandles ?? []), collection.handle])
          ]
        });
      }

      if (!connection.pageInfo?.hasNextPage || !connection.pageInfo?.endCursor) {
        break;
      }

      after = connection.pageInfo.endCursor;
    }

    collections.push({
      ...collectionSummary,
      totalProducts,
      activeProducts
    });
  }

  return {
    collections,
    products: [...productsById.values()].sort((left, right) =>
      String(left.title ?? "").localeCompare(String(right.title ?? ""), "he")
    )
  };
}

export async function fetchAdminProductSample(config, first = 5) {
  const data = await shopifyGraphql(config, PRODUCT_SAMPLE_QUERY, { first });
  return data.products.nodes;
}

export async function analyzeAdminProducts(config, first = 50) {
  const data = await shopifyGraphql(config, PRODUCT_ANALYSIS_QUERY, { first });
  const products = data.products.nodes;
  const relevantProducts = products.filter((product) => isWorkflowProduct(product));
  const excludedProducts = products.filter((product) => !isWorkflowProduct(product));

  return {
    analyzedAt: new Date().toISOString(),
    sampleSize: products.length,
    workflowRelevantProductTypes: listRelevantProductTypes(),
    relevantSampleSize: relevantProducts.length,
    statusDistribution: countValues(products.map((product) => product.status)),
    vendorDistribution: countValues(products.map((product) => product.vendor)),
    productTypeDistribution: countValues(
      products.map((product) => product.productType)
    ),
    relevantProductTypeDistribution: countValues(
      relevantProducts.map((product) => product.productType)
    ),
    excludedProductTypeDistribution: countValues(
      excludedProducts.map((product) => product.productType)
    ),
    templateSuffix: summarizeTemplateSuffix(products),
    relevantTemplateSuffix: summarizeTemplateSuffix(relevantProducts),
    optionNameDistribution: countValues(
      products.flatMap((product) =>
        (product.options ?? []).map((option) => option.name)
      )
    ),
    relevantOptionNameDistribution: countValues(
      relevantProducts.flatMap((product) =>
        (product.options ?? []).map((option) => option.name)
      )
    ),
    tagFrequency: countValues(
      products.flatMap((product) => product.tags ?? [])
    ).slice(0, 30),
    relevantTagFrequency: countValues(
      relevantProducts.flatMap((product) => product.tags ?? [])
    ).slice(0, 30),
    products: products.map((product) => ({
      id: product.id,
      title: product.title,
      handle: product.handle,
      status: product.status,
      vendor: product.vendor,
      productType: product.productType,
      templateSuffix: product.templateSuffix ?? "default",
      hasOnlyDefaultVariant: product.hasOnlyDefaultVariant,
      tracksInventory: product.tracksInventory,
      totalInventory: product.totalInventory,
      tagCount: product.tags?.length ?? 0,
      optionNames: (product.options ?? []).map((option) => option.name),
      optionValueCounts: (product.options ?? []).map((option) => ({
        name: option.name,
        count: option.optionValues?.length ?? 0
      })),
      mediaTypes: (product.media?.nodes ?? []).map(
        (media) => media.mediaContentType
      ),
      variantSample: (product.variants?.nodes ?? []).map((variant) => ({
        title: variant.title,
        sku: variant.sku,
        price: variant.price,
        compareAtPrice: variant.compareAtPrice,
        inventoryPolicy: variant.inventoryPolicy
      })),
      seo: product.seo
    }))
  };
}

export async function fetchWorkflowNamingContext(config) {
  const collected = [];
  let after = null;

  for (let page = 0; page < 10; page += 1) {
    const data = await shopifyGraphql(config, PRODUCT_NAMING_CONTEXT_QUERY, {
      first: 100,
      after
    });

    const connection = data.products;
    const relevantNodes = (connection.nodes ?? []).filter((product) =>
      isWorkflowProduct(product)
    );
    collected.push(...relevantNodes);

    if (!connection.pageInfo?.hasNextPage || !connection.pageInfo?.endCursor) {
      break;
    }

    after = connection.pageInfo.endCursor;
  }

  const seenStems = new Set();
  const entries = collected
    .map((product) => ({
      id: product.id,
      title: product.title,
      handle: product.handle,
      productType: product.productType,
      status: product.status,
      stem: extractTitleStem(product.title)
    }))
    .filter((entry) => entry.stem);

  const inspirationTitles = [];
  for (const entry of entries) {
    if (seenStems.has(entry.stem)) {
      continue;
    }

    seenStems.add(entry.stem);
    inspirationTitles.push(entry.title);
  }

  return {
    entries,
    blockedStems: [...seenStems].sort((left, right) =>
      left.localeCompare(right, "he")
    ),
    inspirationTitles: inspirationTitles.slice(0, 60)
  };
}

export async function createDraftProduct(config, payload) {
  const product = normalizeDraftInput(payload);

  if (!product.duplicateSourceProductId) {
    throw new Error("Draft product input requires a duplicateSourceProductId.");
  }

  const duplicatedProduct = await duplicateProduct(config, product);
  const updatedProduct = await updateProductFields(
    config,
    duplicatedProduct.id,
    product
  );
  const variantUpdate = await updateVariantPrices(
    config,
    duplicatedProduct.id,
    product
  );
  const inventoryUpdate = await setInventoryQuantities(
    config,
    duplicatedProduct.id,
    product
  );
  const mediaUpload = await uploadProductMedia(
    config,
    duplicatedProduct.id,
    product
  );

  return {
    mode: "new",
    duplicateSourceProductId: product.duplicateSourceProductId,
    duplicatedProduct,
    updatedProduct,
    variantUpdate,
    inventoryUpdate,
    mediaUpload
  };
}

export async function appendToExistingProduct(config, payload) {
  const product = normalizeDraftInput(payload);

  if (!product.existingProductId) {
    throw new Error("Existing append input requires an existingProductId.");
  }

  const updatedProduct = await updateProductFields(
    config,
    product.existingProductId,
    product
  );
  const variantUpdate = await updateVariantPrices(
    config,
    product.existingProductId,
    product
  );
  const inventoryUpdate = await setInventoryQuantities(
    config,
    product.existingProductId,
    product
  );
  const mediaUpload = product.replaceExistingMedia
    ? await replaceExistingProductMedia(
        config,
        product.existingProductId,
        product
      )
    : await uploadProductMedia(
        config,
        product.existingProductId,
        product
      );

  return {
    mode: "existing-append",
    writeAction: product.writeAction,
    existingProductId: product.existingProductId,
    updatedProduct,
    variantUpdate,
    inventoryUpdate,
    mediaUpload
  };
}

export async function appendImagesToExistingProduct(config, payload) {
  if (!payload.existingProductId) {
    throw new Error("Image append input requires an existingProductId.");
  }

  const currentProduct = await fetchProductByReference(
    config,
    payload.existingProductId
  );
  if (currentProduct.status !== "ACTIVE") {
    throw new Error(
      `Image append is allowed only for ACTIVE products. ${currentProduct.handle} is ${currentProduct.status}.`
    );
  }

  const media = normalizeProductMedia(payload.media, {
    ...payload,
    title: payload.title ?? currentProduct.title
  });
  if (!media.length) {
    throw new Error("Image append requires at least one selected image.");
  }

  const mediaUpload = await uploadProductMedia(
    config,
    payload.existingProductId,
    {
      media
    }
  );

  return {
    mode: "existing-image-append",
    existingProductId: payload.existingProductId,
    existingProductHandle: currentProduct.handle,
    mediaUpload
  };
}

export async function duplicateExistingProductAndRebuild(config, payload) {
  const product = normalizeDraftInput(payload);

  if (!product.existingProductId) {
    throw new Error("Existing duplicate input requires an existingProductId.");
  }

  const duplicatedProduct = await duplicateProduct(config, {
    duplicateSourceProductId: product.existingProductId,
    title: product.title,
    status: "DRAFT"
  });
  const rebuiltProduct = await updateProductFields(
    config,
    duplicatedProduct.id,
    {
      ...product,
      title: product.title,
      status: "DRAFT"
    }
  );
  const variantUpdate = await updateVariantPrices(
    config,
    duplicatedProduct.id,
    product
  );
  const inventoryUpdate = await setInventoryQuantities(
    config,
    duplicatedProduct.id,
    product
  );
  const mediaUpload = await uploadProductMedia(
    config,
    duplicatedProduct.id,
    product
  );

  return {
    mode: "existing-duplicate",
    existingProductId: product.existingProductId,
    duplicatedProduct,
    rebuiltProduct,
    variantUpdate,
    inventoryUpdate,
    mediaUpload
  };
}

export async function executeProductWorkflow(config, payload) {
  const mode = payload.mode ?? "new";

  if (mode === "new") {
    return createDraftProduct(config, payload);
  }

  if (mode === "existing-append") {
    return appendToExistingProduct(config, payload);
  }

  if (mode === "existing-duplicate") {
    return duplicateExistingProductAndRebuild(config, payload);
  }

  if (mode === "existing-image-append") {
    return appendImagesToExistingProduct(config, payload);
  }

  throw new Error(`Unknown workflow mode "${mode}".`);
}
