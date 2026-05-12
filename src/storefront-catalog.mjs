function buildProductsJsonUrl(origin, page, limit) {
  const url = new URL("/products.json", origin);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("page", String(page));
  return url;
}

const WEBSITE_CONTEXT_PROBES = {
  homepageBrandPhrases: [
    "סידור שנשמר על צורתו וצבעו למשך ארבעה חודשים",
    "כל סידור מעוצב בסטודיו מתוך מחשבה על הבית"
  ],
  carePhrases: [
    "היופי נשמר למשך 100 ימים לפחות",
    "אין צורך בהשקיה",
    "יש למקם הרחק מאור שמש ישיר ולחות",
    "יש להימנע ממגע מיותר"
  ],
  deliveryPhrases: [
    "נמסר ע״י שליח אישי מטעם Forever Flowers עד פתח הדלת",
    "מעוצב ומוכן להנחה"
  ],
  returnPhrases: [
    "אפשר לבקש החזרה או החלפה בתוך 24 שעות"
  ]
};

let websiteContextCache = null;

export async function discoverStorefrontOrigin(storeDomain) {
  const response = await fetch(`https://${storeDomain}`, {
    redirect: "follow"
  });

  if (!response.ok) {
    throw new Error(
      `Storefront discovery failed with ${response.status} for ${storeDomain}.`
    );
  }

  const url = new URL(response.url);
  return `${url.protocol}//${url.host}`;
}

export async function fetchStorefrontProducts({
  origin,
  page = 1,
  limit = 20
}) {
  const response = await fetch(buildProductsJsonUrl(origin, page, limit));

  if (!response.ok) {
    throw new Error(
      `Storefront products.json request failed with ${response.status}.`
    );
  }

  const payload = await response.json();
  return payload.products ?? [];
}

async function fetchProductHtml(origin, handle) {
  const response = await fetch(new URL(`/products/${handle}`, origin));
  if (!response.ok) {
    throw new Error(
      `Failed to fetch product page for ${handle}: ${response.status}.`
    );
  }

  return response.text();
}

async function fetchPageHtml(origin, pathname = "/") {
  const response = await fetch(new URL(pathname, origin));
  if (!response.ok) {
    throw new Error(`Failed to fetch page ${pathname}: ${response.status}.`);
  }

  return response.text();
}

async function fetchAbsoluteHtml(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch absolute page ${url}: ${response.status}.`);
  }

  return response.text();
}

async function fetchXml(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch XML ${url}: ${response.status}.`);
  }

  return response.text();
}

function decodeXmlLoc(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractXmlLocs(xml) {
  return [...xml.matchAll(/<loc>(.*?)<\/loc>/gsi)].map((match) =>
    decodeXmlLoc(match[1].trim())
  );
}

async function fetchSitemapUrls(origin) {
  const rootSitemapUrl = new URL("/sitemap.xml", origin).toString();
  const rootXml = await fetchXml(rootSitemapUrl);
  const rootLocs = extractXmlLocs(rootXml);

  const sameOriginSitemaps = rootLocs.filter((loc) => loc.endsWith(".xml"));
  if (!sameOriginSitemaps.length) {
    return rootLocs.filter((loc) => !loc.endsWith(".xml"));
  }

  const nestedXmlDocs = await mapWithConcurrency(
    sameOriginSitemaps,
    4,
    async (loc) => fetchXml(loc)
  );

  return nestedXmlDocs.flatMap((xml) => extractXmlLocs(xml));
}

async function fetchAllStorefrontProducts(origin) {
  const collected = [];

  for (let page = 1; page <= 20; page += 1) {
    const products = await fetchStorefrontProducts({
      origin,
      page,
      limit: 250
    });

    if (!products.length) {
      break;
    }

    collected.push(...products);

    if (products.length < 250) {
      break;
    }
  }

  return collected;
}

function countPhraseMatches(htmlPages, probes) {
  const counts = new Map(
    probes.map((probe) => [probe, 0])
  );

  for (const html of htmlPages) {
    for (const probe of probes) {
      if (html.includes(probe)) {
        counts.set(probe, (counts.get(probe) ?? 0) + 1);
      }
    }
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 0)
    .map(([phrase, count]) => ({ phrase, count }));
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(
    Array.from({ length: workerCount }, () => worker())
  );

  return results;
}

function summarizeKeywordBlocks(html) {
  const probes = [
    "מידות",
    "משלוחים",
    "החזרות",
    "הוראות טיפול",
    "קצת על הפרחים",
    "מהרגע שההזמנה התקבלה"
  ];

  return probes.filter((probe) => html.includes(probe));
}

function countValues(items) {
  const counts = new Map();
  for (const item of items) {
    if (!item) {
      continue;
    }

    counts.set(item, (counts.get(item) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([value, count]) => ({ value, count }));
}

export async function analyzeCatalog({
  storeDomain,
  storefrontOrigin,
  sampleSize = 12,
  pageBlockSample = 3
}) {
  const origin =
    storefrontOrigin && storefrontOrigin.length > 0
      ? storefrontOrigin
      : await discoverStorefrontOrigin(storeDomain);
  const products = await fetchStorefrontProducts({
    origin,
    limit: sampleSize
  });

  const pageSamples = [];
  for (const product of products.slice(0, pageBlockSample)) {
    const html = await fetchProductHtml(origin, product.handle);
    pageSamples.push({
      handle: product.handle,
      title: product.title,
      detectedBlocks: summarizeKeywordBlocks(html)
    });
  }

  return {
    analyzedAt: new Date().toISOString(),
    storefrontOrigin: origin,
    sampleSize: products.length,
    vendors: countValues(products.map((product) => product.vendor)),
    productTypes: countValues(products.map((product) => product.product_type)),
    optionNames: countValues(
      products.flatMap((product) =>
        [product.options ?? []].flat().flatMap((option) => option.name || [])
      )
    ),
    tagFrequency: countValues(
      products.flatMap((product) => product.tags || [])
    ).slice(0, 20),
    pageSamples,
    products: products.map((product) => ({
      id: product.id,
      handle: product.handle,
      title: product.title,
      vendor: product.vendor,
      productType: product.product_type,
      publishedAt: product.published_at,
      imageCount: product.images?.length ?? 0,
      variantCount: product.variants?.length ?? 0,
      tags: product.tags ?? [],
      options: (product.options ?? []).map((option) => option.name)
    }))
  };
}

export async function fetchWebsiteCopyContext({
  storeDomain,
  storefrontOrigin,
  maxAgeMs = 1000 * 60 * 60 * 6
}) {
  if (
    websiteContextCache &&
    Date.now() - websiteContextCache.fetchedAt < maxAgeMs
  ) {
    return websiteContextCache.value;
  }

  const origin =
    storefrontOrigin && storefrontOrigin.length > 0
      ? storefrontOrigin
      : await discoverStorefrontOrigin(storeDomain);

  const homepageHtml = await fetchPageHtml(origin, "/");
  const sitemapUrls = await fetchSitemapUrls(origin);
  const products = await fetchAllStorefrontProducts(origin);
  const relevantProducts = products.filter((product) =>
    ["סט מעוצב", "סידור מעוצב"].includes(product.product_type)
  );

  const productHtmlPages = await mapWithConcurrency(
    relevantProducts.map((product) => product.handle),
    5,
    async (handle) => fetchProductHtml(origin, handle)
  );
  const auxiliaryUrls = sitemapUrls
    .filter((loc) => loc.startsWith(origin))
    .filter((loc) => !loc.endsWith(".xml"))
    .filter((loc) => !loc.includes("/products/"))
    .filter((loc) => !loc.includes("/products_preview"))
    .slice(0, 40);
  const auxiliaryHtmlPages = await mapWithConcurrency(
    auxiliaryUrls,
    4,
    async (url) => fetchAbsoluteHtml(url)
  );

  const allHtml = [homepageHtml, ...productHtmlPages, ...auxiliaryHtmlPages];
  const value = {
    fetchedAt: new Date().toISOString(),
    storefrontOrigin: origin,
    sitemapUrlCount: sitemapUrls.length,
    auxiliaryUrlCount: auxiliaryUrls.length,
    productCount: products.length,
    relevantProductCount: relevantProducts.length,
    homepageBrandPhrases: countPhraseMatches(
      [homepageHtml],
      WEBSITE_CONTEXT_PROBES.homepageBrandPhrases
    ),
    carePhrases: countPhraseMatches(
      allHtml,
      WEBSITE_CONTEXT_PROBES.carePhrases
    ),
    deliveryPhrases: countPhraseMatches(
      allHtml,
      WEBSITE_CONTEXT_PROBES.deliveryPhrases
    ),
    returnPhrases: countPhraseMatches(
      allHtml,
      WEBSITE_CONTEXT_PROBES.returnPhrases
    ),
    forbiddenPhrases: [
      "ניקוי אבק",
      "אבק",
      "הסרת אבק"
    ],
    preferredClaims: [
      "היופי נשמר למשך 100 ימים לפחות",
      "סידור שנשמר על צורתו וצבעו למשך ארבעה חודשים",
      "אין צורך בהשקיה",
      "יש למקם הרחק מאור שמש ישיר ולחות",
      "יש להימנע ממגע מיותר"
    ],
    relevantTitles: relevantProducts.map((product) => product.title)
  };

  websiteContextCache = {
    fetchedAt: Date.now(),
    value
  };

  return value;
}
