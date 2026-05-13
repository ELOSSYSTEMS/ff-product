const form = document.querySelector("#generate-form");
const statusNode = document.querySelector("#status");
const errorNode = document.querySelector("#error");
const copyOutput = document.querySelector("#copy-output");
const payloadOutput = document.querySelector("#payload-output");
const imageGrid = document.querySelector("#image-grid");
const configBadge = document.querySelector("#config-badge");
const createDraftButton = document.querySelector("#create-draft-button");
const overwriteExistingButton = document.querySelector("#overwrite-existing-button");
const modeField = document.querySelector("#mode");
const newProductStatusField = document.querySelector("#new-product-status-field");
const newProductStatusInput = document.querySelector("#newProductStatus");
const existingProductReferenceField = document.querySelector(
  "#existing-product-reference-field"
);
const existingProductReferenceInput = document.querySelector(
  "#existingProductReference"
);
const bulkExistingProductReferencesField = document.querySelector(
  "#bulk-existing-product-references-field"
);
const bulkExistingProductReferencesInput = document.querySelector(
  "#bulkExistingProductReferences"
);
const bulkCollectionHandlesField = document.querySelector(
  "#bulk-collection-handles-field"
);
const bulkCollectionHandlesInput = document.querySelector("#bulkCollectionHandles");
const existingProductSummaryNode = document.querySelector(
  "#existing-product-summary"
);
const imagesInput = document.querySelector("#images");
const imagesHelp = document.querySelector("#images-help");
const imageRatioInput = document.querySelector("#imageRatio");
const kindInput = document.querySelector("#kind");
const priceInput = document.querySelector("#price");
const costInput = document.querySelector("#cost");
const heightInput = document.querySelector("#heightCm");
const widthInput = document.querySelector("#widthCm");
const kindHelp = document.querySelector("#kind-help");
const priceHelp = document.querySelector("#price-help");
const costHelp = document.querySelector("#cost-help");
const heightHelp = document.querySelector("#height-help");
const widthHelp = document.querySelector("#width-help");
const imageSelectionHelp = document.querySelector("#image-selection-help");
const batchReviewCard = document.querySelector("#batch-review-card");
const batchReviewOutput = document.querySelector("#batch-review-output");
const themeLightButton = document.querySelector("#theme-light-button");
const themeDarkButton = document.querySelector("#theme-dark-button");

let latestDraftPayload = null;
let latestGeneratedImages = [];
let latestExistingProduct = null;
let latestCopyPlans = {};
let latestBatchItems = [];
let latestBatchMode = "";
const THEME_STORAGE_KEY = "ff-product-theme";
const NEW_PRODUCT_STATUSES = new Set(["DRAFT", "ACTIVE"]);

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function readResponsePayload(response) {
  const contentType = response.headers.get("content-type") || "";
  const rawText = await response.text();

  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(rawText);
    } catch {
      return { error: rawText || "Invalid JSON response." };
    }
  }

  return {
    error: rawText || `Unexpected non-JSON response (${response.status}).`
  };
}

function setStatus(text) {
  statusNode.textContent = text;
}

function showError(message) {
  errorNode.textContent = message;
  errorNode.classList.remove("hidden");
}

function clearError() {
  errorNode.textContent = "";
  errorNode.classList.add("hidden");
}

function getPreferredTheme() {
  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (storedTheme === "light" || storedTheme === "dark") {
    return storedTheme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  themeLightButton.classList.toggle("is-active", theme === "light");
  themeDarkButton.classList.toggle("is-active", theme === "dark");
}

function setTheme(theme) {
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  applyTheme(theme);
}

function renderExistingProductSummary(existingProduct) {
  latestExistingProduct = existingProduct ?? null;

  if (!existingProduct) {
    existingProductSummaryNode.innerHTML = "";
    existingProductSummaryNode.classList.add("hidden");
    return;
  }

  existingProductSummaryNode.innerHTML = `
    <h3>Existing Product</h3>
    <p><strong>${escapeHtml(existingProduct.title)}</strong></p>
    <p>Handle: ${escapeHtml(existingProduct.handle)}</p>
    <p>Status: ${escapeHtml(existingProduct.status)}</p>
    <p>Type: ${escapeHtml(existingProduct.productType || "Unknown")}</p>
  `;
  existingProductSummaryNode.classList.remove("hidden");
}

function renderCopy(copyPlans, selectedProvider = "openai") {
  const entries = Object.entries(copyPlans ?? {});
  if (!entries.length) {
    copyOutput.textContent = "Nothing generated yet.";
    return;
  }

  copyOutput.innerHTML = `
    <div class="copy-provider-grid">
      ${entries
        .map(([provider, copyPlan]) => `
          <section class="copy-provider-card">
            ${entries.length > 1
              ? `
                <label class="copy-provider-pick">
                  <input
                    type="radio"
                    name="selected-copy-provider"
                    value="${escapeHtml(provider)}"
                    ${provider === selectedProvider ? "checked" : ""}
                  >
                  <span>Use ${escapeHtml(provider)} copy</span>
                </label>
              `
              : `
                <div class="copy-provider-pick">
                  <span>${escapeHtml(provider)} copy</span>
                </div>
              `}
            <div class="copy-block">
              <p class="copy-label">${escapeHtml(provider)} Title</p>
              <input id="edit-title-${escapeHtml(provider)}" value="${escapeHtml(copyPlan.title)}">
            </div>
            <div class="copy-block">
              <p class="copy-label">${escapeHtml(provider)} Description HTML</p>
              <textarea id="edit-description-html-${escapeHtml(provider)}" rows="8">${escapeHtml(copyPlan.descriptionHtml)}</textarea>
            </div>
            <div class="copy-block">
              <p class="copy-label">${escapeHtml(provider)} Tags</p>
              <textarea id="edit-tags-${escapeHtml(provider)}" rows="3">${escapeHtml((copyPlan.tags ?? []).join(", "))}</textarea>
            </div>
            <div class="copy-block">
              <p class="copy-label">${escapeHtml(provider)} SEO Title</p>
              <input id="edit-seo-title-${escapeHtml(provider)}" value="${escapeHtml(copyPlan.seoTitle)}">
            </div>
            <div class="copy-block">
              <p class="copy-label">${escapeHtml(provider)} SEO Description</p>
              <textarea id="edit-seo-description-${escapeHtml(provider)}" rows="4">${escapeHtml(copyPlan.seoDescription)}</textarea>
            </div>
          </section>
        `)
        .join("")}
    </div>
  `;
}

function slugifyIdentifier(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";
}

function ratioClass(imageRatio) {
  return imageRatio === "1:1" ? "ratio-square" : "ratio-landscape";
}

function isImageApprovedForUpload(image) {
  return image?.approvedForUpload === true;
}

function getFirstApprovedProvider(slotImages) {
  return slotImages.find((image) => isImageApprovedForUpload(image))?.provider || "";
}

function renderValidationWarning(image) {
  const warning =
    image.validationWarning ||
    (!isImageApprovedForUpload(image)
      ? "Automated validation did not approve this image."
      : "");

  if (!warning) {
    return "";
  }

  const prefix = isImageApprovedForUpload(image)
    ? "Review carefully"
    : "Blocked from Shopify upload";

  return `<span class="validation-warning">${prefix}: ${escapeHtml(warning)}</span>`;
}

function assertImageApprovedForUpload(image, label) {
  if (!isImageApprovedForUpload(image)) {
    throw new Error(`${label} is not approved for Shopify upload.`);
  }
}

function renderBatchReview(items) {
  latestBatchItems = items ?? [];

  if (!latestBatchItems.length) {
    batchReviewOutput.textContent = "No batch generated yet.";
    batchReviewCard.classList.add("hidden");
    return;
  }

  batchReviewCard.classList.remove("hidden");
  batchReviewOutput.classList.remove("empty-state");
  batchReviewOutput.innerHTML = latestBatchItems
    .map((item, index) => {
      const itemKey = escapeHtml(item.itemKey || `item-${index + 1}`);
      if (item.error) {
        return `
          <section class="batch-item-card batch-item-error">
            <div class="batch-item-topbar">
              <div>
                <h4>${escapeHtml(item.reference)}</h4>
                <p class="batch-meta">Generation failed</p>
              </div>
            </div>
            <div class="error">${escapeHtml(item.error)}</div>
          </section>
        `;
      }

      const copyPlans = Object.entries(item.copyPlans ?? {});
      const isCollectionSizeGuide =
        item.draftPayload?.sourceMode === "bulk-collection-size-guides";
      const isImageAppend = item.draftPayload?.mode === "existing-image-append";
      const selectedCopyProvider = item.selectedCopyProvider || copyPlans[0]?.[0] || "openai";
      const imagesBySlot = new Map();
      for (const image of item.generatedImages ?? []) {
        const slotImages = imagesBySlot.get(image.slot) ?? [];
        slotImages.push(image);
        imagesBySlot.set(image.slot, slotImages);
      }

      return `
        <section class="batch-item-card" data-item-key="${itemKey}">
          <div class="batch-item-topbar">
            <label class="batch-include-toggle">
              <input type="checkbox" id="batch-include-${itemKey}" checked>
              <span>${isCollectionSizeGuide ? "Include size guide upload" : isImageAppend ? "Include in image append" : "Include in draft creation"}</span>
            </label>
            <div class="batch-meta-group">
              <strong>${escapeHtml(item.existingProduct?.title || item.reference)}</strong>
              <span class="batch-meta">${escapeHtml(item.reference)}</span>
            </div>
          </div>

          <div class="batch-summary-grid">
            <div class="batch-summary-card">
              <span class="batch-summary-label">Handle</span>
              <span>${escapeHtml(item.existingProduct?.handle || "Unknown")}</span>
            </div>
            <div class="batch-summary-card">
              <span class="batch-summary-label">Status</span>
              <span>${escapeHtml(item.existingProduct?.status || "Unknown")}</span>
            </div>
            <div class="batch-summary-card">
              <span class="batch-summary-label">Type</span>
              <span>${escapeHtml(item.existingProduct?.productType || "Unknown")}</span>
            </div>
          </div>

          ${isImageAppend
            ? ""
            : `
              <div class="copy-provider-grid">
                ${copyPlans
                  .map(([provider, copyPlan]) => `
                    <section class="copy-provider-card">
                      ${copyPlans.length > 1
                        ? `
                          <label class="copy-provider-pick">
                            <input
                              type="radio"
                              name="batch-selected-copy-provider-${itemKey}"
                              value="${escapeHtml(provider)}"
                              ${provider === selectedCopyProvider ? "checked" : ""}
                            >
                            <span>Use ${escapeHtml(provider)} copy</span>
                          </label>
                        `
                        : `
                          <div class="copy-provider-pick">
                            <span>${escapeHtml(provider)} copy</span>
                          </div>
                        `}
                      <div class="copy-block">
                        <p class="copy-label">${escapeHtml(provider)} Title</p>
                        <input id="batch-edit-title-${itemKey}-${escapeHtml(provider)}" value="${escapeHtml(copyPlan.title)}">
                      </div>
                      <div class="copy-block">
                        <p class="copy-label">${escapeHtml(provider)} Description HTML</p>
                        <textarea id="batch-edit-description-html-${itemKey}-${escapeHtml(provider)}" rows="8">${escapeHtml(copyPlan.descriptionHtml)}</textarea>
                      </div>
                      <div class="copy-block">
                        <p class="copy-label">${escapeHtml(provider)} Tags</p>
                        <textarea id="batch-edit-tags-${itemKey}-${escapeHtml(provider)}" rows="3">${escapeHtml((copyPlan.tags ?? []).join(", "))}</textarea>
                      </div>
                      <div class="copy-block">
                        <p class="copy-label">${escapeHtml(provider)} SEO Title</p>
                        <input id="batch-edit-seo-title-${itemKey}-${escapeHtml(provider)}" value="${escapeHtml(copyPlan.seoTitle)}">
                      </div>
                      <div class="copy-block">
                        <p class="copy-label">${escapeHtml(provider)} SEO Description</p>
                        <textarea id="batch-edit-seo-description-${itemKey}-${escapeHtml(provider)}" rows="4">${escapeHtml(copyPlan.seoDescription)}</textarea>
                      </div>
                    </section>
                  `)
                  .join("")}
              </div>
            `}

          <div class="batch-images">
            ${Array.from(imagesBySlot.entries())
              .map(([slot, slotImages]) => {
                const firstProvider = getFirstApprovedProvider(slotImages);
                const slotOptionsClass = `slot-options ${slotImages.length === 1 ? "slot-options-one-engine" : ""}`;
                return `
                  <section class="slot-group">
                    <div class="slot-group-header">
                      <h4>${escapeHtml(slot)}</h4>
                      <small>${isCollectionSizeGuide ? "Select the size guide to upload to this Shopify product." : "Select the images that should go to Shopify for this product."}</small>
                    </div>
                    <div class="${slotOptionsClass}">
                      ${slotImages
                        .map(
                          (image) => {
                            const approved = isImageApprovedForUpload(image);
                            const selectable = approved || isCollectionSizeGuide;
                            const checked = isCollectionSizeGuide
                              ? true
                              : isImageAppend
                              ? approved
                              : approved && image.provider === firstProvider;
                            return `
                            <label class="image-choice">
                              <input
                                type="checkbox"
                                name="${isImageAppend ? `batch-image-append-choice-${itemKey}` : `batch-slot-choice-${itemKey}-${escapeHtml(slot)}`}"
                                value="${escapeHtml(image.provider)}::${escapeHtml(image.slot)}"
                                ${checked ? "checked" : ""}
                                ${selectable ? "" : "disabled"}
                              >
                              <figure class="image-card ${ratioClass(image.imageRatio)} ${approved ? "" : "image-card-blocked"}">
                                <div class="image-select-bar">
                                  <span class="select-indicator" aria-hidden="true"></span>
                                  <span class="select-label-selected">${isImageAppend ? "Selected to add" : "Selected for Shopify"}</span>
                                  <span class="select-label-idle">${selectable ? (isImageAppend ? "Add this image" : "Select this image") : "Blocked from upload"}</span>
                                  <span class="provider-chip">${escapeHtml(image.provider)}</span>
                                </div>
                                <img src="${image.url}" alt="${escapeHtml(image.slot)} ${escapeHtml(image.provider)}">
                                <figcaption>
                                  <strong>${escapeHtml(image.slot)}</strong>
                                  <a href="${escapeHtml(image.url)}" target="_blank" rel="noreferrer">Open image</a>
                                  ${renderValidationWarning(image)}
                                  <span>${escapeHtml(image.prompt)}</span>
                                </figcaption>
                              </figure>
                            </label>
                          `;
                          }
                        )
                        .join("")}
                    </div>
                  </section>
                `;
              })
              .join("")}
          </div>
        </section>
      `;
    })
    .join("");
}

function getSelectedCopyProvider() {
  return (
    document.querySelector('input[name="selected-copy-provider"]:checked')?.value ||
    Object.keys(latestCopyPlans)[0] ||
    "openai"
  );
}

function renderImages(images) {
  if (!images.length) {
    imageGrid.textContent = "No generated images yet.";
    imageGrid.classList.add("empty-state");
    imageSelectionHelp.classList.add("hidden");
    return;
  }

  const imagesBySlot = new Map();
  for (const image of images) {
    const slotImages = imagesBySlot.get(image.slot) ?? [];
    slotImages.push(image);
    imagesBySlot.set(image.slot, slotImages);
  }

  imageGrid.classList.remove("empty-state");
  imageSelectionHelp.classList.remove("hidden");
  imageGrid.innerHTML = Array.from(imagesBySlot.entries())
    .map(([slot, slotImages]) => {
      const firstProvider = getFirstApprovedProvider(slotImages);
      const slotOptionsClass = `slot-options ${slotImages.length === 1 ? "slot-options-one-engine" : ""}`;
      return `
        <section class="slot-group">
          <div class="slot-group-header">
            <h4>${escapeHtml(slot)}</h4>
            <small>Select this image if it should go to Shopify for this slot.</small>
          </div>
          <div class="${slotOptionsClass}">
            ${slotImages
              .map(
                (image) => {
                  const approved = isImageApprovedForUpload(image);
                  const checked = approved && image.provider === firstProvider;
                  return `
                  <label class="image-choice">
                    <input
                      type="checkbox"
                      name="slot-choice-${escapeHtml(slot)}"
                      value="${escapeHtml(image.provider)}::${escapeHtml(image.slot)}"
                      ${checked ? "checked" : ""}
                      ${approved ? "" : "disabled"}
                    >
                    <figure class="image-card ${ratioClass(image.imageRatio)} ${approved ? "" : "image-card-blocked"}">
                      <div class="image-select-bar">
                        <span class="select-indicator" aria-hidden="true"></span>
                        <span class="select-label-selected">Selected for Shopify</span>
                        <span class="select-label-idle">${approved ? "Select this image" : "Blocked from upload"}</span>
                        <span class="provider-chip">${escapeHtml(image.provider)}</span>
                      </div>
                      <img src="${image.url}" alt="${image.slot} ${image.provider}">
                      <figcaption>
                        <strong>${image.slot}</strong>
                        ${renderValidationWarning(image)}
                        <span>${image.prompt}</span>
                      </figcaption>
                    </figure>
                  </label>
                `;
                }
              )
              .join("")}
          </div>
        </section>
      `;
    })
    .join("");
}

function updateModeUI() {
  const isExistingMode = modeField.value !== "new";
  const isAppendMode = modeField.value === "existing-append";
  const isBulkImageAppendMode = modeField.value === "bulk-existing-image-append";
  const isBulkCollectionSizeGuideMode = modeField.value === "bulk-collection-size-guides";
  const isBulkMode =
    modeField.value === "bulk-existing-duplicate" ||
    isBulkImageAppendMode ||
    isBulkCollectionSizeGuideMode;
  existingProductReferenceField.classList.toggle("hidden", isBulkMode || !isExistingMode);
  bulkExistingProductReferencesField.classList.toggle(
    "hidden",
    !isBulkMode || isBulkCollectionSizeGuideMode
  );
  bulkCollectionHandlesField.classList.toggle("hidden", !isBulkCollectionSizeGuideMode);
  newProductStatusField.classList.toggle("hidden", isExistingMode);
  newProductStatusInput.disabled = isExistingMode;
  existingProductReferenceInput.required = isExistingMode && !isBulkMode;
  bulkExistingProductReferencesInput.required = isBulkMode && !isBulkCollectionSizeGuideMode;
  bulkCollectionHandlesInput.required = isBulkCollectionSizeGuideMode;
  imageRatioInput.required = true;
  imagesInput.required = !isExistingMode;
  imagesInput.disabled = isBulkMode;
  kindInput.required = !isExistingMode;
  priceInput.required = !isExistingMode;
  costInput.required = !isExistingMode;
  heightInput.required = !isExistingMode;
  widthInput.required = !isExistingMode;
  kindInput.disabled = isExistingMode;
  priceInput.disabled = isExistingMode;
  costInput.disabled = isExistingMode;
  heightInput.disabled = isExistingMode;
  widthInput.disabled = isExistingMode;
  imagesHelp.textContent = isBulkMode
    ? isBulkCollectionSizeGuideMode
      ? "Collection size-guide mode scans active Shopify products and uses each product's original Admin images."
      : "Bulk mode uses the original Shopify Admin images from each product."
    : isExistingMode
    ? "Optional. If omitted, the app uses the product's original Shopify Admin images."
    : "Upload 1-6 bouquet photos.";
  kindHelp.classList.toggle("hidden", !isExistingMode);
  priceHelp.classList.toggle("hidden", !isExistingMode);
  costHelp.classList.toggle("hidden", !isExistingMode);
  heightHelp.classList.toggle("hidden", !isExistingMode);
  widthHelp.classList.toggle("hidden", !isExistingMode);
  createDraftButton.classList.toggle("hidden", isAppendMode);
  overwriteExistingButton.classList.toggle("hidden", !isAppendMode);
  createDraftButton.textContent = isBulkMode
    ? isBulkCollectionSizeGuideMode
      ? "Upload Selected Size Guides to Shopify"
      : isBulkImageAppendMode
      ? "Add Selected Images to Existing Products"
      : "Create Selected Drafts"
    : "Create Product";
  if (!isExistingMode) {
    renderExistingProductSummary(null);
  }
  if (!isBulkMode) {
    batchReviewCard.classList.add("hidden");
    latestBatchMode = "";
  }
}

function getSelectedNewProductStatus() {
  const status = String(newProductStatusInput.value || "DRAFT").trim().toUpperCase();
  return NEW_PRODUCT_STATUSES.has(status) ? status : "DRAFT";
}

function syncLatestNewProductStatus() {
  if (latestDraftPayload?.mode !== "new") {
    return;
  }

  latestDraftPayload = {
    ...latestDraftPayload,
    status: getSelectedNewProductStatus()
  };
  payloadOutput.textContent = JSON.stringify(latestDraftPayload, null, 2);
}

function collectEditedPayload() {
  if (!latestDraftPayload) {
    return null;
  }

  const provider = getSelectedCopyProvider();
  const title =
    document.querySelector(`#edit-title-${CSS.escape(provider)}`)?.value?.trim() ||
    latestDraftPayload.title;
  const descriptionHtml =
    document.querySelector(`#edit-description-html-${CSS.escape(provider)}`)?.value ??
    latestDraftPayload.descriptionHtml;
  const seoTitle =
    document.querySelector(`#edit-seo-title-${CSS.escape(provider)}`)?.value?.trim() ||
    latestDraftPayload.seo?.title ||
    "";
  const seoDescription =
    document.querySelector(`#edit-seo-description-${CSS.escape(provider)}`)?.value?.trim() ||
    latestDraftPayload.seo?.description ||
    "";
  const tags =
    (document.querySelector(`#edit-tags-${CSS.escape(provider)}`)?.value ?? "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

  return {
    ...latestDraftPayload,
    selectedCopyProvider: provider,
    title,
    descriptionHtml,
    tags,
    seo: {
      title: seoTitle,
      description: seoDescription
    }
  };
}

function getSelectedDraftMedia({ requireMedia = false } = {}) {
  const selected = [];
  const selectedInputs = [
    ...document.querySelectorAll('input[name^="slot-choice-"]:checked')
  ];

  for (const selectedInput of selectedInputs) {
    const [provider, selectedSlot] = selectedInput.value.split("::");
    const selectedImage = latestGeneratedImages.find(
      (image) => image.provider === provider && image.slot === selectedSlot
    );
    if (!selectedImage) {
      throw new Error(`Could not resolve the selected image for ${selectedSlot}.`);
    }

    assertImageApprovedForUpload(selectedImage, `Selected image for ${selectedSlot}`);
    selected.push(selectedImage);
  }

  if (requireMedia && !selected.length) {
    throw new Error("Select at least one image before overwriting existing media.");
  }

  return selected;
}

function collectEditedBatchPayloads() {
  const selectedItems = [];

  for (const item of latestBatchItems) {
    if (item.error) {
      continue;
    }

    const itemKey = item.itemKey;
    const includeItem = document.querySelector(`#batch-include-${CSS.escape(itemKey)}`);
    if (!includeItem?.checked) {
      continue;
    }

    const provider =
      document.querySelector(
        `input[name="batch-selected-copy-provider-${CSS.escape(itemKey)}"]:checked`
      )?.value || item.selectedCopyProvider || Object.keys(item.copyPlans ?? {})[0];
    const isCollectionSizeGuide =
      item.draftPayload?.sourceMode === "bulk-collection-size-guides";
    const isImageAppend = item.draftPayload?.mode === "existing-image-append";

    const title = isImageAppend
      ? item.draftPayload.title
      : document.querySelector(
          `#batch-edit-title-${CSS.escape(itemKey)}-${CSS.escape(provider)}`
        )?.value?.trim() || item.draftPayload.title;
    const descriptionHtml = isImageAppend
      ? item.draftPayload.descriptionHtml
      : document.querySelector(
          `#batch-edit-description-html-${CSS.escape(itemKey)}-${CSS.escape(provider)}`
        )?.value ?? item.draftPayload.descriptionHtml;
    const seoTitle = isImageAppend
      ? item.draftPayload.seo?.title || ""
      : document.querySelector(
          `#batch-edit-seo-title-${CSS.escape(itemKey)}-${CSS.escape(provider)}`
        )?.value?.trim() || item.draftPayload.seo?.title || "";
    const seoDescription = isImageAppend
      ? item.draftPayload.seo?.description || ""
      : document.querySelector(
          `#batch-edit-seo-description-${CSS.escape(itemKey)}-${CSS.escape(provider)}`
        )?.value?.trim() || item.draftPayload.seo?.description || "";
    const tags = isImageAppend
      ? item.draftPayload.tags ?? []
      : (document.querySelector(
          `#batch-edit-tags-${CSS.escape(itemKey)}-${CSS.escape(provider)}`
        )?.value ?? "")
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean);

    if (isImageAppend) {
      const selectedMedia = [
        ...document.querySelectorAll(
          `input[name="batch-image-append-choice-${CSS.escape(itemKey)}"]:checked`
        )
      ].map((selectedInput) => {
        const [selectedProvider, selectedSlot] = selectedInput.value.split("::");
        const selectedImage = (item.generatedImages ?? []).find(
          (image) => image.provider === selectedProvider && image.slot === selectedSlot
        );

        if (!selectedImage) {
          throw new Error(
            `Could not resolve the selected image for ${item.existingProduct?.title || item.reference}.`
          );
        }

        if (!isCollectionSizeGuide) {
          assertImageApprovedForUpload(
            selectedImage,
            `Selected image for ${item.existingProduct?.title || item.reference}`
          );
        }
        return selectedImage;
      });

      if (!selectedMedia.length) {
        throw new Error(
          `Select at least one image for ${item.existingProduct?.title || item.reference}.`
        );
      }

      selectedItems.push({
        ...item.draftPayload,
        selectedCopyProvider: provider,
        title,
        descriptionHtml,
        tags,
        seo: {
          title: seoTitle,
          description: seoDescription
        },
        media: selectedMedia
      });
      continue;
    }

    const selectedMedia = [
      ...document.querySelectorAll(
        `input[name^="batch-slot-choice-${CSS.escape(itemKey)}-"]:checked`
      )
    ].map((selectedInput) => {
      const [selectedProvider, selectedSlot] = selectedInput.value.split("::");
      const selectedImage = (item.generatedImages ?? []).find(
        (image) => image.provider === selectedProvider && image.slot === selectedSlot
      );

      if (!selectedImage) {
        throw new Error(`Could not resolve the selected image for ${item.existingProduct?.title || item.reference} / ${selectedSlot}.`);
      }

      assertImageApprovedForUpload(
        selectedImage,
        `Selected image for ${item.existingProduct?.title || item.reference} / ${selectedSlot}`
      );
      return selectedImage;
    });

    selectedItems.push({
      ...item.draftPayload,
      selectedCopyProvider: provider,
      title,
      descriptionHtml,
      tags,
      seo: {
        title: seoTitle,
        description: seoDescription
      },
      media: selectedMedia
    });
  }

  if (!selectedItems.length) {
    throw new Error("Select at least one batch item before creating drafts.");
  }

  return selectedItems;
}

async function loadConfig() {
  const response = await fetch("/api/config");
  const config = await response.json();
  if (config.hasOpenAiKey && config.hasShopifyCredentials && config.hasGeminiKey) {
    configBadge.textContent = "OpenAI copy + Gemini images + Shopify ready";
    return;
  }

  const missing = [];
  if (!config.hasOpenAiKey) {
    missing.push("OPENAI_API_KEY");
  }
  if (!config.hasGeminiKey) {
    missing.push("GEMINI_API_KEY");
  }
  if (!config.hasShopifyCredentials) {
    missing.push("Shopify credentials");
  }
  configBadge.textContent = `Missing: ${missing.join(", ")}`;
}

function setActionButtonsDisabled(disabled) {
  createDraftButton.disabled = disabled;
  overwriteExistingButton.disabled = disabled;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError();
  setActionButtonsDisabled(true);
  latestDraftPayload = null;
    latestGeneratedImages = [];
    latestCopyPlans = {};
    latestBatchItems = [];
    latestBatchMode = "";
  renderExistingProductSummary(null);
  batchReviewOutput.textContent = "No batch generated yet.";
  batchReviewOutput.classList.add("empty-state");
  batchReviewCard.classList.add("hidden");
  setStatus("Generating…");

  try {
    const formData = new FormData(form);
    const response = await fetch("/api/generate", {
      method: "POST",
      body: formData
    });
    const result = await readResponsePayload(response);
    if (!response.ok) {
      throw new Error(result.error || "Generation failed.");
    }

    if (result.batchItems) {
      latestDraftPayload = null;
      latestGeneratedImages = [];
      latestCopyPlans = {};
      latestBatchItems = result.batchItems;
      latestBatchMode = result.mode || "";
      renderCopy({}, "openai");
      renderExistingProductSummary(null);
      payloadOutput.textContent = JSON.stringify(result.summary ?? { batchItems: result.batchItems.length }, null, 2);
      imageGrid.textContent =
        latestBatchMode === "bulk-collection-size-guides"
          ? "Collection size-guide mode uses the review cards below. After review, selected approved size guides can be uploaded to the existing Shopify product galleries."
          : latestBatchMode === "bulk-existing-image-append"
          ? "Image append mode uses the review cards below. Approved images will be added to the existing product galleries only."
          : "Batch mode uses the review cards below for per-product image selection.";
      imageGrid.classList.add("empty-state");
      imageSelectionHelp.classList.add("hidden");
      renderBatchReview(result.batchItems);
    } else {
      latestCopyPlans = result.copyPlans ?? { [result.selectedCopyProvider || "openai"]: result.copyPlan };
      renderCopy(latestCopyPlans, result.selectedCopyProvider);
      renderExistingProductSummary(result.existingProduct);
      payloadOutput.textContent = JSON.stringify(result.draftPayload, null, 2);
      renderImages(result.generatedImages);
      latestDraftPayload = result.draftPayload;
      latestGeneratedImages = result.generatedImages;
    }
    setActionButtonsDisabled(false);
    setStatus("Ready");
  } catch (error) {
    showError(error.message);
    setStatus("Failed");
  }
});

async function executeWriteAction({ writeAction, replaceExistingMedia, statusText, successText, failureText, statusOverride }) {
  clearError();
  if (!latestDraftPayload && !latestBatchItems.length) {
    showError("Generate a product package first.");
    return;
  }

  setStatus(statusText);

  try {
    const isBatch = latestBatchItems.length > 0;
    const response = await fetch(isBatch ? "/api/draft/create-bulk" : "/api/draft/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(
        isBatch
          ? {
              items: collectEditedBatchPayloads()
            }
          : {
              ...collectEditedPayload(),
              writeAction,
              replaceExistingMedia,
              status: statusOverride ?? latestDraftPayload.status,
              media: getSelectedDraftMedia({ requireMedia: replaceExistingMedia })
            }
      )
    });
    const result = await readResponsePayload(response);
    if (!response.ok) {
      throw new Error(result.error || failureText);
    }

    payloadOutput.textContent = JSON.stringify(result, null, 2);
    setStatus(successText);
  } catch (error) {
    showError(error.message);
    setStatus(failureText);
  }
}

createDraftButton.addEventListener("click", async () => {
  const isBulkImageAppend = latestBatchMode === "bulk-existing-image-append";
  const isBulkCollectionSizeGuides = latestBatchMode === "bulk-collection-size-guides";
  const newProductStatusOverride =
    latestDraftPayload?.mode === "new" ? getSelectedNewProductStatus() : undefined;
  await executeWriteAction({
    writeAction: isBulkImageAppend || isBulkCollectionSizeGuides ? "append-images-only" : "create-draft",
    replaceExistingMedia: false,
    statusText: isBulkCollectionSizeGuides
      ? "Uploading size guides to Shopify…"
      : isBulkImageAppend
      ? "Adding images to existing products…"
      : "Creating product…",
    successText: isBulkCollectionSizeGuides
      ? "Size guides uploaded"
      : isBulkImageAppend
      ? "Images added"
      : "Product created",
    failureText: isBulkCollectionSizeGuides
      ? "Size guide upload failed"
      : isBulkImageAppend
      ? "Image append failed"
      : "Product creation failed",
    statusOverride: newProductStatusOverride
  });
});

overwriteExistingButton.addEventListener("click", async () => {
  await executeWriteAction({
    writeAction: "overwrite-existing",
    replaceExistingMedia: true,
    statusText: "Overwriting existing listing…",
    successText: "Existing listing overwritten",
    failureText: "Overwrite failed",
    statusOverride: latestExistingProduct?.status || latestDraftPayload?.status || "DRAFT"
  });
});

modeField.addEventListener("change", updateModeUI);
newProductStatusInput.addEventListener("change", syncLatestNewProductStatus);
updateModeUI();

loadConfig().catch((error) => {
  configBadge.textContent = `Config error: ${error.message}`;
});

themeLightButton.addEventListener("click", () => {
  setTheme("light");
});

themeDarkButton.addEventListener("click", () => {
  setTheme("dark");
});

applyTheme(getPreferredTheme());
