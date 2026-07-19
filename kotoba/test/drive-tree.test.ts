import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
  normalizePath,
  parentPath,
  breadcrumb,
  buildDriveTree,
  resolvePath,
  dedupByCid,
  driveUsage,
  auditDriveTree,
  driveTreeFromStore,
  putDriveNode,
} from "../src/index.js";
import type { DriveNodeRecord } from "../src/index.js";

// A small content-addressed drive: /finance + two reports, where q1.pdf and a copy share bytes.
const NODES: DriveNodeRecord[] = [
  { did: "d:root", path: "/", name: "root", nodeType: "folder", rev: 1, createdAt: "t" },
  { did: "d:fin", path: "/finance", name: "finance", nodeType: "folder", parent: "/", rev: 1, createdAt: "t" },
  { did: "d:q1", path: "/finance/q1.pdf", name: "q1.pdf", nodeType: "file", parent: "/finance", cid: "bafyA", size: 1000, rev: 2, createdAt: "t" },
  { did: "d:q2", path: "/finance/q2.pdf", name: "q2.pdf", nodeType: "file", parent: "/finance", cid: "bafyB", size: 500, rev: 1, createdAt: "t" },
  { did: "d:arch", path: "/finance/archive", name: "archive", nodeType: "folder", parent: "/finance", rev: 1, createdAt: "t" },
  // identical bytes as q1.pdf (same CID) — content-addressed dedup
  { did: "d:q1c", path: "/finance/archive/q1-copy.pdf", name: "q1-copy.pdf", nodeType: "file", parent: "/finance/archive", cid: "bafyA", size: 1000, rev: 1, createdAt: "t" },
];

describe("drive path helpers", () => {
  it("normalizes paths", () => {
    expect(normalizePath("/finance//q1.pdf/")).toBe("/finance/q1.pdf");
    expect(normalizePath("finance/q1")).toBe("/finance/q1");
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("")).toBe("/");
  });
  it("derives the parent path", () => {
    expect(parentPath("/finance/archive/q1-copy.pdf")).toBe("/finance/archive");
    expect(parentPath("/finance")).toBe("/");
    expect(parentPath("/")).toBe("/");
  });
  it("builds a breadcrumb chain", () => {
    expect(breadcrumb("/finance/archive/q1.pdf")).toEqual(["/", "/finance", "/finance/archive", "/finance/archive/q1.pdf"]);
    expect(breadcrumb("/")).toEqual(["/"]);
  });
});

describe("drive tree + size roll-up", () => {
  it("nests nodes under their parent folders (folders first, then by name)", () => {
    const tree = buildDriveTree(NODES);
    expect(tree).toHaveLength(1); // single root
    const root = tree[0];
    expect(root.path).toBe("/");
    const fin = root.children[0];
    expect(fin.name).toBe("finance");
    // folder "archive" sorts before files q1.pdf / q2.pdf
    expect(fin.children.map((c) => c.name)).toEqual(["archive", "q1.pdf", "q2.pdf"]);
  });

  it("rolls folder size up recursively (Σ of descendant files)", () => {
    const tree = buildDriveTree(NODES);
    const root = tree[0];
    const fin = root.children[0];
    const archive = fin.children.find((c) => c.name === "archive")!;
    expect(archive.rolledSize).toBe(1000); // the copy
    expect(fin.rolledSize).toBe(2500); // 1000 + 500 + 1000
    expect(root.rolledSize).toBe(2500); // whole tree
  });

  it("treats orphaned nodes (missing parent folder) as roots rather than dropping them", () => {
    const orphan: DriveNodeRecord[] = [
      { did: "d:x", path: "/ghost/file.txt", name: "file.txt", nodeType: "file", parent: "/ghost", cid: "bafyX", size: 10, rev: 1, createdAt: "t" },
    ];
    const tree = buildDriveTree(orphan);
    expect(tree).toHaveLength(1);
    expect(tree[0].path).toBe("/ghost/file.txt");
  });

  it("resolves a node by path", () => {
    expect(resolvePath(NODES, "/finance/q2.pdf")?.cid).toBe("bafyB");
    expect(resolvePath(NODES, "/nope")).toBeUndefined();
  });
});

describe("content-addressed dedup", () => {
  it("groups files sharing a CID and reports bytes saved", () => {
    const groups = dedupByCid(NODES);
    expect(groups).toHaveLength(1);
    expect(groups[0].cid).toBe("bafyA");
    expect(groups[0].paths).toEqual(["/finance/archive/q1-copy.pdf", "/finance/q1.pdf"]);
    expect(groups[0].saved).toBe(1000); // (2 copies − 1) × 1000
  });

  it("rolls up usage with the content-addressing win", () => {
    const u = driveUsage(NODES);
    expect(u.fileCount).toBe(3);
    expect(u.folderCount).toBe(3);
    expect(u.logicalBytes).toBe(2500); // counting duplicates
    expect(u.uniqueCids).toBe(2); // bafyA, bafyB
    expect(u.storedBytes).toBe(1500); // one copy each
    expect(u.dedupSaved).toBe(1000);
  });
});

describe("drive read-only audit", () => {
  it("passes a well-formed tree", () => {
    const out = auditDriveTree(NODES);
    expect(out.ok).toBe(true);
  });

  it("catches files without a CID, folders carrying bytes, and orphan/mismatched parents", () => {
    const bad: DriveNodeRecord[] = [
      { did: "d:r", path: "/", name: "root", nodeType: "folder", rev: 1, createdAt: "t" },
      // file with no cid
      { did: "d:1", path: "/a.txt", name: "a.txt", nodeType: "file", parent: "/", rev: 1, createdAt: "t" },
      // folder carrying a cid
      { did: "d:2", path: "/docs", name: "docs", nodeType: "folder", parent: "/", cid: "bafyZ", rev: 1, createdAt: "t" },
      // orphan parent (/missing is not a known folder)
      { did: "d:3", path: "/missing/b.txt", name: "b.txt", nodeType: "file", parent: "/missing", cid: "bafyB", rev: 1, createdAt: "t" },
      // parent/path mismatch (parent says "/" but path implies "/docs")
      { did: "d:4", path: "/docs/c.txt", name: "c.txt", nodeType: "file", parent: "/", cid: "bafyC", rev: 1, createdAt: "t" },
    ];
    const out = auditDriveTree(bad);
    expect(out.ok).toBe(false);
    const failed = out.checks.filter((c) => !c.ok).map((c) => c.check);
    expect(failed).toContain("filesHaveCid");
    expect(failed).toContain("foldersHaveNoBytes");
    expect(failed).toContain("parentsAreFolders");
    expect(failed).toContain("parentMatchesPath");
  });

  it("catches duplicate paths", () => {
    const dup: DriveNodeRecord[] = [
      { did: "d:a", path: "/x", name: "x", nodeType: "folder", rev: 1, createdAt: "t" },
      { did: "d:b", path: "/x", name: "x", nodeType: "folder", rev: 2, createdAt: "t" },
    ];
    const out = auditDriveTree(dup);
    expect(out.checks.find((c) => c.check === "uniquePaths")?.ok).toBe(false);
  });
});

describe("SDK-bound driveTreeFromStore (reads the store, then builds)", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: "did:web:kyber.etzhayyim.com" });
  });

  it("builds the tree + usage + dedup from written drive nodes", async () => {
    await putDriveNode(e, { path: "/finance", name: "finance", nodeType: "folder", parent: "/" });
    await putDriveNode(e, { path: "/finance/q1.pdf", name: "q1.pdf", nodeType: "file", parent: "/finance", cid: "bafyA", size: 1000 });
    await putDriveNode(e, { path: "/finance/q1-dup.pdf", name: "q1-dup.pdf", nodeType: "file", parent: "/finance", cid: "bafyA", size: 1000 });

    const view = await driveTreeFromStore(e);
    expect(view.usage.fileCount).toBe(2);
    expect(view.usage.dedupSaved).toBe(1000);
    expect(view.dedup[0].cid).toBe("bafyA");
    // tree contains the finance folder with two files under it
    const fin = view.tree.find((n) => n.name === "finance") ?? view.tree[0].children.find((n) => n.name === "finance");
    expect(fin?.children.length).toBe(2);
    expect(fin?.rolledSize).toBe(2000);
  });
});
