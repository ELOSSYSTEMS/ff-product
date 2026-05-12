export function normalizeWhitespace(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitizeTitleStem(value) {
  return normalizeWhitespace(
    String(value ?? "").replace(/["'`“”׳״.,/\\|()[\]{}:;!?+\-]/g, " ")
  );
}

export function extractTitleStem(rawTitle) {
  const cleaned = sanitizeTitleStem(rawTitle);
  const tokens = cleaned.split(" ").filter(Boolean);

  if (!tokens.length) {
    return "";
  }

  if (tokens[0] === "סט" || tokens[0] === "סידור") {
    return normalizeWhitespace(tokens[1] ?? tokens[tokens.length - 1] ?? "");
  }

  return normalizeWhitespace(tokens[tokens.length - 1] ?? "");
}

export function buildCanonicalTitle(kind, stem) {
  const prefix = kind === "set" ? "סט" : "סידור";
  const normalizedStem = normalizeWhitespace(stem);

  if (!normalizedStem) {
    throw new Error("Cannot build a canonical title without a stem.");
  }

  return `${prefix} ${normalizedStem}`;
}
