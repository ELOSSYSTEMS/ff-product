import { readFile } from "node:fs/promises";
import process from "node:process";

import { getConfig } from "./config.mjs";
import { analyzeCatalog } from "./storefront-catalog.mjs";
import {
  analyzeAdminProducts,
  createDraftProduct,
  fetchWorkflowNamingContext,
  fetchAdminProductSample,
  normalizeDraftInput
} from "./shopify-client.mjs";

function parseFlag(flagName) {
  const index = process.argv.indexOf(flagName);
  if (index === -1) {
    return "";
  }

  return process.argv[index + 1] ?? "";
}

async function readJsonFile(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function run() {
  const command = process.argv[2];

  switch (command) {
    case "catalog-sample": {
      const config = getConfig();
      const analysis = await analyzeCatalog({
        storeDomain: config.storeDomain,
        storefrontOrigin: config.storefrontOrigin,
        sampleSize: 5,
        pageBlockSample: 2
      });
      console.log(JSON.stringify(analysis.products, null, 2));
      return;
    }

    case "catalog-analyze": {
      const config = getConfig();
      const analysis = await analyzeCatalog({
        storeDomain: config.storeDomain,
        storefrontOrigin: config.storefrontOrigin
      });
      console.log(JSON.stringify(analysis, null, 2));
      return;
    }

    case "shopify-test": {
      const config = getConfig({ requireSecrets: true });
      const sample = await fetchAdminProductSample(config);
      console.log(JSON.stringify(sample, null, 2));
      return;
    }

    case "shopify-analyze": {
      const config = getConfig({ requireSecrets: true });
      const analysis = await analyzeAdminProducts(config);
      console.log(JSON.stringify(analysis, null, 2));
      return;
    }

    case "shopify-naming-context": {
      const config = getConfig({ requireSecrets: true });
      const context = await fetchWorkflowNamingContext(config);
      console.log(JSON.stringify(context, null, 2));
      return;
    }

    case "draft-dry-run": {
      const inputPath = parseFlag("--input");
      if (!inputPath) {
        throw new Error("draft-dry-run requires --input <path>.");
      }

      const payload = await readJsonFile(inputPath);
      console.log(JSON.stringify(normalizeDraftInput(payload), null, 2));
      return;
    }

    case "draft-create": {
      const inputPath = parseFlag("--input");
      if (!inputPath) {
        throw new Error("draft-create requires --input <path>.");
      }

      const config = getConfig({ requireSecrets: true });
      const payload = await readJsonFile(inputPath);
      const result = await createDraftProduct(config, payload);
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    default:
      throw new Error(
        "Unknown command. Use catalog-sample, catalog-analyze, shopify-test, shopify-analyze, shopify-naming-context, draft-dry-run, or draft-create."
      );
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
