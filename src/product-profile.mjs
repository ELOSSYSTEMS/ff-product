const PRODUCT_KIND_PROFILES = {
  arrangement: {
    kind: "arrangement",
    displayName: "Arrangement",
    duplicateSourceProductId: "gid://shopify/Product/9133866221806",
    templateSuffix: null,
    productType: "סידור מעוצב",
    collectionName: "סידורי פרחים",
    inventoryTarget: 20
  },
  set: {
    kind: "set",
    displayName: "Set",
    duplicateSourceProductId: "gid://shopify/Product/9190263324910",
    templateSuffix: null,
    productType: "סט מעוצב",
    collectionName: "סטים",
    inventoryTarget: 20
  }
};

const RELEVANT_PRODUCT_TYPES = new Set(["סט מעוצב", "סידור מעוצב"]);

export function resolveProductProfile(kind) {
  const normalizedKind = (kind ?? "").trim().toLowerCase();
  const profile = PRODUCT_KIND_PROFILES[normalizedKind];

  if (!profile) {
    throw new Error("Unknown product kind. Use 'set' or 'arrangement'.");
  }

  return profile;
}

export function listProductProfiles() {
  return Object.values(PRODUCT_KIND_PROFILES);
}

export function isWorkflowProduct(product) {
  return RELEVANT_PRODUCT_TYPES.has(product?.productType ?? "");
}

export function listRelevantProductTypes() {
  return [...RELEVANT_PRODUCT_TYPES];
}
