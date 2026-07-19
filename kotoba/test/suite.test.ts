import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
  sendMail, listMail,
  putDriveNode, listDrive,
  putDoc, listDocs,
  putSheet, listSheets,
  createCalendarEvent, listCalendar,
  MAIL_COLLECTION, DOC_COLLECTION,
} from "../src/index.js";

const OWNER = "did:web:kyber.etzhayyim.com";
const HR = "did:web:kyber.etzhayyim.com:dept:hr";

describe("productivity suite (kotoba-native, integrated with ERP)", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: OWNER });
  });

  it("mailer: sends over Postage with body CID + ERP links, validates recipients", async () => {
    const r = await sendMail(e, { messageId: "m1", to: [HR], subject: "Invoice AR-1", bodyCid: "bafy...body", sealed: true, postage: "postage:0x1", links: ["at://.../invoice/AR-1"] });
    expect(r.status).toBe("sent");
    expect((await sendMail(e, { messageId: "m1", to: [HR], subject: "dup", bodyCid: "x" })).status).toBe("alreadyExists");
    expect((await sendMail(e, { messageId: "m2", to: [], subject: "no recip", bodyCid: "x" })).status).toBe("rejected");
    const list = await listMail(e, { thread: "m1" });
    expect(list.total).toBe(1);
    expect(list.items[0].from).toBe(OWNER);
    expect(list.items[0].sealed).toBe(true);
    // sealed mail body is a CID pointer, never plaintext on the record
    expect(e.count(MAIL_COLLECTION)).toBe(1);
  });

  it("drive: file needs a CID, folders do not; saves bump rev (as-of version history)", async () => {
    expect((await putDriveNode(e, { path: "/finance", name: "finance", nodeType: "folder" })).status).toBe("created");
    expect((await putDriveNode(e, { path: "/finance/q1.pdf", name: "q1.pdf", nodeType: "file" })).status).toBe("rejected"); // no cid
    const v1 = await putDriveNode(e, { path: "/finance/q1.pdf", name: "q1.pdf", nodeType: "file", parent: "/finance", cid: "bafy1", mime: "application/pdf", size: 1024 });
    expect(v1.status).toBe("created");
    expect(v1.rev).toBe(1);
    const v2 = await putDriveNode(e, { path: "/finance/q1.pdf", name: "q1.pdf", nodeType: "file", parent: "/finance", cid: "bafy2", size: 2048 });
    expect(v2.status).toBe("updated");
    expect(v2.rev).toBe(2);
    expect((await listDrive(e, { parent: "/finance" })).total).toBe(1);
    expect((await listDrive(e, { nodeType: "folder" })).total).toBe(1);
  });

  it("docs + sheets: revisioned content-addressed blocks; sheet binds to ERP entities", async () => {
    expect((await putDoc(e, { docId: "d1", title: "SOW", bodyCid: "bafyDoc", format: "markdown" })).rev).toBe(1);
    expect((await putDoc(e, { docId: "d1", title: "SOW v2", bodyCid: "bafyDoc2" })).rev).toBe(2);
    expect((await listDocs(e)).total).toBe(1);
    expect(e.count(DOC_COLLECTION)).toBe(1); // same docId, rev bumped in place

    const s = await putSheet(e, { sheetId: "tb", title: "Trial Balance", gridCid: "bafyGrid", bound: ["at://.../account/1000", "at://.../account/4000"] });
    expect(s.status).toBe("created");
    expect((await listSheets(e)).items[0].bound?.length).toBe(2);
  });

  it("calendar: event links to ERP records, validates time order", async () => {
    const ok = await createCalendarEvent(e, { eventId: "ev1", title: "Depreciation close", start: "2026-06-30T09:00:00Z", end: "2026-06-30T10:00:00Z", attendees: [HR], links: ["at://.../depreciationRun/FA-1"] });
    expect(ok.status).toBe("created");
    expect((await createCalendarEvent(e, { eventId: "ev2", title: "bad", start: "2026-06-30T10:00:00Z", end: "2026-06-30T09:00:00Z" })).status).toBe("rejected");
    expect((await listCalendar(e)).total).toBe(1);
  });
});
