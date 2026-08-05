/**
 * Sanitize provider rich text (Azure DevOps stores Description and Acceptance
 * Criteria as HTML) into something safe to render.
 *
 * Why not keep converting it to plain text, as this app did before: a real
 * acceptance-criteria field is a *structured* document — a numbered list with
 * lettered sub-items, bold terms, links and screenshots. Flattening it to lines
 * dropped the nesting, the numbering and the images, which is exactly the part a
 * developer needs in order to read a requirement correctly.
 *
 * This is a strict allowlist, not a filter of "bad" things: the tokenizer emits
 * a tag only when its name is on the list, and an attribute only when that
 * attribute is allowed on that tag and its value passes the value check. Anything
 * else — `<script>`, `<style>`, `<iframe>`, every `on*` handler, `style`, `class`,
 * `id`, `javascript:` and `data:` URLs — is dropped rather than escaped, because
 * an unrecognised construct should disappear, never survive in some other form.
 * `<script>` and `<style>` bodies are removed with their content.
 */

// Tags kept, mapped to the attributes allowed on them.
const ALLOWED: Record<string, string[]> = {
  p: [], br: [], div: [], span: [], hr: [],
  strong: [], b: [], em: [], i: [], u: [], s: [], strike: [], sub: [], sup: [], mark: [],
  h1: [], h2: [], h3: [], h4: [], h5: [], h6: [],
  ul: [], ol: ["start", "type"], li: ["value"],
  blockquote: [], pre: [], code: [],
  a: ["href", "title"],
  img: ["src", "alt", "title", "width", "height"],
  table: [], thead: [], tbody: [], tfoot: [], tr: [],
  th: ["colspan", "rowspan"], td: ["colspan", "rowspan"],
};

const VOID_TAGS = new Set(["br", "hr", "img"]);

// Elements whose *content* goes with them — escaping the body of a <script>
// would leave the payload visible as text, which is not what "removed" means.
const DROP_WITH_CONTENT = new Set(["script", "style", "iframe", "object", "embed", "svg", "math"]);

function escapeText(s: string): string {
  return s.replace(/&(?!#?\w+;)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Only absolute http(s)/mailto links survive. Relative URLs are dropped too:
 *  provider HTML is rendered inside *this* app, where a relative path points at
 *  our own routes rather than the tracker's. */
function safeUrl(raw: string): string | null {
  // Strip control and whitespace characters anywhere in the value: "java	script:"
  // is a real bypass, and no legitimate URL contains them.
  const v = raw.replace(/[\x00-\x20]/g, "");
  if (/^(https?:|mailto:)/i.test(v)) return v;
  return null;
}

export type SanitizeOptions = {
  /** Rewrites every surviving `img` src — used to route provider attachments,
   *  which need a token the browser does not have, through our own proxy. */
  rewriteImageSrc?: (src: string) => string | null;
};

export function sanitizeHtml(input: string, opts: SanitizeOptions = {}): string {
  if (!input) return "";
  const out: string[] = [];
  const open: string[] = [];
  // Tag | comment | text. Attributes are parsed from the captured tag body below.
  const token = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|[^<]+/g;

  let m: RegExpExecArray | null;
  let skipUntil = "";
  while ((m = token.exec(input))) {
    const chunk = m[0];

    if (chunk.startsWith("<!--")) continue;

    if (!chunk.startsWith("<")) {
      if (!skipUntil) out.push(escapeText(chunk));
      continue;
    }

    const name = (m[1] ?? "").toLowerCase();
    const closing = chunk.startsWith("</");

    // Inside a dropped element: swallow everything up to its own close tag.
    if (skipUntil) {
      if (closing && name === skipUntil) skipUntil = "";
      continue;
    }
    if (DROP_WITH_CONTENT.has(name)) {
      if (!closing && !chunk.endsWith("/>")) skipUntil = name;
      continue;
    }
    if (!(name in ALLOWED)) continue;

    if (closing) {
      const i = open.lastIndexOf(name);
      if (i === -1) continue; // stray close tag
      // Close anything left open inside it, so the output stays well-formed.
      while (open.length > i) out.push(`</${open.pop()}>`);
      continue;
    }

    const attrs = readAttrs(m[2] ?? "", name, opts);
    if (name === "img" && !/ src="/.test(attrs)) continue; // an image we can't load is noise
    out.push(`<${name}${attrs}>`);
    if (!VOID_TAGS.has(name) && !chunk.endsWith("/>")) open.push(name);
  }
  while (open.length) out.push(`</${open.pop()}>`);

  return out.join("").replace(/(?:<p>\s*<\/p>|<div>\s*<\/div>)/g, "").trim();
}

function readAttrs(raw: string, tag: string, opts: SanitizeOptions): string {
  const allowed = ALLOWED[tag];
  if (!allowed.length) return "";
  const parts: string[] = [];
  const attr = /([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let a: RegExpExecArray | null;
  while ((a = attr.exec(raw))) {
    const key = a[1].toLowerCase();
    if (!allowed.includes(key)) continue;
    let value = (a[2] ?? a[3] ?? a[4] ?? "").trim();

    if (key === "href") {
      const safe = safeUrl(value);
      if (!safe) continue;
      value = safe;
    } else if (key === "src") {
      const safe = safeUrl(value);
      if (!safe) continue;
      const rewritten = opts.rewriteImageSrc ? opts.rewriteImageSrc(safe) : safe;
      if (!rewritten) continue;
      value = rewritten;
    } else if (["width", "height", "colspan", "rowspan", "start", "value"].includes(key)) {
      if (!/^\d{1,5}$/.test(value)) continue;
    } else if (value.length > 300) {
      continue;
    }
    parts.push(` ${key}="${value.replace(/"/g, "&quot;")}"`);
  }
  // Links leave the app — never hand a target="_blank" opener to the tracker.
  if (tag === "a" && parts.some((p) => p.startsWith(" href="))) {
    parts.push(' target="_blank"', ' rel="noopener noreferrer"');
  }
  return parts.join("");
}

/**
 * Minimal Markdown → HTML, for providers that store rich text as Markdown
 * (GitHub issue bodies) rather than HTML (Azure DevOps).
 *
 * Deliberately small: it covers what a requirement is actually written with —
 * headings, nested ordered/unordered lists incl. task lists, code (fenced and
 * inline), blockquotes, links, images, bold/italic — and nothing else. The
 * output goes through `sanitizeHtml()` like any provider markup, so a body that
 * mixes in raw HTML is held to the same allowlist.
 */
export function markdownToHtml(md: string, opts: SanitizeOptions = {}): string {
  if (!md.trim()) return "";
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  // Each entry is one open list level: its tag plus the indent that opened it.
  const lists: Array<{ tag: "ul" | "ol"; indent: number }> = [];
  let inCode = false;
  let para: string[] = [];

  // A nested list belongs *inside* the `<li>` that introduced it, so opening one
  // takes back the `</li>` just written and closing one puts it back. Emitting
  // the sub-list as a sibling renders the same in a browser but is invalid, and
  // anything that later walks this HTML would see a flat list.
  const closeLists = (toIndent = -1) => {
    while (lists.length && lists[lists.length - 1].indent > toIndent) {
      out.push(`</${lists.pop()!.tag}>`);
      if (lists.length) out.push("</li>");
    }
  };
  const flushPara = () => {
    if (!para.length) return;
    out.push(`<p>${inline(para.join(" "))}</p>`);
    para = [];
  };

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      flushPara();
      closeLists();
      out.push(inCode ? "</code></pre>" : "<pre><code>");
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(escapeText(line) + "\n");
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushPara();
      closeLists();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    const item = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (item) {
      flushPara();
      const indent = item[1].replace(/\t/g, "  ").length;
      const tag: "ul" | "ol" = /^\d/.test(item[2]) ? "ol" : "ul";
      closeLists(indent);
      const top = lists[lists.length - 1];
      if (!top || top.indent < indent) {
        if (lists.length && out[out.length - 1] === "</li>") out.pop();
        lists.push({ tag, indent });
        out.push(`<${tag}>`);
      }
      // "- [x] done" is a checklist item, which is how GitHub writes criteria.
      const body = item[3].replace(/^\[([ xX])\]\s*/, (_, c: string) => (c === " " ? "☐ " : "☑ "));
      // Pushed as two entries so the closer can be taken back when the *next*
      // line turns out to be a nested list belonging to this item.
      out.push(`<li>${inline(body)}`, "</li>");
      continue;
    }

    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      flushPara();
      closeLists();
      out.push(`<blockquote>${inline(quote[1])}</blockquote>`);
      continue;
    }

    if (!line.trim()) {
      flushPara();
      closeLists();
      continue;
    }
    para.push(line.trim());
  }
  flushPara();
  closeLists();
  if (inCode) out.push("</code></pre>");

  return sanitizeHtml(out.join(""), opts);
}

/** Span-level Markdown. Text is escaped first, so the only tags in the result are
 *  the ones produced here — and `sanitizeHtml()` still vets them afterwards. */
function inline(s: string): string {
  return escapeText(s)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, '<img src="$2" alt="$1">')
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, '<a href="$2">$1</a>')
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
}

/** True when sanitized HTML carries something worth rendering (text or an image),
 *  as opposed to empty markup the provider left behind in an unfilled field. */
export function hasContent(html: string): boolean {
  if (!html) return false;
  if (/<img\b/i.test(html)) return true;
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim().length > 0;
}

/** Readable plain text from sanitized HTML — for anything that needs a string
 *  rather than markup (search, prompts, notifications). */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
