import { describe, it, expect } from "vitest";
import { parseMarkdown, tableOfContents } from "../src/index.js";

const MD = `# Invoice Policy

Intro paragraph with a [link](https://example.com/policy) here.

## Scope

Applies to all [AR invoices](at://kyber/invoice).

### Receivables
Some text.

### Payables
More text.

## Exceptions

\`\`\`
# this is code, not a heading
\`\`\`

Done.
`;

describe("docs Markdown structuring", () => {
  it("extracts the heading outline (skipping fenced code)", () => {
    const doc = parseMarkdown(MD);
    expect(doc.outline.map((h) => `${h.level}:${h.text}`)).toEqual([
      "1:Invoice Policy",
      "2:Scope",
      "3:Receivables",
      "3:Payables",
      "2:Exceptions",
    ]);
    expect(doc.headingCount).toBe(5);
    // the `# this is code` line inside the fence is NOT a heading
    expect(doc.outline.some((h) => h.text.includes("code"))).toBe(false);
  });

  it("builds a nested outline tree", () => {
    const { tree } = parseMarkdown(MD);
    expect(tree).toHaveLength(1); // single H1 root
    const root = tree[0];
    expect(root.text).toBe("Invoice Policy");
    expect(root.children.map((c) => c.text)).toEqual(["Scope", "Exceptions"]);
    expect(root.children[0].children.map((c) => c.text)).toEqual(["Receivables", "Payables"]);
  });

  it("extracts links and counts words", () => {
    const doc = parseMarkdown(MD);
    expect(doc.links).toEqual([
      { text: "link", href: "https://example.com/policy" },
      { text: "AR invoices", href: "at://kyber/invoice" },
    ]);
    expect(doc.wordCount).toBeGreaterThan(0);
    // link text is kept in the word count, the code fence content is excluded
    expect(doc.wordCount).toBeLessThan(40);
  });

  it("renders a plain-text table of contents", () => {
    const toc = tableOfContents(parseMarkdown(MD));
    expect(toc.split("\n")[0]).toBe("- Invoice Policy");
    expect(toc).toContain("    - Receivables"); // level-3 indented
  });

  it("generates slugs for anchors", () => {
    const doc = parseMarkdown("# Hello World\n## A & B");
    expect(doc.outline[0].slug).toBe("hello-world");
    expect(doc.outline[1].slug).toBe("a-b");
  });
});
