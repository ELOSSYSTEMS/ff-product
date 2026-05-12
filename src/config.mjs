import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

function loadEnvironment() {
  const candidatePaths = [
    process.env.FF_PRODUCT_ENV_PATH,
    path.join(projectRoot, ".env"),
    path.join(process.cwd(), ".env"),
    process.resourcesPath ? path.join(process.resourcesPath, ".env") : ""
  ].filter(Boolean);

  for (const candidatePath of candidatePaths) {
    loadEnv({
      path: candidatePath,
      override: false
    });
  }
}

loadEnvironment();

const DEFAULT_API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";

function normalizeStoreDomain(value) {
  if (!value) {
    return "";
  }

  return value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

export function getConfig({ requireSecrets = false } = {}) {
  const storeDomain = normalizeStoreDomain(process.env.SHOPIFY_STORE_DOMAIN);
  const clientId = process.env.SHOPIFY_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET?.trim() || "";
  const locationId = process.env.SHOPIFY_LOCATION_ID?.trim() || "";
  const openAiApiKey = process.env.OPENAI_API_KEY?.trim() || "";
  const geminiApiKey = process.env.GEMINI_API_KEY?.trim() || "";
  const storefrontOrigin = process.env.SHOPIFY_STOREFRONT_ORIGIN?.trim() || "";

  if (!storeDomain) {
    throw new Error("Missing SHOPIFY_STORE_DOMAIN in .env.");
  }

  if (requireSecrets && (!clientId || !clientSecret)) {
    throw new Error(
      "Missing SHOPIFY_CLIENT_ID or SHOPIFY_CLIENT_SECRET in .env."
    );
  }

  return {
    apiVersion: DEFAULT_API_VERSION,
    clientId,
    clientSecret,
    geminiApiKey,
    locationId,
    openAiApiKey,
    storeDomain,
    storefrontOrigin
  };
}
