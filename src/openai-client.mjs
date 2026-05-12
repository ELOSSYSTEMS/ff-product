import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildCanonicalTitle,
  extractTitleStem,
  normalizeWhitespace
} from "./naming.mjs";

const OPENAI_BASE_URL = "https://api.openai.com/v1";

function ensureOpenAiKey(config) {
  if (!config.openAiApiKey) {
    throw new Error("Missing OPENAI_API_KEY in .env.");
  }
}

async function postJson(config, endpoint, body) {
  ensureOpenAiKey(config);

  const response = await fetch(`${OPENAI_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openAiApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(
      `OpenAI request failed with ${response.status}: ${await response.text()}`
    );
  }

  return response.json();
}

function buildImageContextText({
  kind,
  price,
  heightCm,
  widthCm,
  extraNotes,
  variantSizeOptions
}) {
  return [
    `Product kind: ${kind}`,
    `Base price in NIS: ${price}`,
    `Height in cm: ${heightCm}`,
    `Width in cm: ${widthCm}`,
    variantSizeOptions?.length
      ? `Available size variants: ${variantSizeOptions.join(" || ")}`
      : "",
    extraNotes ? `Extra operator notes: ${extraNotes}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

export function sanitizeModelJson(rawText) {
  const trimmed = rawText.trim();
  if (trimmed.startsWith("```")) {
    return trimmed
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/, "");
  }

  return trimmed;
}

function extractResponseText(response) {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }

  const pieces = [];
  for (const item of response.output ?? []) {
    if (item.type !== "message" || !Array.isArray(item.content)) {
      continue;
    }

    for (const contentItem of item.content) {
      if (contentItem.type === "output_text" && typeof contentItem.text === "string") {
        pieces.push(contentItem.text);
      }
    }
  }

  return pieces.join("\n").trim();
}

function stripDisallowedDashes(value) {
  return String(value ?? "")
    .replace(/[—–―]/g, ", ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,+/g, ", ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isInHomeSlot(slot) {
  return String(slot ?? "").startsWith("in-home");
}

function resolveImageRatioInstruction(imageRatio) {
  if (imageRatio === "1:1") {
    return "Compose the final image as a square 1:1 frame.";
  }

  return "Compose the final image as a 3:2 landscape frame.";
}

function normalizeHebrewProductTitle(kind, rawTitle) {
  const stem = extractTitleStem(rawTitle);
  if (!stem) {
    throw new Error("OpenAI copy generation returned a title without a usable name stem.");
  }

  return buildCanonicalTitle(kind, stem);
}

function isIntegerDimension(value) {
  return Number.isInteger(value) && value > 0;
}

function assertSizeGuideDimensions(heightCm, widthCm) {
  if (!isIntegerDimension(heightCm) || !isIntegerDimension(widthCm)) {
    throw new Error(
      "Size-guide image generation requires exact integer heightCm and widthCm values."
    );
  }
}

function buildSeoDescription(title, heightCm, widthCm) {
  if (!isIntegerDimension(heightCm) || !isIntegerDimension(widthCm)) {
    throw new Error(
      "SEO description generation requires exact integer heightCm and widthCm values."
    );
  }

  return `${normalizeWhitespace(title)} מעוצב מפרחים אמיתיים מיובשים לבית, לעסק או למתנה. מידת הסידור: ${heightCm}×${widthCm} ס״מ. ללא מים או תחזוקה, נשאר יפה לאורך זמן ומשתנה בעדינות באופן טבעי.`;
}

function buildMobileFirstHebrewSizeGuidePrompt({ title, heightCm, widthCm, extraNotes }) {
  assertSizeGuideDimensions(heightCm, widthCm);

  return [
    `Create a new mobile-first product size guide image for "${normalizeWhitespace(title) || "the product"}" based on the existing Forever Flowers product images.`,
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

function normalizeImageDirectivePrompt(
  slot,
  prompt,
  imageRatio = "3:2",
  { title, heightCm, widthCm, extraNotes } = {}
) {
  if (["size-guide", "mobile-size-guide"].includes(slot)) {
    return buildMobileFirstHebrewSizeGuidePrompt({
      title,
      heightCm,
      widthCm,
      extraNotes
    });
  }

  const base = stripDisallowedDashes(prompt);
  const rules = [
    "Render as true-to-life commercial photography only.",
    resolveImageRatioInstruction(imageRatio),
    "The bouquet and vase must stay 1:1 visually identical to the source images.",
    "Preserve the exact flower mix, bloom shapes, colors, proportions, vessel shape, vessel material, vessel color, and overall arrangement silhouette.",
    "All bouquets are dried or preserved arrangements, never fresh flowers in water.",
    "Do not generate water, liquid, waterlines, condensation, bubbles, submerged stems, or wet stems inside any vase, including clear glass vases.",
    "If a clear vase is visible, show dry stems and any source-matching dry filler only, with no water.",
    "Do not stylize, illustrate, paint, draw, render, reinterpret, beautify, simplify, replace, or invent any bouquet or vase elements.",
    "Keep the bouquet and vase centered in the frame.",
    "If the product is on any surface, center it on that surface as the visual focal point."
  ];

  if (slot === "zoomed") {
    rules.push(
      "This is a close-up crop, not a reinterpretation.",
      "Keep the exact bouquet and vase identity while only moving closer to show texture and detail.",
      "Do not crop so tightly that the bouquet structure appears different from the source."
    );
  }

  if (isInHomeSlot(slot)) {
    rules.push(
      "The home must feel genuinely lived-in and naturally inhabited, with subtle everyday signs of life, not scrubbed, surgical, empty, showroom-like, or professionally staged."
    );
  }

  return `${base} ${rules.join(" ")}`.trim();
}

function summarizeValidationIssues(issues) {
  return (issues ?? [])
    .map((issue) => normalizeWhitespace(issue))
    .filter(Boolean)
    .slice(0, 4)
    .join(" | ");
}

function assertNoForbiddenBrandPhrases(copyPlan, websiteContext) {
  const text = [
    copyPlan.title,
    copyPlan.descriptionHtml,
    copyPlan.seoTitle,
    copyPlan.seoDescription
  ]
    .filter(Boolean)
    .join("\n");

  for (const forbiddenPhrase of websiteContext?.forbiddenPhrases ?? []) {
    if (forbiddenPhrase && text.includes(forbiddenPhrase)) {
      throw new Error(
        `Generated copy used forbidden website phrase "${forbiddenPhrase}".`
      );
    }
  }
}

export function normalizeCopyPlan(input, copyPlan) {
  const title = input.fixedTitle
    ? normalizeWhitespace(input.fixedTitle)
    : normalizeHebrewProductTitle(input.kind, copyPlan.title);
  const normalizedPlan = {
    ...copyPlan,
    title,
    descriptionHtml: stripDisallowedDashes(copyPlan.descriptionHtml),
    seoTitle: stripDisallowedDashes(copyPlan.seoTitle),
    seoDescription: buildSeoDescription(title, input.heightCm, input.widthCm),
    tags: Array.isArray(copyPlan.tags)
      ? [...new Set(copyPlan.tags.map((tag) => normalizeWhitespace(tag)).filter(Boolean))]
      : [],
    imageDirectives: Array.isArray(copyPlan.imageDirectives)
      ? copyPlan.imageDirectives.map((directive) => ({
          ...directive,
          prompt: normalizeImageDirectivePrompt(
            directive.slot,
            directive.prompt,
            input.imageRatio,
            {
              heightCm: input.heightCm,
              widthCm: input.widthCm,
              title,
              extraNotes: input.extraNotes
            }
          )
        }))
      : []
  };

  const blockedStems = new Set(input.namingContext?.blockedStems ?? []);
  const titleStem = extractTitleStem(normalizedPlan.title);
  if (!input.fixedTitle && titleStem && blockedStems.has(titleStem)) {
    throw new Error(
      `Generated title stem "${titleStem}" already exists in the current catalog.`
    );
  }

  assertNoForbiddenBrandPhrases(normalizedPlan, input.websiteContext);

  return normalizedPlan;
}

export function buildCopyPrompt(input, attempt = 0, rejectedStems = []) {
  const namingRule =
    input.kind === "set"
      ? "The title must be exactly two Hebrew words: סט plus one single Hebrew word. Example: סט אופק. Do not use any other first word."
      : "The title must be exactly two Hebrew words: סידור plus one single Hebrew word. Example: סידור אור. Do not use any other first word.";
  const blockedStems = [
    ...(input.namingContext?.blockedStems ?? []),
    ...rejectedStems
  ].filter(Boolean);
  const inspirationTitles = input.namingContext?.inspirationTitles ?? [];
  const preferredClaims = input.websiteContext?.preferredClaims ?? [];
  const homepageBrandPhrases = (input.websiteContext?.homepageBrandPhrases ?? [])
    .map((entry) => entry.phrase);
  const carePhrases = (input.websiteContext?.carePhrases ?? [])
    .map((entry) => entry.phrase);
  const forbiddenPhrases = input.websiteContext?.forbiddenPhrases ?? [];

  return [
    "Generate Shopify-ready Hebrew product copy for Forever Flowers from the provided bouquet images.",
    "Return JSON only with this exact shape:",
    '{"title":"","descriptionHtml":"","seoTitle":"","seoDescription":"","tags":[""],"imageDirectives":[{"slot":"studio","prompt":""},{"slot":"zoomed","prompt":""},{"slot":"size-guide","prompt":""},{"slot":"in-home-1","prompt":""},{"slot":"in-home-2","prompt":""}]}',
    "Rules:",
    input.fixedTitle
      ? `- title must stay exactly this existing product title: ${input.fixedTitle}`
      : "- title must follow the exact naming format rule for the selected kind",
    "- keep a premium, calm, minimal Forever Flowers tone",
    "- descriptionHtml must contain exactly 2 paragraphs using <p>...</p><p>...</p>",
    "- paragraph 1 describes the bouquet or set visually and materially",
    "- paragraph 2 describes placement and effect in the home",
    "- if the product has multiple size variants, the description must explicitly reflect that it is available in multiple sizes and must not describe only one size as if it were the only option",
    "- do not use em dashes, en dashes, or long dash punctuation anywhere",
    "- do not invent care or maintenance language that is not supported by the website context below",
    "- do not mention dust, dust cleaning, wiping, brushing, or dust maintenance at all",
    "- seoTitle should be concise and Shopify-ready",
    "- seoDescription should be concise and premium",
    "- tags must be short Hebrew product tags that reflect flowers, palette, vessel, and material when visible",
    "- tags should be relevant, specific, and useful for internal merchandising such as ורדים, פאוני, אגרטל קרם",
    "- return between 3 and 8 tags only",
    `- ${namingRule}`,
    input.fixedTitle
      ? "- do not rename the product"
      : "- the one-word name stem must be new and must not duplicate any existing product stem in the catalog",
    "- imageDirectives must preserve the bouquet and vase identity faithfully",
    "- every product is a dried or preserved arrangement; imageDirectives must forbid water, liquid, waterlines, condensation, bubbles, submerged stems, or wet stems in any vase, including clear glass vases",
    "- if a clear vase is visible, imageDirectives must show dry stems and any source-matching dry filler only, with no water",
    "- imageDirectives prompts must target five outputs: studio, zoomed detail, size guide, in-home scene 1, in-home scene 2",
    "- the size-guide image prompt must describe a mobile-first square Hebrew PDP size-guide image, not a lifestyle scene",
    "- the size-guide image prompt must require a 1600x1600 square canvas, warm off-white / beige background, central safe area, and large readable Hebrew labels only",
    isIntegerDimension(input.heightCm) && isIntegerDimension(input.widthCm)
      ? `- the size-guide image prompt must use exactly these Hebrew labels: "גובה ${input.heightCm} ס״מ" and "רוחב ${input.widthCm} ס״מ"; do not invent, round, swap, approximate, or add measurement values`
      : "",
    "- the size-guide image prompt must place the vertical height arrow on the left side of the product and the horizontal width arrow below the product",
    "- the size-guide image prompt must forbid English labels, extra small text, physical rulers, measuring tapes, yardsticks, sticky notes, handwritten notes, acrylic blocks, plaques, cameras, books, hands, people, props, comparison objects, room clutter, and lifestyle decor",
    "- the size-guide image prompt must show one centered product only",
    "- every image prompt must keep the bouquet as the centered focal point",
    "- if the bouquet is placed on a table, shelf, console, or any other surface, it must be centered on that surface",
    "- home lifestyle scenes should usually place the product on a console, dining table, or kitchen island",
    "- avoid office, boardroom, conference room, or corporate meeting contexts unless the operator explicitly asks for them",
    "- if kind is arrangement, the description should reflect that it comes with a clear cylindrical glass vase unless the customer chooses otherwise",
    "- if kind is arrangement, do not invent a vase shape other than the clear cylindrical vase unless the source images show something else",
    "- if kind is set, the description must clearly state that the vase is included as one integral product unit",
    "- if kind is set, preserve the vase as part of the product",
    "",
    blockedStems.length
      ? `Forbidden existing name stems: ${blockedStems.slice(0, 120).join(", ")}`
      : "",
    inspirationTitles.length
      ? `Catalog naming inspiration only, do not repeat them: ${inspirationTitles.slice(0, 40).join(", ")}`
      : "",
    preferredClaims.length
      ? `Website-verified claims you may use when relevant: ${preferredClaims.join(" | ")}`
      : "",
    homepageBrandPhrases.length
      ? `Homepage brand language: ${homepageBrandPhrases.join(" | ")}`
      : "",
    carePhrases.length
      ? `Observed care language across product pages: ${carePhrases.join(" | ")}`
      : "",
    forbiddenPhrases.length
      ? `Forbidden phrases: ${forbiddenPhrases.join(", ")}`
      : "",
    attempt > 0 && rejectedStems.length
      ? `Previous attempt used a forbidden stem. Generate a different stem than: ${rejectedStems.join(", ")}`
      : "",
    "",
    "Product context:",
    buildImageContextText(input)
  ].filter(Boolean).join("\n");
}

export async function generateCopyPlan(config, input) {
  const imageInputs = input.imageFiles.map((imageFile) => ({
    type: "input_image",
    image_url: `data:${imageFile.mimetype};base64,${imageFile.base64}`
  }));

  const rejectedStems = [];

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await postJson(config, "/responses", {
      model: "gpt-5",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildCopyPrompt(input, attempt, rejectedStems)
            },
            ...imageInputs
          ]
        }
      ]
    });

    const rawText = extractResponseText(response);
    if (!rawText.trim()) {
      throw new Error("OpenAI copy generation returned empty output.");
    }

    try {
      return normalizeCopyPlan(input, JSON.parse(sanitizeModelJson(rawText)));
    } catch (error) {
      const message = String(error.message ?? error);
      const matchedStem = message.match(/Generated title stem "(.+)" already exists/);
      if (matchedStem?.[1]) {
        rejectedStems.push(matchedStem[1]);
        continue;
      }

      if (message.includes("Generated copy used forbidden website phrase")) {
        continue;
      }

      throw error;
    }
  }

  throw new Error(
    "Could not generate a unique product name stem after 3 attempts."
  );
}

export function buildImageRetryPrompt(
  prompt,
  issues,
  { slot, heightCm, widthCm } = {}
) {
  const remediation = summarizeValidationIssues(issues);
  if (!remediation) {
    return prompt;
  }

  const slotSpecificRules = [];
  if (["size-guide", "mobile-size-guide"].includes(slot)) {
    assertSizeGuideDimensions(heightCm, widthCm);
    slotSpecificRules.push(
      "Keep the same exact bouquet and vase identity.",
      "Preserve the exact dimensions.",
      `Use exactly "גובה ${heightCm} ס״מ" for height and "רוחב ${widthCm} ס״מ" for width.`,
      `The height label must read exactly "גובה ${heightCm} ס״מ".`,
      `The width label must read exactly "רוחב ${widthCm} ס״מ".`,
      "Keep the square mobile PDP-safe layout: height arrow left, width arrow bottom, large readable Hebrew only.",
      "Fix only measurement graphic, layout, or label issues.",
      "Do not change bouquet shape, vase, flower count, product scale, or arrangement identity.",
      "Do not add props or lifestyle context."
    );
  }

  return [
    prompt,
    `Correction requirements from the previous failed attempt: ${remediation}.`,
    "Fix these issues while keeping the bouquet and vase visually identical to the source.",
    ...slotSpecificRules,
    "Make the smallest possible visual change needed to satisfy the correction."
  ].join(" ");
}

export async function saveGeneratedImage(outputDir, slot, bytes) {
  const filename = `${slot}.png`;
  const fullPath = path.join(outputDir, filename);
  await writeFile(fullPath, bytes);
  return {
    filename,
    fullPath
  };
}
