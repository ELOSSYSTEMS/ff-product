import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import express from "express";
import multer from "multer";

import { getConfig } from "./config.mjs";
import {
  buildImageRetryPrompt,
  generateCopyPlan,
  saveGeneratedImage,
} from "./openai-client.mjs";
import {
  generateGeminiDerivedImage,
  validateGeminiDerivedImage
} from "./gemini-client.mjs";
import {
  executeProductWorkflow,
  fetchActiveProductsByCollectionHandles,
  fetchProductByReference,
  fetchWorkflowNamingContext,
  normalizeDraftInput
} from "./shopify-client.mjs";
import { resolveProductProfile } from "./product-profile.mjs";
import { fetchWebsiteCopyContext } from "./storefront-catalog.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const publicDir = path.join(projectRoot, "public");
const generatedRoot = process.env.FF_PRODUCT_GENERATED_ROOT
  ? path.resolve(process.env.FF_PRODUCT_GENERATED_ROOT)
  : path.join(projectRoot, "generated");
const MAX_SOURCE_IMAGES = 6;
const MAX_IMAGE_GENERATION_ATTEMPTS = 3;
const MAX_BULK_PRODUCTS = 5;
const MAX_BULK_SIZE_GUIDE_PRODUCTS = 40;
const DEFAULT_COPY_PROVIDER = "openai";
const DEFAULT_IMAGE_PROVIDER = "gemini";
const IMAGE_PROVIDERS = new Set([DEFAULT_IMAGE_PROVIDER]);
const COPY_PROVIDERS = new Set([DEFAULT_COPY_PROVIDER]);
const IMAGE_RATIOS = new Set(["3:2", "1:1"]);
const NEW_PRODUCT_STATUSES = new Set(["DRAFT", "ACTIVE"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: MAX_SOURCE_IMAGES,
    fileSize: 50 * 1024 * 1024
  }
});

function makeSessionId() {
  const now = new Date();
  const compact = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const random = Math.random().toString(36).slice(2, 8);
  return `${compact}-${random}`;
}

async function ensureSessionFolders(sessionId) {
  const sessionDir = path.join(generatedRoot, sessionId);
  const uploadsDir = path.join(sessionDir, "uploads");
  const generatedDir = path.join(sessionDir, "generated");
  await mkdir(uploadsDir, { recursive: true });
  await mkdir(generatedDir, { recursive: true });
  return { sessionDir, uploadsDir, generatedDir };
}

async function ensureNestedFolders(baseDir, name) {
  const nestedDir = path.join(baseDir, name);
  await mkdir(nestedDir, { recursive: true });
  return nestedDir;
}

function parseBulkProductReferences(rawValue) {
  return String(rawValue ?? "")
    .split(/\r?\n|,/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseCollectionHandles(rawValue) {
  return String(rawValue ?? "")
    .split(/\r?\n|,/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      try {
        const parsed = new URL(value);
        const collectionMatch = parsed.pathname.match(/\/collections\/([^/?#]+)/i);
        if (collectionMatch?.[1]) {
          return decodeURIComponent(collectionMatch[1]).trim();
        }
      } catch {
        // Not a URL; treat as a raw collection handle.
      }

      return value
        .replace(/^https?:\/\/[^/]+\/collections\//i, "")
        .replace(/^\/+|\/+$/g, "")
        .split(/[/?#]/)[0]
        .trim();
    })
    .filter(Boolean);
}

function validateCoreInput(body, files) {
  const mode = String(body.mode ?? "new").trim().toLowerCase();
  const existingProductReference = String(
    body.existingProductReference ?? ""
  ).trim();
  const bulkExistingProductReferences = parseBulkProductReferences(
    body.bulkExistingProductReferences ?? ""
  );
  const bulkCollectionHandles = parseCollectionHandles(
    body.bulkCollectionHandles ?? ""
  );
  const kind = String(body.kind ?? "").trim().toLowerCase();
  const rawPrice = String(body.price ?? "").trim();
  const rawHeight = String(body.heightCm ?? "").trim();
  const rawWidth = String(body.widthCm ?? "").trim();
  const price = rawPrice === "" ? null : Number(rawPrice);
  const heightCm = rawHeight === "" ? null : Number(rawHeight);
  const widthCm = rawWidth === "" ? null : Number(rawWidth);
  const copyProviders =
    ["bulk-existing-image-append", "bulk-collection-size-guides"].includes(mode)
      ? []
      : [DEFAULT_COPY_PROVIDER];
  const imageProviders = [DEFAULT_IMAGE_PROVIDER];
  const imageRatio = String(body.imageRatio ?? "3:2").trim();
  const newProductStatus = String(body.newProductStatus ?? "DRAFT")
    .trim()
    .toUpperCase();

  if (
    ![
      "new",
      "existing-append",
      "existing-duplicate",
      "bulk-existing-duplicate",
      "bulk-existing-image-append",
      "bulk-collection-size-guides"
    ].includes(mode)
  ) {
    throw new Error(
      "mode must be 'new', 'existing-append', 'existing-duplicate', 'bulk-existing-duplicate', 'bulk-existing-image-append', or 'bulk-collection-size-guides'."
    );
  }

  if (copyProviders.some((provider) => !COPY_PROVIDERS.has(provider))) {
    throw new Error("Unsupported copy provider selected.");
  }

  if (imageProviders.some((provider) => !IMAGE_PROVIDERS.has(provider))) {
    throw new Error("Unsupported image provider selected.");
  }

  if (!IMAGE_RATIOS.has(imageRatio)) {
    throw new Error("imageRatio must be '3:2' or '1:1'.");
  }

  if (mode === "new" && !NEW_PRODUCT_STATUSES.has(newProductStatus)) {
    throw new Error("newProductStatus must be 'DRAFT' or 'ACTIVE'.");
  }

  if (mode === "new" && !["set", "arrangement"].includes(kind)) {
    throw new Error("kind must be 'set' or 'arrangement'.");
  }

  if (
    ["existing-append", "existing-duplicate"].includes(mode) &&
    !existingProductReference
  ) {
    throw new Error(
      "Existing product reference is required for existing-product modes."
    );
  }

  if (["bulk-existing-duplicate", "bulk-existing-image-append"].includes(mode)) {
    if (!bulkExistingProductReferences.length) {
      throw new Error("Enter between 1 and 5 existing product references for bulk mode.");
    }

    if (bulkExistingProductReferences.length > MAX_BULK_PRODUCTS) {
      throw new Error(`Bulk mode supports at most ${MAX_BULK_PRODUCTS} products per run.`);
    }
  }

  if (mode === "bulk-collection-size-guides") {
    if (!bulkCollectionHandles.length) {
      throw new Error("Enter one or two collection handles for bulk size-guide mode.");
    }

    if (bulkCollectionHandles.length > 2) {
      throw new Error("Bulk size-guide mode supports at most 2 collections per run.");
    }
  }

  if (
    mode === "new" &&
    (!files?.length || files.length < 1 || files.length > MAX_SOURCE_IMAGES)
  ) {
    throw new Error(`Upload between 1 and ${MAX_SOURCE_IMAGES} images.`);
  }

  if (mode === "new" && (price === null || Number.isNaN(price) || price <= 0)) {
    throw new Error("price must be a positive number.");
  }

  if (
    mode === "new" &&
    (!Number.isInteger(heightCm) || !Number.isInteger(widthCm))
  ) {
    throw new Error("heightCm and widthCm must be integers.");
  }

  return {
    mode,
    existingProductReference,
    bulkExistingProductReferences,
    bulkCollectionHandles,
    kind: kind || null,
    copyProviders: [...new Set(copyProviders)],
    imageProviders: [...new Set(imageProviders)],
    imageRatio,
    newProductStatus: mode === "new" ? newProductStatus : null,
    price,
    heightCm,
    widthCm,
    extraNotes: String(body.extraNotes ?? "").trim()
  };
}

async function generateImageWithProvider(config, provider, prompt, imageFiles, imageRatio) {
  if (provider === "gemini") {
    return generateGeminiDerivedImage(config, { prompt, imageFiles, imageRatio });
  }

  throw new Error(`Unsupported image provider "${provider}".`);
}

async function generateCopyWithProvider(config, provider, input) {
  if (provider === "openai") {
    return generateCopyPlan(config, input);
  }

  throw new Error(`Unsupported copy provider "${provider}".`);
}

function assertProviderConfig(config, { copyProviders, imageProviders }) {
  const allProviders = [...new Set([...(copyProviders ?? []), ...(imageProviders ?? [])])];

  if (allProviders.includes("openai") && !config.openAiApiKey) {
    throw new Error("Missing OPENAI_API_KEY in .env.");
  }

  if (allProviders.includes("gemini") && !config.geminiApiKey) {
    throw new Error("Missing GEMINI_API_KEY in .env.");
  }
}

function inferExtensionFromMimeType(mimeType) {
  if (mimeType === "image/png") {
    return ".png";
  }
  if (mimeType === "image/webp") {
    return ".webp";
  }
  if (mimeType === "image/gif") {
    return ".gif";
  }

  return ".jpg";
}

async function persistUploads(uploadsDir, files) {
  const persisted = [];
  const sessionId = path.basename(path.dirname(uploadsDir));

  for (const [index, file] of files.entries()) {
    const extension = path.extname(file.originalname || "") || ".jpg";
    const filename = `source-${index + 1}${extension}`;
    const fullPath = path.join(uploadsDir, filename);
    await writeFile(fullPath, file.buffer);
    persisted.push({
      filename,
      fullPath,
      path: fullPath,
      mimetype: file.mimetype,
      size: file.size,
      base64: file.buffer.toString("base64"),
      publicUrl: `/generated/${sessionId}/uploads/${filename}`
    });
  }

  return persisted;
}

async function persistExistingProductImages(
  uploadsDir,
  existingProduct,
  { maxImages = MAX_SOURCE_IMAGES } = {}
) {
  const mediaImages = (existingProduct.media?.nodes ?? [])
    .filter((node) => node?.mediaContentType === "IMAGE")
    .slice(0, maxImages);
  const persisted = [];
  const sessionId = path.basename(path.dirname(uploadsDir));

  for (const [index, media] of mediaImages.entries()) {
    const sourceUrl = media.originalSource?.url || media.image?.url;
    if (!sourceUrl) {
      continue;
    }

    const response = await fetch(sourceUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to download existing product image ${index + 1}: ${response.status}.`
      );
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    const mimeType =
      response.headers.get("content-type")?.split(";")[0].trim() || "image/jpeg";
    const extension = inferExtensionFromMimeType(mimeType);
    const filename = `source-existing-${index + 1}${extension}`;
    const fullPath = path.join(uploadsDir, filename);
    await writeFile(fullPath, bytes);
    persisted.push({
      filename,
      fullPath,
      path: fullPath,
      mimetype: mimeType,
      size: bytes.length,
      base64: bytes.toString("base64"),
      publicUrl: `/generated/${sessionId}/uploads/${filename}`
    });
  }

  if (!persisted.length) {
    throw new Error("Existing product does not have usable admin media images.");
  }

  return persisted;
}

function getExistingCustomMetafield(existingProduct, key) {
  return (
    existingProduct.metafields?.nodes?.find(
      (metafield) => metafield.namespace === "custom" && metafield.key === key
    )?.value ?? null
  );
}

function resolveKindFromExistingProduct(existingProduct) {
  if (existingProduct.productType === "סט מעוצב") {
    return "set";
  }

  if (existingProduct.productType === "סידור מעוצב") {
    return "arrangement";
  }

  throw new Error(
    `Could not infer kind from existing product type "${existingProduct.productType || ""}".`
  );
}

function hydrateInputFromExistingProduct(input, existingProduct) {
  const kind = resolveKindFromExistingProduct(existingProduct);
  const heightCm =
    input.heightCm ?? Number(getExistingCustomMetafield(existingProduct, "height"));
  const widthCm =
    input.widthCm ?? Number(getExistingCustomMetafield(existingProduct, "width"));

  if (!Number.isInteger(heightCm) || !Number.isInteger(widthCm)) {
    throw new Error(
      "Existing product is missing usable custom.height/custom.width metafields."
    );
  }

  return {
    ...input,
    kind,
    heightCm,
    widthCm,
    price: input.price,
    variantSizeOptions: extractVariantSizeOptions(existingProduct)
  };
}

function hydrateSizeGuideInputFromExistingProduct(input, existingProduct) {
  const heightCm = Number(getExistingCustomMetafield(existingProduct, "height"));
  const widthCm = Number(getExistingCustomMetafield(existingProduct, "width"));

  if (!Number.isInteger(heightCm) || !Number.isInteger(widthCm)) {
    throw new Error(
      "Existing product is missing usable custom.height/custom.width metafields."
    );
  }

  return {
    ...input,
    heightCm,
    widthCm,
    imageRatio: "1:1"
  };
}

function buildCopyInput({
  baseInput,
  hydratedInput,
  imageFiles,
  existingProduct,
  variantSizeOptions,
  namingContext,
  websiteContext
}) {
  return {
    ...baseInput,
    ...hydratedInput,
    variantSizeOptions,
    imageFiles,
    existingProduct,
    fixedTitle: existingProduct?.title ?? "",
    imageRatio: hydratedInput.imageRatio ?? baseInput.imageRatio ?? "3:2",
    namingContext,
    websiteContext
  };
}

async function generateCopyPlansForInput(config, providers, copyInput) {
  const copyPlans = {};
  for (const provider of providers) {
    copyPlans[provider] = await generateCopyWithProvider(config, provider, copyInput);
  }

  const selectedCopyProvider = copyPlans.openai
    ? "openai"
    : Object.keys(copyPlans)[0];

  return {
    copyPlans,
    selectedCopyProvider,
    copyPlan: copyPlans[selectedCopyProvider]
  };
}

async function generateImagesForPlan({
  config,
  providers,
  copyPlan,
  imageFiles,
  generatedDir,
  sessionId,
  filenamePrefix,
  imageRatio = "3:2",
  heightCm,
  widthCm
}) {
  const generatedImages = [];

  for (const provider of providers) {
    for (const directive of copyPlan.imageDirectives ?? []) {
      let validationIssues = [];
      let finalPrompt = directive.prompt;
      let saved = null;
      let lastBytes = null;
      let validationPassed = false;
      let validationWarning = "";

      for (
        let attempt = 0;
        attempt < MAX_IMAGE_GENERATION_ATTEMPTS;
        attempt += 1
      ) {
        finalPrompt =
          attempt === 0
            ? directive.prompt
            : buildImageRetryPrompt(directive.prompt, validationIssues, {
                slot: directive.slot,
                heightCm,
                widthCm
              });

        const bytes = await generateImageWithProvider(
          config,
          provider,
          finalPrompt,
          imageFiles,
          imageRatio
        );
        lastBytes = bytes;
        const validation = await validateGeminiDerivedImage(config, {
          slot: directive.slot,
          prompt: finalPrompt,
          imageFiles,
          generatedBytes: bytes,
          heightCm,
          widthCm
        });

        if (validation.passes) {
          saved = await saveGeneratedImage(
            generatedDir,
            `${filenamePrefix}-${provider}-${directive.slot}`,
            bytes
          );
          validationPassed = true;
          break;
        }

        validationIssues = validation.issues;
      }

      if (!saved) {
        if (!lastBytes) {
          throw new Error(
            `Could not generate a ${directive.slot} image with ${provider}.`
          );
        }

        saved = await saveGeneratedImage(
          generatedDir,
          `${filenamePrefix}-${provider}-${directive.slot}`,
          lastBytes
        );
        validationWarning =
          (validationIssues ?? []).join(" | ") ||
          "The automated image validator did not approve this image.";
      }

      const generatedSessionDir = path.join(generatedRoot, sessionId, "generated");
      const relativeGeneratedPath = path
        .relative(generatedSessionDir, saved.fullPath)
        .split(path.sep)
        .join("/");

      generatedImages.push({
        provider,
        slot: directive.slot,
        imageRatio,
        prompt: finalPrompt,
        validationPassed,
        approvedForUpload: validationPassed,
        validationWarning,
        url: `/generated/${sessionId}/generated/${relativeGeneratedPath}`
      });
    }
  }

  return generatedImages;
}

function buildImageAppendPayload(existingProduct) {
  return {
    mode: "existing-image-append",
    writeAction: "append-images-only",
    replaceExistingMedia: false,
    existingProductId: existingProduct.id,
    existingProductHandle: existingProduct.handle,
    expectedProductStatus: existingProduct.status,
    title: existingProduct.title,
    descriptionHtml: "",
    tags: existingProduct.tags ?? [],
    seo: existingProduct.seo ?? null,
    status: existingProduct.status
  };
}

function isIntegerDimension(value) {
  return Number.isInteger(value) && value > 0;
}

function buildCleanSizeGuidePrompt(baseRules, { heightCm, widthCm }) {
  if (!isIntegerDimension(heightCm) || !isIntegerDimension(widthCm)) {
    throw new Error(
      "Size-guide image generation requires exact integer heightCm and widthCm values."
    );
  }

  return [
    baseRules,
    "Create a size-guide PDP image as a clean catalog measurement graphic, not a lifestyle scale scene.",
    "Use a plain neutral wall or seamless light background and a simple plain tabletop or surface.",
    "Show the product centered and fully visible with generous clean space around it.",
    "Add only thin dark-gray technical measurement lines with small end ticks.",
    "Show exactly one vertical height guide and exactly one horizontal width guide.",
    `Use exactly the height label "height ${heightCm} cm" beside the vertical height guide.`,
    `Use exactly the width label "width ${widthCm} cm" beside the horizontal width guide.`,
    "Do not invent, round, swap, approximate, reinterpret, or add any other measurement values.",
    "Do not add physical rulers, measuring tapes, yardsticks, sticky notes, handwritten notes, acrylic blocks, plaques, cameras, books, hands, people, props, comparison objects, room clutter, or lifestyle decor.",
    "Do not use glass measurement blocks or real-world scale objects.",
    "If the product has true size variants, show the variants in the same clean measurement style; otherwise show only one centered product."
  ].join(" ");
}

function buildMobileFirstHebrewSizeGuidePrompt({ title, heightCm, widthCm, extraNotes }) {
  if (!isIntegerDimension(heightCm) || !isIntegerDimension(widthCm)) {
    throw new Error(
      "Mobile size-guide image generation requires exact integer heightCm and widthCm values."
    );
  }

  return [
    `Create a new mobile-first product size guide image for "${title}" based on the existing Forever Flowers product images.`,
    "Output requirements:",
    "- Square canvas: 1600x1600 px.",
    "- The entire image must be visible and readable inside a Shopify mobile PDP gallery without zooming.",
    "- Keep all important content inside a central safe area with at least 160 px margin on every side.",
    "- Use a clean warm off-white / beige background.",
    "- Keep the product centered and fully visible.",
    "- Preserve the product appearance as accurately as possible.",
    "- Preserve the exact bouquet, vase, flower count, colors, proportions, and arrangement identity.",
    "- All bouquets are dried or preserved arrangements, never fresh flowers in water.",
    "- Do not generate water, liquid, waterlines, condensation, bubbles, submerged stems, or wet stems inside any vase, including clear glass vases.",
    "- Make the bouquet/vase large, about 55-65% of the canvas height.",
    "- Use elegant, minimal typography.",
    "- Use large, readable Hebrew labels only:",
    `  - גובה ${heightCm} ס״מ`,
    `  - רוחב ${widthCm} ס״מ`,
    "- The numbers and labels must be readable on a mobile screen without zoom.",
    "- Do not add small text.",
    "- Do not place labels, arrows, or product parts near the image edges.",
    "- Do not crop anything.",
    "- Do not change the product colors or shape.",
    "- Do not add extra decorations.",
    "- Make it look premium, clean, and suitable for Forever Flowers PDP product gallery.",
    "Measurement arrow rules:",
    "- The arrows must measure the actual visible product dimensions, not the canvas.",
    "- The vertical height arrow must always be on the LEFT side of the product.",
    "- The horizontal width arrow must always be on the BOTTOM of the product.",
    "- Keep this layout uniform across all products: height on the left, width on the bottom.",
    "- The vertical height arrow should start at the lowest visible point of the vase/base and end at the highest visible flower/branch.",
    "- The horizontal width arrow should start at the leftmost visible edge of the arrangement and end at the rightmost visible edge of the arrangement.",
    "- Do not create full-length ruler lines along the side or bottom of the image.",
    "- The arrows should sit close to the product, with small gaps, so it is visually clear what they are measuring.",
    "- Arrow endpoints must align with the product edges they measure.",
    "Use these exact dimensions:",
    `- Height: ${heightCm} ס״מ`,
    `- Width: ${widthCm} ס״מ`,
    extraNotes ? `Operator notes: ${extraNotes}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function buildMobileSizeGuideOnlyPlan(existingProduct, input) {
  return {
    title: existingProduct.title || existingProduct.handle || "the product",
    descriptionHtml: "",
    seoTitle: "",
    seoDescription: "",
    tags: [],
    imageDirectives: [
      {
        slot: "mobile-size-guide",
        prompt: buildMobileFirstHebrewSizeGuidePrompt({
          title: existingProduct.title || existingProduct.handle || "the product",
          heightCm: input.heightCm,
          widthCm: input.widthCm,
          extraNotes: input.extraNotes
        })
      }
    ]
  };
}

function buildImageAppendImagePlan(existingProduct, input) {
  const title = existingProduct.title || existingProduct.handle || "the product";
  const dimensions =
    Number.isInteger(input.heightCm) && Number.isInteger(input.widthCm)
      ? `Known product dimensions: height ${input.heightCm} cm, width ${input.widthCm} cm.`
      : "";
  const extraNotes = input.extraNotes
    ? `Operator notes: ${input.extraNotes}`
    : "";
  const baseRules = [
    `Use the provided Shopify Admin images of "${title}" as the exact source of truth.`,
    input.imageRatio === "1:1"
      ? "Compose the final image as a square 1:1 frame."
      : "Compose the final image as a 3:2 landscape frame.",
    "Preserve the exact bouquet, vase, flower count, colors, proportions, and arrangement identity.",
    "All bouquets are dried or preserved arrangements, never fresh flowers in water.",
    "Do not generate water, liquid, waterlines, condensation, bubbles, submerged stems, or wet stems inside any vase, including clear glass vases.",
    "If a clear vase is visible, show dry stems and any source-matching dry filler only, with no water.",
    "Do not create copy, labels, sale graphics, packaging, text overlays, or new product details.",
    "Only change staging, crop, lighting, background, room context, and camera distance.",
    dimensions,
    extraNotes
  ]
    .filter(Boolean)
    .join(" ");

  return {
    title,
    descriptionHtml: "",
    seoTitle: "",
    seoDescription: "",
    tags: [],
    imageDirectives: [
      {
        slot: "studio",
        prompt: `${baseRules} Create a clean studio PDP image with the product centered, full product visible, natural shadow, and a refined neutral background.`
      },
      {
        slot: "zoomed",
        prompt: `${baseRules} Create a close-up detail PDP image that moves closer to show flower texture and craftsmanship while keeping the product identity unmistakable.`
      },
      {
        slot: "size-guide",
        prompt: buildCleanSizeGuidePrompt(baseRules, {
          heightCm: input.heightCm,
          widthCm: input.widthCm
        })
      },
      {
        slot: "in-home-1",
        prompt: `${baseRules} Create a natural in-home lifestyle PDP image with the product centered on a console, dining table, or kitchen island in a lived-in home setting.`
      },
      {
        slot: "in-home-2",
        prompt: `${baseRules} Create a second distinct natural in-home lifestyle PDP image in a different room angle or surface context, with the product centered and clearly visible.`
      }
    ]
  };
}

function extractVariantSizeOptions(product) {
  return [...new Set(
    (product?.variants?.nodes ?? [])
      .map((variant) => String(variant?.title ?? "").trim())
      .filter((title) => title && title.toLowerCase() !== "default title")
  )];
}

async function generateBulkExistingImageAppendBatch({ config, input, sessionId, folders }) {
  const namingContext =
    config.clientId && config.clientSecret
      ? await fetchWorkflowNamingContext(config)
      : { blockedStems: [], inspirationTitles: [] };
  const websiteContext = await fetchWebsiteCopyContext({
    storeDomain: config.storeDomain,
    storefrontOrigin: config.storefrontOrigin
  });
  const items = [];

  for (const [index, reference] of input.bulkExistingProductReferences.entries()) {
    const itemKey = `${index + 1}-${slugifyValue(reference)}`;

    try {
      const existingProduct = await fetchProductByReference(config, reference);
      if (existingProduct.status !== "ACTIVE") {
        throw new Error(
          `Product ${existingProduct.handle} is ${existingProduct.status}; image append is allowed only for ACTIVE products.`
        );
      }

      const hydratedInput = hydrateInputFromExistingProduct(input, existingProduct);
      const variantSizeOptions = await resolveVariantSizeOptions(
        config,
        hydratedInput,
        existingProduct
      );
      const itemUploadsDir = await ensureNestedFolders(
        folders.uploadsDir,
        itemKey
      );
      const itemGeneratedDir = await ensureNestedFolders(
        folders.generatedDir,
        itemKey
      );
      const imageFiles = await persistExistingProductImages(
        itemUploadsDir,
        existingProduct
      );
      const copyPlan = buildImageAppendImagePlan(existingProduct, hydratedInput);
      const generatedImages = await generateImagesForPlan({
        config,
        providers: input.imageProviders,
        copyPlan,
        imageFiles,
        generatedDir: itemGeneratedDir,
        sessionId,
        filenamePrefix: itemKey,
        imageRatio: input.imageRatio,
        heightCm: hydratedInput.heightCm,
        widthCm: hydratedInput.widthCm
      });

      items.push({
        itemKey,
        reference,
        existingProduct,
        copyPlans: {},
        selectedCopyProvider: "",
        generatedImages,
        draftPayload: buildImageAppendPayload(existingProduct)
      });
    } catch (error) {
      items.push({
        itemKey,
        reference,
        error: error.message
      });
    }
  }

  return {
    mode: "bulk-existing-image-append",
    batchItems: items,
    summary: {
      mode: "bulk-existing-image-append",
      requested: input.bulkExistingProductReferences.length,
      generated: items.filter((item) => !item.error).length,
      failed: items.filter((item) => item.error).length
    }
  };
}

async function generateBulkCollectionSizeGuidesBatch({ config, input, sessionId, folders }) {
  const discovery = await fetchActiveProductsByCollectionHandles(
    config,
    input.bulkCollectionHandles
  );
  const discoveredProducts = discovery.products ?? [];

  if (!discoveredProducts.length) {
    throw new Error("No active products found in the selected collections.");
  }

  if (discoveredProducts.length > MAX_BULK_SIZE_GUIDE_PRODUCTS) {
    throw new Error(
      `Bulk size-guide mode found ${discoveredProducts.length} active products; limit is ${MAX_BULK_SIZE_GUIDE_PRODUCTS} per run.`
    );
  }

  const items = [];

  for (const [index, existingProduct] of discoveredProducts.entries()) {
    const itemKey = `${index + 1}-${slugifyValue(existingProduct.handle || existingProduct.id)}`;

    try {
      const hydratedInput = hydrateSizeGuideInputFromExistingProduct(input, existingProduct);
      const itemUploadsDir = await ensureNestedFolders(
        folders.uploadsDir,
        itemKey
      );
      const itemGeneratedDir = await ensureNestedFolders(
        folders.generatedDir,
        itemKey
      );
      const imageFiles = await persistExistingProductImages(
        itemUploadsDir,
        existingProduct,
        { maxImages: 1 }
      );
      const copyPlan = buildMobileSizeGuideOnlyPlan(existingProduct, hydratedInput);
      const generatedImages = await generateImagesForPlan({
        config,
        providers: input.imageProviders,
        copyPlan,
        imageFiles,
        generatedDir: itemGeneratedDir,
        sessionId,
        filenamePrefix: itemKey,
        imageRatio: "1:1",
        heightCm: hydratedInput.heightCm,
        widthCm: hydratedInput.widthCm
      });

      items.push({
        itemKey,
        reference: existingProduct.handle,
        existingProduct,
        copyPlans: {},
        selectedCopyProvider: "",
        generatedImages,
        draftPayload: {
          mode: "bulk-collection-size-guides",
          writeAction: "review-only",
          existingProductId: existingProduct.id,
          existingProductHandle: existingProduct.handle,
          title: existingProduct.title,
          heightCm: hydratedInput.heightCm,
          widthCm: hydratedInput.widthCm,
          media: []
        }
      });
    } catch (error) {
      items.push({
        itemKey,
        reference: existingProduct.handle || existingProduct.id,
        existingProduct: {
          id: existingProduct.id,
          title: existingProduct.title,
          handle: existingProduct.handle,
          status: existingProduct.status
        },
        error: error.message
      });
    }
  }

  return {
    mode: "bulk-collection-size-guides",
    batchItems: items,
    summary: {
      mode: "bulk-collection-size-guides",
      collections: discovery.collections,
      requestedCollections: input.bulkCollectionHandles,
      discoveredActiveProducts: discoveredProducts.length,
      generated: items.filter((item) => !item.error).length,
      failed: items.filter((item) => item.error).length,
      note: "Review-only. No Shopify media upload is performed by this mode."
    }
  };
}

async function resolveVariantSizeOptions(config, input, existingProduct) {
  if (existingProduct) {
    return extractVariantSizeOptions(existingProduct);
  }

  if (input.mode !== "new" || !input.kind) {
    return [];
  }

  const profile = resolveProductProfile(input.kind);
  const sourceProduct = await fetchProductByReference(
    config,
    profile.duplicateSourceProductId
  );

  return extractVariantSizeOptions(sourceProduct);
}

function buildDraftPayload(input, copyPlan) {
  const normalizedMode =
    input.mode === "bulk-existing-duplicate" ? "existing-duplicate" : input.mode;

  return normalizeDraftInput({
    mode: normalizedMode,
    writeAction: normalizedMode === "existing-append" ? "overwrite-existing" : "create-draft",
    replaceExistingMedia: false,
    existingProductId: input.existingProduct?.id ?? null,
    existingProductHandle: input.existingProduct?.handle ?? null,
    existingMediaIds: (input.existingProduct?.media?.nodes ?? [])
      .map((media) => media?.id)
      .filter(Boolean),
    kind: input.kind,
    title: copyPlan.title,
    descriptionHtml: copyPlan.descriptionHtml,
    tags: input.existingProduct?.tags?.length
      ? [...new Set([...(input.existingProduct.tags ?? []), ...(copyPlan.tags ?? [])])]
      : (copyPlan.tags ?? []),
    seo: {
      title: copyPlan.seoTitle,
      description: copyPlan.seoDescription
    },
    price: input.price,
    heightCm: input.heightCm,
    widthCm: input.widthCm,
    status: normalizedMode === "existing-append"
      ? input.existingProduct?.status ?? "DRAFT"
      : normalizedMode === "new"
      ? input.newProductStatus ?? "DRAFT"
      : "DRAFT"
  });
}

async function generateSinglePackage({ config, input, files, sessionId, folders }) {
  const existingProduct =
    input.mode === "new"
      ? null
      : await fetchProductByReference(config, input.existingProductReference);
  const hydratedInput = existingProduct
    ? hydrateInputFromExistingProduct(input, existingProduct)
    : input;
  const variantSizeOptions = await resolveVariantSizeOptions(
    config,
    hydratedInput,
    existingProduct
  );
  const imageFiles =
    files?.length
      ? await persistUploads(folders.uploadsDir, files)
      : existingProduct
        ? await persistExistingProductImages(folders.uploadsDir, existingProduct)
        : await persistUploads(folders.uploadsDir, files);
  const namingContext =
    config.clientId && config.clientSecret
      ? await fetchWorkflowNamingContext(config)
      : { blockedStems: [], inspirationTitles: [] };
  const websiteContext = await fetchWebsiteCopyContext({
    storeDomain: config.storeDomain,
    storefrontOrigin: config.storefrontOrigin
  });
  const copyInput = buildCopyInput({
    baseInput: input,
    hydratedInput,
    imageFiles,
    existingProduct,
    variantSizeOptions,
    namingContext,
    websiteContext
  });
  const { copyPlans, selectedCopyProvider, copyPlan } =
    await generateCopyPlansForInput(config, input.copyProviders, copyInput);
  const generatedImages = await generateImagesForPlan({
    config,
    providers: input.imageProviders,
    copyPlan,
    imageFiles,
    generatedDir: folders.generatedDir,
    sessionId,
    filenamePrefix: "single",
    imageRatio: input.imageRatio,
    heightCm: hydratedInput.heightCm,
    widthCm: hydratedInput.widthCm
  });
  const draftPayload = buildDraftPayload(
    {
      ...hydratedInput,
      existingProduct
    },
    copyPlan
  );

  return {
    input: hydratedInput,
    existingProduct,
    copyPlans,
    selectedCopyProvider,
    copyPlan,
    sourceImages: imageFiles.map((file) => ({
      filename: file.filename,
      url: file.publicUrl
    })),
    generatedImages,
    draftPayload
  };
}

async function generateBulkExistingDuplicateBatch({ config, input, sessionId, folders }) {
  const namingContext =
    config.clientId && config.clientSecret
      ? await fetchWorkflowNamingContext(config)
      : { blockedStems: [], inspirationTitles: [] };
  const websiteContext = await fetchWebsiteCopyContext({
    storeDomain: config.storeDomain,
    storefrontOrigin: config.storefrontOrigin
  });
  const items = [];

  for (const [index, reference] of input.bulkExistingProductReferences.entries()) {
    const itemKey = `${index + 1}-${slugifyValue(reference)}`;

    try {
      const existingProduct = await fetchProductByReference(config, reference);
      const hydratedInput = hydrateInputFromExistingProduct(input, existingProduct);
      const variantSizeOptions = await resolveVariantSizeOptions(
        config,
        hydratedInput,
        existingProduct
      );
      const itemUploadsDir = await ensureNestedFolders(
        folders.uploadsDir,
        itemKey
      );
      const itemGeneratedDir = await ensureNestedFolders(
        folders.generatedDir,
        itemKey
      );
      const imageFiles = await persistExistingProductImages(
        itemUploadsDir,
        existingProduct
      );
      const copyInput = buildCopyInput({
        baseInput: input,
        hydratedInput,
        imageFiles,
        existingProduct,
        variantSizeOptions,
        namingContext,
        websiteContext
      });
      const { copyPlans, selectedCopyProvider, copyPlan } =
        await generateCopyPlansForInput(config, input.copyProviders, copyInput);
      const generatedImages = await generateImagesForPlan({
        config,
        providers: input.imageProviders,
        copyPlan,
        imageFiles,
        generatedDir: itemGeneratedDir,
        sessionId,
        filenamePrefix: itemKey,
        imageRatio: input.imageRatio,
        heightCm: hydratedInput.heightCm,
        widthCm: hydratedInput.widthCm
      });
      const draftPayload = buildDraftPayload(
        {
          ...hydratedInput,
          mode: "bulk-existing-duplicate",
          existingProduct
        },
        copyPlan
      );

      items.push({
        itemKey,
        reference,
        existingProduct,
        copyPlans,
        selectedCopyProvider,
        generatedImages,
        draftPayload
      });
    } catch (error) {
      items.push({
        itemKey,
        reference,
        error: error.message
      });
    }
  }

  return {
    batchItems: items,
    summary: {
      requested: input.bulkExistingProductReferences.length,
      generated: items.filter((item) => !item.error).length,
      failed: items.filter((item) => item.error).length
    }
  };
}

function slugifyValue(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";
}

function resolveGeneratedMediaPayload(media) {
  if (!Array.isArray(media)) {
    return [];
  }

  return media.map((item, index) => {
    // Server-side approval gate: UI state is advisory and can be bypassed.
    if (item?.approvedForUpload !== true) {
      throw new Error(
        `Generated media at index ${index} is not approved for upload.`
      );
    }

    const urlPath = String(item.url ?? "").trim();
    if (!urlPath.startsWith("/generated/")) {
      throw new Error(`Unsupported generated media URL at index ${index}.`);
    }

    const relativePath = path.normalize(urlPath.replace(/^\/generated\/?/, ""));
    const fullPath = path.resolve(generatedRoot, relativePath);
    const generatedRootResolved = path.resolve(generatedRoot);

    if (
      fullPath !== generatedRootResolved &&
      !fullPath.startsWith(`${generatedRootResolved}${path.sep}`)
    ) {
      throw new Error(`Generated media path escaped the generated media root at index ${index}.`);
    }

    return {
      ...item,
      sourcePath: fullPath
    };
  });
}

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use("/generated", express.static(generatedRoot));
app.use(express.static(publicDir));

app.get("/api/config", (req, res) => {
  const config = getConfig();
  res.json({
    hasGeminiKey: Boolean(config.geminiApiKey),
    hasOpenAiKey: Boolean(config.openAiApiKey),
    hasShopifyCredentials: Boolean(
      config.clientId && config.clientSecret && config.storeDomain
    ),
    hasLocationId: Boolean(config.locationId)
  });
});

app.post("/api/generate", upload.array("images", MAX_SOURCE_IMAGES), async (req, res) => {
  try {
    const config = getConfig();
    const input = validateCoreInput(req.body, req.files);
    assertProviderConfig(config, {
      copyProviders: input.copyProviders,
      imageProviders: input.imageProviders
    });
    const sessionId = makeSessionId();
    const folders = await ensureSessionFolders(sessionId);
    if (input.mode === "bulk-existing-duplicate") {
      res.json({
        sessionId,
        mode: input.mode,
        ...(await generateBulkExistingDuplicateBatch({
          config,
          input,
          sessionId,
          folders
        }))
      });
      return;
    }

    if (input.mode === "bulk-existing-image-append") {
      res.json({
        sessionId,
        ...(await generateBulkExistingImageAppendBatch({
          config,
          input,
          sessionId,
          folders
        }))
      });
      return;
    }

    if (input.mode === "bulk-collection-size-guides") {
      res.json({
        sessionId,
        ...(await generateBulkCollectionSizeGuidesBatch({
          config,
          input,
          sessionId,
          folders
        }))
      });
      return;
    }

    res.json({
      sessionId,
      ...(await generateSinglePackage({
        config,
        input,
        files: req.files,
        sessionId,
        folders
      }))
    });
  } catch (error) {
    res.status(400).json({
      error: error.message
    });
  }
});

app.post("/api/draft/create-bulk", async (req, res) => {
  try {
    const config = getConfig({ requireSecrets: true });
    const items = Array.isArray(req.body.items) ? req.body.items : [];

    if (!items.length) {
      throw new Error("Bulk draft creation requires at least one selected item.");
    }

    if (items.length > MAX_BULK_PRODUCTS) {
      throw new Error(`Bulk draft creation supports at most ${MAX_BULK_PRODUCTS} items.`);
    }

    const results = [];
    for (const [index, item] of items.entries()) {
      try {
        const payload = {
          ...item,
          media: resolveGeneratedMediaPayload(item.media)
        };
        const result = await executeProductWorkflow(config, payload);
        results.push({
          index,
          title: payload.title ?? payload.existingProductHandle ?? `Item ${index + 1}`,
          existingProductId: payload.existingProductId,
          result
        });
      } catch (error) {
        results.push({
          index,
          title: item?.title ?? `Item ${index + 1}`,
          existingProductId: item?.existingProductId ?? null,
          error: error.message
        });
      }
    }

    res.json({
      requested: items.length,
      created: results.filter((item) => !item.error).length,
      failed: results.filter((item) => item.error).length,
      results
    });
  } catch (error) {
    res.status(400).json({
      error: error.message
    });
  }
});

app.post("/api/draft/create", async (req, res) => {
  try {
    const config = getConfig({ requireSecrets: true });
    const payload = normalizeDraftInput({
      ...req.body,
      media: resolveGeneratedMediaPayload(req.body.media)
    });
    const result = await executeProductWorkflow(config, payload);
    res.json(result);
  } catch (error) {
    res.status(400).json({
      error: error.message
    });
  }
});

app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.use((error, req, res, next) => {
  console.error(error);

  if (req.path.startsWith("/api/")) {
    res.status(500).json({
      error: error.message || "Unexpected server error."
    });
    return;
  }

  res.status(500).send("Unexpected server error.");
});

const port = Number(process.env.PORT || 3008);

export async function startServer({ port: requestedPort = port } = {}) {
  return await new Promise((resolve, reject) => {
    const listener = app.listen(requestedPort, () => {
      console.log(`FF Product app listening on http://localhost:${requestedPort}`);
      resolve(listener);
    });

    listener.on("error", reject);
  });
}

function isDirectExecution() {
  if (!process.argv[1]) {
    return false;
  }

  return path.resolve(process.argv[1]) === __filename;
}

if (isDirectExecution()) {
  startServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
