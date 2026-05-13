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

function containsOutdatedCopyClaim(value) {
  return /100\s*(days?|ימים|יום)|one hundred days|ארבעה חודשים/i.test(
    String(value ?? "")
  );
}

function filterOutdatedCopyClaims(values) {
  return (values ?? []).filter((value) => !containsOutdatedCopyClaim(value));
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

function buildDescriptionHtml(title, heightCm, widthCm, extraNotes) {
  if (!isIntegerDimension(heightCm) || !isIntegerDimension(widthCm)) {
    throw new Error(
      "Description generation requires exact integer heightCm and widthCm values."
    );
  }

  const notes = normalizeWhitespace(extraNotes);
  const notesSentence = notes ? ` פרטים נוספים: ${notes}.` : "";

  return [
    `<p>${normalizeWhitespace(title)} מעוצב מפרחים אמיתיים מיובשים לבית, לעסק או למתנה. מידת הסידור: ${heightCm}×${widthCm} ס״מ.</p>`,
    `<p>ללא מים או תחזוקה, נשאר יפה לאורך זמן ומשתנה בעדינות באופן טבעי.${notesSentence}</p>`
  ].join("");
}

function buildMobileFirstHebrewSizeGuidePrompt({ title, heightCm, widthCm, extraNotes }) {
  assertSizeGuideDimensions(heightCm, widthCm);

  return [
    `Create a new mobile-first product size guide image for "${normalizeWhitespace(title) || "the product"}" based on the existing Forever Flowers product images.`,
    "Output requirements:",
    "- Square canvas: 1600x1600 px.",
    "- The entire image must be visible and readable inside a Shopify mobile PDP gallery without zooming.",
    "- Keep all important content inside a central safe area with at least 160 px margin on every side.",
    "- Use a minimalist premium studio product-photo setup, not a blank white canvas.",
    "- Use a warm off-white / very light gray wall with a visible light wood or warm neutral tabletop surface.",
    "- Include a subtle wall/table horizon line, soft studio shadow, and gentle depth like a real catalog studio shot.",
    "- Keep the background quiet and minimal so the measurement labels stay readable.",
    "- Keep the product centered and fully visible.",
    "- Preserve the product appearance as accurately as possible.",
    "- Preserve the exact bouquet, vase, flower count, colors, proportions, and arrangement identity.",
    "- All bouquets are dried or preserved arrangements, never fresh flowers in water.",
    "- Do not generate water, liquid, waterlines, condensation, bubbles, submerged stems, or wet stems inside any vase, including clear glass vases.",
    "- Make the bouquet/vase about 48-56% of the canvas height so there is room for measurement lines and labels.",
    "- Place the product directly on the tabletop surface.",
    "- Do not add trays, wooden risers, plinths, pedestals, blocks, stands, props, decor, hands, books, rulers, or measuring tapes.",
    "- Use elegant, minimal typography.",
    "- Use large, readable Hebrew labels only, written horizontally:",
    `  - גובה ${heightCm} ס״מ`,
    `  - רוחב ${widthCm} ס״מ`,
    "- The numbers and labels must be readable on a mobile screen without zoom.",
    "- Do not add small text.",
    "- Do not rotate Hebrew text.",
    "- Do not split Hebrew labels across lines.",
    "- Do not place labels, guide lines, or product parts near the image edges.",
    "- Do not crop anything.",
    "- Do not change the product colors or shape.",
    "- Do not add extra decorations.",
    "- Make it look premium, clean, and suitable for Forever Flowers PDP product gallery.",
    "Measurement guide rules:",
    "- Match this visual language: thin gray technical guide lines with small perpendicular end ticks, like a premium catalog size guide.",
    "- Do not use arrowheads anywhere.",
    "- Do not use thick black lines or white lines.",
    "- The guide lines must measure the actual visible product dimensions, not the canvas.",
    "- The vertical height guide must always be on the RIGHT side of the product.",
    "- The height label must be horizontal, placed to the right of the vertical guide, vertically centered beside it.",
    "- The horizontal width guide must always be BELOW the product.",
    "- The width label must be horizontal, centered below the horizontal guide.",
    "- Keep this layout uniform across all products: height guide on the right, width guide on the bottom.",
    "- The vertical height guide should start at the lowest visible point of the vase/base and end at the highest visible flower/branch.",
    "- The horizontal width guide should start at the leftmost visible edge of the arrangement and end at the rightmost visible edge of the arrangement.",
    "- Guide endpoints must align with the product edges they measure.",
    "- Keep guide lines close enough to the product to be clear, but detached and elegant like the reference template.",
    "Use these exact dimensions:",
    `- Height: ${heightCm} ס״מ`,
    `- Width: ${widthCm} ס״מ`,
    extraNotes ? `Operator notes: ${extraNotes}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function findDirectivePrompt(imageDirectives, preferredSlots) {
  const slots = new Set(preferredSlots);
  return (imageDirectives ?? []).find((directive) => slots.has(directive?.slot))?.prompt ?? "";
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

function normalizeImageDirectives(input, title, imageDirectives) {
  const promptContext = {
    heightCm: input.heightCm,
    widthCm: input.widthCm,
    title,
    extraNotes: input.extraNotes
  };

  return [
    {
      slot: "size-guide",
      prompt: normalizeImageDirectivePrompt(
        "size-guide",
        findDirectivePrompt(imageDirectives, ["size-guide", "mobile-size-guide"]),
        input.imageRatio,
        promptContext
      )
    },
    {
      slot: "in-home",
      prompt: normalizeImageDirectivePrompt(
        "in-home",
        findDirectivePrompt(imageDirectives, ["in-home", "in-home-1", "in-home-2"]) ||
          `Create one refined in-home PDP image for "${title}" with the product centered and fully visible in a warm, natural home setting.`,
        input.imageRatio,
        promptContext
      )
    },
    {
      slot: "in-business",
      prompt: normalizeImageDirectivePrompt(
        "in-business",
        findDirectivePrompt(imageDirectives, ["in-business"]) ||
          `Create one refined in-business PDP image for "${title}" with the product centered and fully visible in a quiet boutique, reception, office, or hospitality setting.`,
        input.imageRatio,
        promptContext
      )
    }
  ];
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

  if (containsOutdatedCopyClaim(text)) {
    throw new Error("Generated copy used outdated 100-day or four-month longevity language.");
  }
}

export function normalizeCopyPlan(input, copyPlan) {
  const title = input.fixedTitle
    ? normalizeWhitespace(input.fixedTitle)
    : normalizeHebrewProductTitle(input.kind, copyPlan.title);
  const normalizedPlan = {
    ...copyPlan,
    title,
    descriptionHtml: buildDescriptionHtml(
      title,
      input.heightCm,
      input.widthCm,
      input.extraNotes
    ),
    seoTitle: stripDisallowedDashes(copyPlan.seoTitle),
    seoDescription: buildSeoDescription(title, input.heightCm, input.widthCm),
    tags: Array.isArray(copyPlan.tags)
      ? [...new Set(copyPlan.tags.map((tag) => normalizeWhitespace(tag)).filter(Boolean))]
      : [],
    imageDirectives: normalizeImageDirectives(
      input,
      title,
      Array.isArray(copyPlan.imageDirectives) ? copyPlan.imageDirectives : []
    )
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
  const preferredClaims = filterOutdatedCopyClaims(
    input.websiteContext?.preferredClaims ?? []
  );
  const homepageBrandPhrases = (input.websiteContext?.homepageBrandPhrases ?? [])
    .map((entry) => entry.phrase)
    .filter((phrase) => !containsOutdatedCopyClaim(phrase));
  const carePhrases = (input.websiteContext?.carePhrases ?? [])
    .map((entry) => entry.phrase)
    .filter((phrase) => !containsOutdatedCopyClaim(phrase));
  const forbiddenPhrases = [
    ...(input.websiteContext?.forbiddenPhrases ?? []),
    "100 days",
    "one hundred days",
    "100 יום",
    "100 ימים",
    "ארבעה חודשים"
  ];

  return [
    "Generate Shopify-ready Hebrew product copy for Forever Flowers from the provided bouquet images.",
    "Return JSON only with this exact shape:",
    '{"title":"","descriptionHtml":"","seoTitle":"","seoDescription":"","tags":[""],"imageDirectives":[{"slot":"size-guide","prompt":""},{"slot":"in-home","prompt":""},{"slot":"in-business","prompt":""}]}',
    "Rules:",
    input.fixedTitle
      ? `- title must stay exactly this existing product title: ${input.fixedTitle}`
      : "- title must follow the exact naming format rule for the selected kind",
    "- keep a premium, calm, minimal Forever Flowers tone",
    "- descriptionHtml must follow the current SEO-template direction: real dried flowers, home/business/gift use, exact dimensions, no water or maintenance, stays beautiful over time and changes gently and naturally",
    "- do not mention or identify specific flower types in descriptionHtml unless the operator explicitly names those flowers in Extra operator notes",
    "- do not guess flowers, flower names, botanical names, or material specifics from the image",
    "- do not use old outdated copy claims such as 100 days, one hundred days, 100 יום, or 100 ימים",
    "- if the product has multiple size variants, the description must not describe only one size as if it were the only option",
    "- do not use em dashes, en dashes, or long dash punctuation anywhere",
    "- do not invent care or maintenance language beyond the approved no-water/no-maintenance wording",
    "- do not mention dust, dust cleaning, wiping, brushing, or dust maintenance at all",
    "- seoTitle should be concise and Shopify-ready",
    "- seoDescription should be concise and premium",
    "- tags must be short Hebrew product tags that reflect safe visible attributes such as palette, vessel, product kind, and material only when clear",
    "- tags should be relevant, specific, and useful for internal merchandising such as אגרטל קרם, פרחים מיובשים, סט מעוצב",
    "- return between 3 and 8 tags only",
    `- ${namingRule}`,
    input.fixedTitle
      ? "- do not rename the product"
      : "- the one-word name stem must be new and must not duplicate any existing product stem in the catalog",
    "- imageDirectives must preserve the bouquet and vase identity faithfully",
    "- every product is a dried or preserved arrangement; imageDirectives must forbid water, liquid, waterlines, condensation, bubbles, submerged stems, or wet stems in any vase, including clear glass vases",
    "- if a clear vase is visible, imageDirectives must show dry stems and any source-matching dry filler only, with no water",
    "- imageDirectives prompts must target exactly three outputs: size-guide, in-home, in-business",
    "- do not create studio or zoomed image directives",
    "- the size-guide image prompt must describe a mobile-first square Hebrew PDP size-guide image, not a lifestyle scene",
    "- the size-guide image prompt must require a 1600x1600 square canvas, minimalist studio tabletop setup, central safe area, and large readable horizontal Hebrew labels only",
    isIntegerDimension(input.heightCm) && isIntegerDimension(input.widthCm)
      ? `- the size-guide image prompt must use exactly these Hebrew labels: "גובה ${input.heightCm} ס״מ" and "רוחב ${input.widthCm} ס״מ"; do not invent, round, swap, approximate, or add measurement values`
      : "",
    "- the size-guide image prompt must use thin gray measurement guide lines with small perpendicular end ticks and no arrowheads",
    "- the size-guide image prompt must place the vertical height guide on the right side of the product and the horizontal width guide below the product",
    "- the size-guide image prompt must forbid rotated labels, split labels, English labels, extra small text, physical rulers, measuring tapes, yardsticks, sticky notes, handwritten notes, acrylic blocks, plaques, cameras, books, hands, people, trays, platforms, risers, props, comparison objects, room clutter, and lifestyle decor",
    "- the size-guide image prompt must show one centered product only",
    "- every image prompt must keep the product as the centered focal point",
    "- if the bouquet is placed on a table, shelf, console, or any other surface, it must be centered on that surface",
    "- the in-home scene should usually place the product on a console, dining table, or kitchen island",
    "- the in-business scene should place the product in a premium business setting such as a boutique counter, reception area, office shelf, studio, clinic, salon, restaurant, or hospitality space",
    "- avoid cluttered boardroom or corporate meeting-table contexts",
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
      "Keep the square mobile PDP-safe layout: height guide right, width guide bottom, large readable horizontal Hebrew only.",
      "Use thin gray tick-mark guide lines without arrowheads.",
      "Do not rotate or split Hebrew labels.",
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
