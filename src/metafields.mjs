function stringifyRichTextDocument(document) {
  return JSON.stringify(document);
}

export function buildDescriptionRichText(descriptionHtml) {
  if (!descriptionHtml) {
    return "";
  }

  const normalized = descriptionHtml
    .replace(/<\/p>\s*<p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\r/g, "")
    .trim();

  if (!normalized) {
    return "";
  }

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => ({
      type: "paragraph",
      children: [
        {
          type: "text",
          value: paragraph
        }
      ]
    }));

  return stringifyRichTextDocument({
    type: "root",
    children: paragraphs
  });
}

export function buildDimensionsRichText({ kind, heightCm, widthCm }) {
  const isSet = kind === "set";
  const heading = isSet ? "מידות הסט (עם אגרטל):" : "מידות הסידור:";
  const sizeLine = `\nגובה: ${heightCm} ס״מ | רוחב: ${widthCm} ס״מ`;
  const textNode = {
    type: "text",
    value: heading,
    bold: true
  };
  const children = [
    textNode,
    {
      type: "text",
      value: sizeLine
    }
  ];

  if (isSet) {
    children.push({
      type: "text",
      value: "\nהאגרטל כלול עם הסט."
    });
  }

  return stringifyRichTextDocument({
    type: "root",
    children: [
      {
        type: "paragraph",
        children
      }
    ]
  });
}

export function buildWorkflowMetafields({ kind, heightCm, widthCm }) {
  const metafields = [];

  if (Number.isInteger(heightCm) && Number.isInteger(widthCm)) {
    metafields.push(
      {
        namespace: "custom",
        key: "dimensions",
        type: "rich_text_field",
        value: buildDimensionsRichText({ kind, heightCm, widthCm })
      },
      {
        namespace: "custom",
        key: "height",
        type: "number_integer",
        value: String(heightCm)
      },
      {
        namespace: "custom",
        key: "width",
        type: "number_integer",
        value: String(widthCm)
      }
    );
  }

  return metafields;
}
