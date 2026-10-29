import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

export function renderMarkdown(markdown: string) {
  return sanitizeHtml(marked.parse(markdown, { async: false, gfm: true }), {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, "img"],
    allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, a: ["href", "title", "rel"], img: ["src", "alt", "title", "loading"] },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noreferrer noopener" }),
      img: sanitizeHtml.simpleTransform("img", { loading: "lazy" }),
    },
  });
}

export function plainText(markdown: string) {
  return sanitizeHtml(marked.parse(markdown, { async: false }), { allowedTags: [], allowedAttributes: {} })
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
}
