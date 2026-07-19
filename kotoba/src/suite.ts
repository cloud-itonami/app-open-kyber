/**
 * open-kyber kotoba — PRODUCTIVITY SUITE connectors (kotoba-native, ADR-2606037200 D5).
 *
 * mailer / drive / docs / sheets / calendar as FIRST-CLASS ERP objects on the kotoba
 * Datom log — NOT external SaaS (no Gmail/Drive/Workspace API, no third-party egress).
 *   - mailer   : a message routed over openmail Postage; body is a CID block (sealed for
 *                confidential mail). `postage` is the receipt ref.
 *   - drive    : a content-addressed file/folder tree; file bytes are IPFS CIDs, the
 *                record is metadata; `rev` bumps on each save (as-of = version history).
 *   - docs     : a document body block (CID) with a revision counter.
 *   - sheets   : a cell-grid block (CID) with a revision counter; may `bound` to ERP refs.
 *   - calendar : a pure event Datom; `links` to ERP records it is about.
 *
 * Every object can `links` to any business record, so the suite is bidirectionally
 * integrated with the ERP (an invoice cites a drive file; an HR review schedules an event).
 * The blob bytes themselves are uploaded via the SDK/IPFS out of band; here we record the
 * CID pointer + metadata. Confidential bodies are sealed (the CID is a sealed-CID) so no
 * plaintext private content lands on the substrate.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import { createUnique, listAll, senderDid, slug } from "./_shared.js";
import { OPEN_KYBER_DID_PREFIX } from "./types.js";

// ─── Mailer (openmail Postage) ──────────────────────────────────────────────
export const MAIL_COLLECTION = "com.etzhayyim.apps.openKyber.mail";
export interface MailRecord {
  did: string; messageId: string; thread: string; from: string; to: string[];
  subject: string; bodyCid: string; sealed: boolean; sentAt: string; postage?: string;
  links?: string[]; createdAt: string;
}
export interface SendMailInput {
  messageId: string; thread?: string; to: string[]; subject: string; bodyCid: string;
  sealed?: boolean; postage?: string; links?: string[];
}
export async function sendMail(e: Etzhayyim, i: SendMailInput) {
  if (!i.messageId || !i.subject || !i.bodyCid) return { status: "rejected" as const, error: "missingRequiredFields" };
  if (!Array.isArray(i.to) || i.to.length === 0) return { status: "rejected" as const, error: "noRecipients" };
  const record: MailRecord = {
    did: `${OPEN_KYBER_DID_PREFIX}mail:${slug(i.messageId)}`, messageId: i.messageId,
    thread: i.thread ?? i.messageId, from: senderDid(e), to: i.to, subject: i.subject, bodyCid: i.bodyCid,
    sealed: i.sealed ?? false, sentAt: new Date().toISOString(), postage: i.postage,
    links: i.links, createdAt: new Date().toISOString(),
  };
  const r = await createUnique(e, MAIL_COLLECTION, `mail-${slug(i.messageId)}`, record);
  return r.created ? { status: "sent" as const, uri: r.uri, messageId: i.messageId } : { status: "alreadyExists" as const, uri: r.uri, messageId: i.messageId };
}
export async function listMail(e: Etzhayyim, f: { thread?: string; limit?: number } = {}) {
  return listAll<MailRecord>(e, MAIL_COLLECTION, (v) => !f.thread || v.thread === f.thread, f.limit);
}

// ─── Drive (content-addressed file/folder tree on IPFS) ─────────────────────
export const DRIVE_COLLECTION = "com.etzhayyim.apps.openKyber.driveNode";
export type DriveNodeType = "folder" | "file";
export interface DriveNodeRecord {
  did: string; path: string; name: string; nodeType: DriveNodeType; parent?: string;
  cid?: string; mime?: string; size?: number; rev: number; createdAt: string;
}
export interface PutDriveNodeInput {
  path: string; name: string; nodeType: DriveNodeType; parent?: string; cid?: string; mime?: string; size?: number;
}
export async function putDriveNode(e: Etzhayyim, i: PutDriveNodeInput) {
  if (!i.path || !i.name) return { status: "rejected" as const, error: "missingRequiredFields" };
  if (i.nodeType !== "folder" && i.nodeType !== "file") return { status: "rejected" as const, error: "invalidNodeType" };
  if (i.nodeType === "file" && !i.cid) return { status: "rejected" as const, error: "fileNeedsCid" };
  const rkey = `drv-${slug(i.path)}`;
  // Drive nodes are versioned: a save to an existing path bumps rev (as-of history).
  const existing = await e
    .read<DriveNodeRecord>({ collection: DRIVE_COLLECTION, rkey })
    .catch(() => ({ records: [] as { uri: string; value: DriveNodeRecord }[] }));
  const prevRev = existing.records[0]?.value?.rev ?? 0;
  const record: DriveNodeRecord = {
    did: `${OPEN_KYBER_DID_PREFIX}drive:${slug(i.path)}`, path: i.path, name: i.name, nodeType: i.nodeType,
    parent: i.parent, cid: i.cid, mime: i.mime, size: i.size, rev: prevRev + 1, createdAt: new Date().toISOString(),
  };
  const receipt = await e.write({ collection: DRIVE_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: prevRev === 0 ? ("created" as const) : ("updated" as const), uri: receipt.uri, path: i.path, rev: record.rev };
}
export async function listDrive(e: Etzhayyim, f: { parent?: string; nodeType?: DriveNodeType; limit?: number } = {}) {
  return listAll<DriveNodeRecord>(e, DRIVE_COLLECTION,
    (v) => (!f.parent || v.parent === f.parent) && (!f.nodeType || v.nodeType === f.nodeType), f.limit);
}

// ─── Docs (prose document body block) ───────────────────────────────────────
export const DOC_COLLECTION = "com.etzhayyim.apps.openKyber.doc";
export type DocFormat = "markdown" | "prosemirror" | "html";
export interface DocRecord {
  did: string; docId: string; title: string; format: DocFormat; bodyCid: string; rev: number;
  driveNode?: string; createdAt: string;
}
export async function putDoc(e: Etzhayyim, i: { docId: string; title: string; bodyCid: string; format?: DocFormat; driveNode?: string }) {
  if (!i.docId || !i.title || !i.bodyCid) return { status: "rejected" as const, error: "missingRequiredFields" };
  const rkey = `doc-${slug(i.docId)}`;
  const existing = await e
    .read<DocRecord>({ collection: DOC_COLLECTION, rkey })
    .catch(() => ({ records: [] as { uri: string; value: DocRecord }[] }));
  const prevRev = existing.records[0]?.value?.rev ?? 0;
  const record: DocRecord = {
    did: `${OPEN_KYBER_DID_PREFIX}doc:${slug(i.docId)}`, docId: i.docId, title: i.title,
    format: i.format ?? "markdown", bodyCid: i.bodyCid, rev: prevRev + 1, driveNode: i.driveNode,
    createdAt: new Date().toISOString(),
  };
  const receipt = await e.write({ collection: DOC_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: prevRev === 0 ? ("created" as const) : ("updated" as const), uri: receipt.uri, docId: i.docId, rev: record.rev };
}
export async function listDocs(e: Etzhayyim, f: { limit?: number } = {}) {
  return listAll<DocRecord>(e, DOC_COLLECTION, undefined, f.limit);
}

// ─── Sheets (cell-grid block, optionally bound to ERP entities) ─────────────
export const SHEET_COLLECTION = "com.etzhayyim.apps.openKyber.sheet";
export interface SheetRecord {
  did: string; sheetId: string; title: string; gridCid: string; rev: number; bound?: string[]; driveNode?: string; createdAt: string;
}
export async function putSheet(e: Etzhayyim, i: { sheetId: string; title: string; gridCid: string; bound?: string[]; driveNode?: string }) {
  if (!i.sheetId || !i.title || !i.gridCid) return { status: "rejected" as const, error: "missingRequiredFields" };
  const rkey = `sht-${slug(i.sheetId)}`;
  const existing = await e
    .read<SheetRecord>({ collection: SHEET_COLLECTION, rkey })
    .catch(() => ({ records: [] as { uri: string; value: SheetRecord }[] }));
  const prevRev = existing.records[0]?.value?.rev ?? 0;
  const record: SheetRecord = {
    did: `${OPEN_KYBER_DID_PREFIX}sheet:${slug(i.sheetId)}`, sheetId: i.sheetId, title: i.title,
    gridCid: i.gridCid, rev: prevRev + 1, bound: i.bound, driveNode: i.driveNode, createdAt: new Date().toISOString(),
  };
  const receipt = await e.write({ collection: SHEET_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: prevRev === 0 ? ("created" as const) : ("updated" as const), uri: receipt.uri, sheetId: i.sheetId, rev: record.rev };
}
export async function listSheets(e: Etzhayyim, f: { limit?: number } = {}) {
  return listAll<SheetRecord>(e, SHEET_COLLECTION, undefined, f.limit);
}

// ─── Calendar (pure event Datom) ────────────────────────────────────────────
export const CALENDAR_COLLECTION = "com.etzhayyim.apps.openKyber.calendarEvent";
export interface CalendarEventRecord {
  did: string; eventId: string; title: string; start: string; end: string;
  attendees?: string[]; links?: string[]; recurrence?: string; createdAt: string;
}
export async function createCalendarEvent(e: Etzhayyim, i: { eventId: string; title: string; start: string; end: string; attendees?: string[]; links?: string[]; recurrence?: string }) {
  if (!i.eventId || !i.title || !i.start || !i.end) return { status: "rejected" as const, error: "missingRequiredFields" };
  if (Date.parse(i.start) > Date.parse(i.end)) return { status: "rejected" as const, error: "endBeforeStart" };
  const record: CalendarEventRecord = {
    did: `${OPEN_KYBER_DID_PREFIX}cal:${slug(i.eventId)}`, eventId: i.eventId, title: i.title,
    start: i.start, end: i.end, attendees: i.attendees, links: i.links, recurrence: i.recurrence,
    createdAt: new Date().toISOString(),
  };
  const r = await createUnique(e, CALENDAR_COLLECTION, `cal-${slug(i.eventId)}`, record);
  return r.created ? { status: "created" as const, uri: r.uri, eventId: i.eventId } : { status: "alreadyExists" as const, uri: r.uri, eventId: i.eventId };
}
export async function listCalendar(e: Etzhayyim, f: { limit?: number } = {}) {
  return listAll<CalendarEventRecord>(e, CALENDAR_COLLECTION, undefined, f.limit);
}
