const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image-preview";
const GEMINI_TEXT_MODEL = "gemini-3-flash-preview";

import { sanitizeModelJson } from "./openai-client.mjs";

function ensureGeminiKey(config) {
  if (!config.geminiApiKey) {
    throw new Error("Missing GEMINI_API_KEY in .env.");
  }
}

function imageFileToInlineDataPart(imageFile) {
  return {
    inline_data: {
      mime_type: imageFile.mimetype,
      data: imageFile.base64
    }
  };
}

function imageBytesToInlineDataPart(bytes, mimeType = "image/png") {
  return {
    inline_data: {
      mime_type: mimeType,
      data: Buffer.from(bytes).toString("base64")
    }
  };
}

function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function isInHomeSlot(slot) {
  return String(slot ?? "").startsWith("in-home");
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

function sanitizeValidatorResult(rawText) {
  const parsed = JSON.parse(sanitizeModelJson(rawText));
  return {
    passes: Boolean(parsed.passes),
    issues: Array.isArray(parsed.issues)
      ? parsed.issues.map((issue) => normalizeWhitespace(issue)).filter(Boolean)
      : []
  };
}

function extractTextParts(response) {
  const pieces = [];

  for (const candidate of response.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (typeof part.text === "string" && part.text.trim()) {
        pieces.push(part.text.trim());
      }
    }
  }

  return pieces;
}

function extractJoinedText(response) {
  return extractTextParts(response).join("\n").trim();
}

function extractImageBytesFromGemini(response) {
  for (const candidate of response.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (part.inline_data?.data) {
        return Buffer.from(part.inline_data.data, "base64");
      }

      if (part.inlineData?.data) {
        return Buffer.from(part.inlineData.data, "base64");
      }
    }
  }

  return null;
}

function normalizeGeminiAspectRatio(imageRatio) {
  return imageRatio === "1:1" ? "1:1" : "3:2";
}

export async function generateGeminiDerivedImage(config, { prompt, imageFiles, imageRatio = "3:2" }) {
  ensureGeminiKey(config);
  const aspectRatio = normalizeGeminiAspectRatio(imageRatio);

  const response = await fetch(
    `${GEMINI_BASE_URL}/models/${GEMINI_IMAGE_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": config.geminiApiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: [
                  prompt,
                  `The generated image must use a ${aspectRatio} aspect ratio.`,
                  "Use the provided source images as the exact visual source of truth.",
                  "Preserve the bouquet and vase 1:1.",
                  "Preserve the flower mix, flower count, bloom shapes, colors, proportions, arrangement silhouette, vessel shape, vessel material, and vessel color.",
                  "Do not stylize, illustrate, paint, draw, render, reinterpret, beautify, simplify, replace, or invent bouquet or vase elements.",
                  "All bouquets are dried or preserved arrangements, never fresh flowers in water.",
                  "Do not generate water, liquid, waterlines, condensation, bubbles, submerged stems, or wet stems inside any vase, including clear glass vases.",
                  "If a clear vase is visible, show dry stems and any source-matching dry filler only, with no water.",
                  "Only change staging, crop, lighting, background, room context, and camera distance when the prompt requests it."
                ].join(" ")
              },
              ...imageFiles.map(imageFileToInlineDataPart)
            ]
          }
        ],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: {
            aspectRatio
          }
        }
      })
    }
  );

  if (!response.ok) {
    throw new Error(
      `Gemini image request failed with ${response.status}: ${await response.text()}`
    );
  }

  const payload = await response.json();
  const imageBytes = extractImageBytesFromGemini(payload);
  if (!imageBytes) {
    const textParts = extractTextParts(payload);
    const suffix = textParts.length
      ? ` Gemini returned text instead: ${textParts.join(" | ").slice(0, 400)}`
      : "";
    throw new Error(`Gemini image generation did not return image bytes.${suffix}`);
  }

  return imageBytes;
}

export async function validateGeminiDerivedImage(
  config,
  { slot, prompt, imageFiles, generatedBytes, heightCm, widthCm }
) {
  ensureGeminiKey(config);
  if (slot === "size-guide") {
    assertSizeGuideDimensions(heightCm, widthCm);
  }

  const sizeGuideValidationRules =
    slot === "size-guide"
      ? [
          "- because this is a size-guide image, fail if it is not a clean PDP catalog measurement graphic",
          "- fail if the product is not centered, fully visible, and shown with generous clean space around it",
          "- fail if the vertical height guide is missing",
          "- fail if the horizontal width guide is missing",
          `- fail unless the height label is present, legible, and exactly "height ${heightCm} cm"`,
          `- fail unless the width label is present, legible, and exactly "width ${widthCm} cm"`,
          "- fail if cm labels are missing, wrong, rounded, swapped, invented, approximate, illegible, or inconsistent with the provided dimensions",
          "- fail if rulers, measuring tapes, yardsticks, sticky notes, handwritten notes, acrylic blocks, plaques, cameras, books, hands, people, props, comparison objects, room clutter, lifestyle decor, or real-world scale objects appear",
          "- fail if the scene reads as a lifestyle scale scene instead of a clean PDP catalog measurement graphic"
        ]
      : [];

  const response = await fetch(
    `${GEMINI_BASE_URL}/models/${GEMINI_TEXT_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": config.geminiApiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: [
                  "You are validating a generated product image against source bouquet photos.",
                  'Return JSON only with this exact shape: {"passes":true,"issues":[""]}',
                  "Validation rules:",
                  "- pass only if the bouquet and vase remain visually identical to the source images in flower mix, bloom shape, palette, proportions, vessel shape, vessel color, vessel material, and overall silhouette",
                  "- fail if the generated image looks like a painting, drawing, illustration, render, or stylized artwork instead of real photography",
                  "- fail if any bouquet or vase details are materially changed, simplified, swapped, or invented",
                  "- fail if the generated image shows water, liquid, waterlines, condensation, bubbles, submerged stems, or wet stems inside the vase; these products are dried or preserved arrangements and should never appear to sit in water",
                  "- background and room styling may change, but the product itself must stay faithful to the source",
                  isInHomeSlot(slot)
                    ? "- because this is an in-home image, fail if the room feels too sterile, overly manicured, empty, showroom-like, or professionally staged instead of naturally lived-in"
                    : "",
                  ...sizeGuideValidationRules,
                  `Slot: ${slot}`,
                  `Prompt used: ${prompt}`,
                  "The following inline images are the source images followed by the generated image to validate.",
                  "If there is any meaningful identity drift, return passes=false."
                ]
                  .filter(Boolean)
                  .join("\n")
              },
              ...imageFiles.slice(0, 6).map(imageFileToInlineDataPart),
              imageBytesToInlineDataPart(generatedBytes)
            ]
          }
        ],
        generationConfig: {
          responseMimeType: "application/json"
        }
      })
    }
  );

  if (!response.ok) {
    throw new Error(
      `Gemini validation request failed with ${response.status}: ${await response.text()}`
    );
  }

  const payload = await response.json();
  const rawText = extractJoinedText(payload);
  if (!rawText.trim()) {
    throw new Error(`Gemini validation returned empty output for ${slot}.`);
  }

  const result = sanitizeValidatorResult(rawText);
  if (!result.passes && !result.issues.length) {
    result.issues = [`${slot} failed validation without a specific reason.`];
  }

  return result;
}
