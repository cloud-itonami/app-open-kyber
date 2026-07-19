/**
 * open-kyber kotoba — drive file-tree core (ADR-2606037200 D5). Gives the suite `drive`
 * object real FUNCTION — the drive analogue of the sheets formula engine (`sheets-eval`),
 * the docs outline (`docs-md`) and the calendar RRULE expander (`recurrence`). A drive is a
 * content-addressed file/folder tree: file bytes live on IPFS (the record carries the CID),
 * so two paths pointing at the same CID are the SAME bytes — content-addressed dedup is a
 * first-class property, not an afterthought.
 *
 * Pure (flat node list in / structure out, no SDK) so it is unit-testable and WASM-portable.
 * One SDK-bound convenience (`driveTreeFromStore`) reads the drive collection then builds the
 * tree, mirroring how `sheets-erp.buildTrialBalanceGrid` reads the ledger then evaluates it.
 *
 * Provides: path normalization + breadcrumb (navigation), a nested folder tree with recursive
 * size roll-up (a folder's size = Σ of its descendant files), content-addressed dedup grouping
 * (how many logical paths share identical bytes + the bytes saved), a usage roll-up, and a
 * read-only invariant audit (orphan parents, file-without-CID, folder-carrying-bytes, path /
 * parent mismatch, duplicate paths) — the non-mutating toritate/danjo audit ethos (cf.
 * `audit.ledgerAudit`) applied to the drive.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import type { DriveNodeRecord, DriveNodeType } from "./suite.js";
import { listDrive } from "./suite.js";

// ─── Path helpers ───────────────────────────────────────────────────────────

/** Normalize a drive path: collapse repeated `/`, strip a trailing slash, ensure leading `/`. */
export function normalizePath(path: string): string {
  const collapsed = `/${path}`.replace(/\/+/g, "/").replace(/\/+$/, "");
  return collapsed === "" ? "/" : collapsed;
}

/** The parent path of a normalized path (`/a/b/c` → `/a/b`; `/a` → `/`; `/` → `/`). */
export function parentPath(path: string): string {
  const p = normalizePath(path);
  if (p === "/") return "/";
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
}

/** Ancestor chain for navigation: `/a/b/c` → ["/", "/a", "/a/b", "/a/b/c"]. */
export function breadcrumb(path: string): string[] {
  const p = normalizePath(path);
  if (p === "/") return ["/"];
  const segs = p.split("/").filter(Boolean);
  const out = ["/"];
  let acc = "";
  for (const s of segs) {
    acc = `${acc}/${s}`;
    out.push(acc);
  }
  return out;
}

// ─── Tree ────────────────────────────────────────────────────────────────────

export interface DriveTreeNode extends DriveNodeRecord {
  children: DriveTreeNode[];
  /** Bytes of this node: a file's own `size`; a folder's recursive Σ of descendant files. */
  rolledSize: number;
}

/** Folders before files, then by name (stable, locale-independent). */
function byKind(a: DriveTreeNode, b: DriveTreeNode): number {
  if (a.nodeType !== b.nodeType) return a.nodeType === "folder" ? -1 : 1;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * Assemble a flat node list into a nested folder tree with recursive size roll-up.
 * Nodes are keyed by normalized path; a node attaches under its `parent` path when that
 * parent is a known folder, else it is treated as a root (so a partial / orphaned listing
 * still renders rather than throwing — `auditDriveTree` reports the orphans separately).
 */
export function buildDriveTree(nodes: readonly DriveNodeRecord[]): DriveTreeNode[] {
  const byPath = new Map<string, DriveTreeNode>();
  for (const n of nodes) {
    byPath.set(normalizePath(n.path), { ...n, children: [], rolledSize: 0 });
  }
  const roots: DriveTreeNode[] = [];
  for (const node of byPath.values()) {
    const parentKey = node.parent ? normalizePath(node.parent) : parentPath(node.path);
    const parent = parentKey === normalizePath(node.path) ? undefined : byPath.get(parentKey);
    if (parent && parent.nodeType === "folder") parent.children.push(node);
    else roots.push(node);
  }
  for (const node of byPath.values()) node.children.sort(byKind);
  roots.sort(byKind);
  for (const r of roots) rollUp(r);
  return roots;
}

/** Post-order size roll-up: a file contributes its own size, a folder the Σ of its subtree. */
function rollUp(node: DriveTreeNode): number {
  if (node.nodeType === "file") {
    node.rolledSize = node.size ?? 0;
    return node.rolledSize;
  }
  let sum = 0;
  for (const c of node.children) sum += rollUp(c);
  node.rolledSize = sum;
  return sum;
}

/** Find a node by (normalized) path in a flat listing. */
export function resolvePath(
  nodes: readonly DriveNodeRecord[],
  path: string,
): DriveNodeRecord | undefined {
  const target = normalizePath(path);
  return nodes.find((n) => normalizePath(n.path) === target);
}

// ─── Content-addressed dedup ──────────────────────────────────────────────────

export interface DedupGroup {
  cid: string;
  /** Normalized paths that resolve to this CID (i.e. identical bytes). */
  paths: string[];
  size: number;
  /** Bytes saved by content-addressing: (copies − 1) × size. */
  saved: number;
}

/**
 * Group file nodes by CID. A CID referenced by N paths is the SAME bytes stored once on IPFS;
 * `saved` is the bytes that a copy-based store would have duplicated. Folders / file nodes
 * without a CID are ignored. Returns only CIDs referenced by more than one path, biggest
 * saving first.
 */
export function dedupByCid(nodes: readonly DriveNodeRecord[]): DedupGroup[] {
  const groups = new Map<string, { paths: string[]; size: number }>();
  for (const n of nodes) {
    if (n.nodeType !== "file" || !n.cid) continue;
    const g = groups.get(n.cid) ?? { paths: [], size: n.size ?? 0 };
    g.paths.push(normalizePath(n.path));
    g.size = n.size ?? g.size;
    groups.set(n.cid, g);
  }
  const out: DedupGroup[] = [];
  for (const [cid, g] of groups) {
    if (g.paths.length < 2) continue;
    out.push({ cid, paths: g.paths.sort(), size: g.size, saved: (g.paths.length - 1) * g.size });
  }
  return out.sort((a, b) => b.saved - a.saved);
}

// ─── Usage roll-up ─────────────────────────────────────────────────────────────

export interface DriveUsage {
  fileCount: number;
  folderCount: number;
  /** Σ of every file node's size (logical bytes, counting duplicates). */
  logicalBytes: number;
  uniqueCids: number;
  /** Σ of one copy per unique CID (physical bytes actually stored on IPFS). */
  storedBytes: number;
  /** logicalBytes − storedBytes (the content-addressing win). */
  dedupSaved: number;
}

/** Roll up totals across a flat drive listing, including the content-addressing dedup win. */
export function driveUsage(nodes: readonly DriveNodeRecord[]): DriveUsage {
  let fileCount = 0;
  let folderCount = 0;
  let logicalBytes = 0;
  const cidSize = new Map<string, number>();
  for (const n of nodes) {
    if (n.nodeType === "folder") {
      folderCount++;
      continue;
    }
    fileCount++;
    logicalBytes += n.size ?? 0;
    if (n.cid) cidSize.set(n.cid, n.size ?? 0);
  }
  let storedBytes = 0;
  for (const s of cidSize.values()) storedBytes += s;
  return {
    fileCount,
    folderCount,
    logicalBytes,
    uniqueCids: cidSize.size,
    storedBytes,
    dedupSaved: logicalBytes - storedBytes,
  };
}

// ─── Read-only invariant audit ─────────────────────────────────────────────────

export interface DriveAuditCheck {
  check: string;
  ok: boolean;
  detail: string;
  offenders: string[];
}
export interface DriveAuditOutput {
  ok: boolean;
  checks: DriveAuditCheck[];
}

/**
 * Sweep the drive's structural invariants WITHOUT mutating anything (cf. `audit.ledgerAudit`):
 *  1. unique paths            — no two nodes share a path
 *  2. files carry a CID       — a `file` node must reference bytes
 *  3. folders carry no bytes  — a `folder` node must not carry a CID
 *  4. parents exist & are folders — a declared `parent` resolves to a known folder
 *  5. parent matches path     — a node's `parent` equals its path's parent segment
 */
export function auditDriveTree(nodes: readonly DriveNodeRecord[]): DriveAuditOutput {
  const checks: DriveAuditCheck[] = [];
  const mk = (check: string, detail: string, offenders: string[]): DriveAuditCheck => ({
    check,
    ok: offenders.length === 0,
    detail,
    offenders,
  });

  const seen = new Set<string>();
  const dupes: string[] = [];
  const folders = new Set<string>();
  for (const n of nodes) {
    const p = normalizePath(n.path);
    if (seen.has(p)) dupes.push(p);
    seen.add(p);
    if (n.nodeType === "folder") folders.add(p);
  }
  checks.push(mk("uniquePaths", "no two nodes share a normalized path", [...new Set(dupes)]));

  checks.push(
    mk(
      "filesHaveCid",
      "every file node references an IPFS CID",
      nodes.filter((n) => n.nodeType === "file" && !n.cid).map((n) => normalizePath(n.path)),
    ),
  );
  checks.push(
    mk(
      "foldersHaveNoBytes",
      "no folder node carries a CID",
      nodes.filter((n) => n.nodeType === "folder" && n.cid).map((n) => normalizePath(n.path)),
    ),
  );

  const orphan: string[] = [];
  const mismatch: string[] = [];
  for (const n of nodes) {
    const p = normalizePath(n.path);
    if (n.parent) {
      const par = normalizePath(n.parent);
      if (!folders.has(par)) orphan.push(p);
      if (par !== parentPath(p)) mismatch.push(p);
    }
  }
  checks.push(mk("parentsAreFolders", "declared parents exist and are folders", orphan));
  checks.push(mk("parentMatchesPath", "declared parent equals the path's parent segment", mismatch));

  return { ok: checks.every((c) => c.ok), checks };
}

// ─── SDK-bound convenience (reads the store, then builds the tree) ───────────────

export interface DriveTreeView {
  tree: DriveTreeNode[];
  usage: DriveUsage;
  dedup: DedupGroup[];
}

/**
 * Read the drive collection and return the built tree + usage + dedup in one call — the drive
 * analogue of `sheets-erp.buildTrialBalanceGrid`. `nodeType` is intentionally NOT filtered:
 * folders are needed to build the tree.
 */
export async function driveTreeFromStore(
  e: Etzhayyim,
  opts: { parent?: string; limit?: number } = {},
): Promise<DriveTreeView> {
  const { items } = await listDrive(e, { parent: opts.parent, limit: opts.limit });
  return { tree: buildDriveTree(items), usage: driveUsage(items), dedup: dedupByCid(items) };
}
