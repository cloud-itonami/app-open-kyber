/**
 * open-kyber kotoba — docs Markdown structuring (ADR-2606037200 D5). Parses a suite `doc`
 * Markdown body into a heading OUTLINE (flat + nested tree), extracted links, and a word
 * count — the docs analogue of the sheets formula engine, giving the docs suite object real
 * function (navigation, table-of-contents, link audit). Pure (string in / structure out);
 * fenced code blocks are skipped so `# comments` inside code aren't mistaken for headings.
 */

export interface Heading {
  level: number; // 1..6
  text: string;
  slug: string;
}
export interface MdLink {
  text: string;
  href: string;
}
export interface OutlineNode extends Heading {
  children: OutlineNode[];
}
export interface MarkdownDoc {
  outline: Heading[];
  tree: OutlineNode[];
  links: MdLink[];
  headingCount: number;
  wordCount: number;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^a-z0-9぀-ヿ一-鿿]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/** Parse Markdown into an outline + links + word count. */
export function parseMarkdown(md: string): MarkdownDoc {
  const lines = md.split(/\r?\n/);
  const outline: Heading[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = HEADING_RE.exec(line);
    if (m) outline.push({ level: m[1].length, text: m[2].trim(), slug: slugify(m[2].trim()) });
  }

  const links: MdLink[] = [];
  for (const m of md.matchAll(LINK_RE)) links.push({ text: m[1], href: m[2] });

  // word count: drop fenced code, heading markers, link syntax (keep link text), emphasis.
  let inFence2 = false;
  const prose = lines
    .filter((l) => {
      if (/^\s*(```|~~~)/.test(l)) { inFence2 = !inFence2; return false; }
      return !inFence2;
    })
    .join("\n")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(LINK_RE, "$1")
    .replace(/[`*_~>#-]/g, " ");
  const wordCount = prose.split(/\s+/).filter(Boolean).length;

  return { outline, tree: buildTree(outline), links, headingCount: outline.length, wordCount };
}

/** Build a nested outline tree from the flat heading list (by level). */
export function buildTree(outline: Heading[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];
  for (const h of outline) {
    const node: OutlineNode = { ...h, children: [] };
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}

/** Render a plain-text table of contents (indented by heading level). */
export function tableOfContents(doc: MarkdownDoc): string {
  return doc.outline.map((h) => `${"  ".repeat(h.level - 1)}- ${h.text}`).join("\n");
}
