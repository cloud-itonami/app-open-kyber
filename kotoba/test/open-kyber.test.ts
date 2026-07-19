import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
  createAccount,
  listAccounts,
  registerIntegration,
  listIntegrations,
  registerEmployee,
  listEmployees,
  getEmployee,
  coverage,
} from "../src/index.js";

const OWNER = "did:web:kyber.etzhayyim.com";

describe("open-kyber kotoba (kotoba-E2E split)", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: OWNER });
  });

  describe("account (PLAINTEXT chart-of-accounts reference)", () => {
    it("creates, dedups, validates, lists/filters", async () => {
      expect((await createAccount(e, { accountCode: "1000", name: "Cash", accountType: "asset", openingBalance: "1000.50" })).status).toBe("created");
      expect((await createAccount(e, { accountCode: "1000", name: "Cash", accountType: "asset" })).status).toBe("alreadyExists");
      expect((await createAccount(e, { accountCode: "9999", name: "Bad", accountType: "bogus" as any })).status).toBe("rejected");
      expect((await createAccount(e, { accountCode: "8888", name: "Bad bal", accountType: "asset", openingBalance: "1.2.3" })).status).toBe("rejected");
      await createAccount(e, { accountCode: "4000", name: "Sales Revenue", accountType: "revenue" });
      expect((await listAccounts(e)).total).toBe(2);
      expect((await listAccounts(e, { accountType: "asset" })).total).toBe(1);
    });
  });

  describe("integrationBinding (PLAINTEXT public catalog)", () => {
    it("registers, dedups, lists/filters", async () => {
      expect((await registerIntegration(e, { integrationId: "mailer", name: "com.etzhayyim.apps.mailer", category: "messaging" })).status).toBe("registered");
      expect((await registerIntegration(e, { integrationId: "mailer", name: "com.etzhayyim.apps.mailer", category: "messaging" })).status).toBe("alreadyExists");
      expect((await registerIntegration(e, { integrationId: "", name: "x", category: "y" })).status).toBe("rejected");
      await registerIntegration(e, { integrationId: "drive", name: "com.etzhayyim.apps.drive", category: "storage" });
      expect((await listIntegrations(e)).total).toBe(2);
      expect((await listIntegrations(e, { category: "storage" })).total).toBe(1);
    });
  });

  describe("employee (E2E-ENCRYPTED Tier-3 PII)", () => {
    it("seals via encryptedWrite, round-trips via encryptedRead, validates", async () => {
      const ok = await registerEmployee(e, { employeeId: "emp1", name: "Taro Yamada", email: "taro@example.com", department: "hr", position: "Manager", salary: "8000000" });
      expect(ok.status).toBe("registered");
      expect(ok.keyId).toBeTruthy();
      expect((await registerEmployee(e, { employeeId: "empX", name: "n", email: "e", department: "d", salary: "abc" })).status).toBe("rejected"); // bad salary
      expect((await registerEmployee(e, { employeeId: "empY", name: "n", email: "e", department: "d", employmentType: "ghost" as any })).status).toBe("rejected");
      expect((await registerEmployee(e, { employeeId: "empZ", name: "", email: "e", department: "d" })).status).toBe("rejected"); // missing name
      const got = await getEmployee(e, { employeeId: "emp1" });
      expect(got.employee?.email).toBe("taro@example.com");
      expect(got.employee?.salary).toBe("8000000");
      await registerEmployee(e, { employeeId: "emp2", name: "Hanako Suzuki", email: "hanako@example.com", department: "sales", salary: "6000000" });
      expect((await listEmployees(e)).total).toBe(2);
      expect((await listEmployees(e, { department: "hr" })).total).toBe(1);
    });

    it("keeps PII off the plaintext store (sealed in the encrypted envelope)", async () => {
      await registerEmployee(e, { employeeId: "emp1", name: "Taro Yamada", email: "taro@example.com", department: "hr", salary: "8000000" });
      // No plaintext employee collection exists; the body lives only E2E.
      expect(e.count("com.etzhayyim.apps.openKyber.employee")).toBe(0);
      expect(e.encCount()).toBe(1);
    });

    it("enforces read-cap: a non-recipient DID sees zero employees", async () => {
      await registerEmployee(e, { employeeId: "emp1", name: "Taro Yamada", email: "taro@example.com", department: "hr", salary: "8000000" });
      const outsider: any = new MockEtzhayyim({ did: "did:web:outsider.example" });
      expect((await listEmployees(outsider)).total).toBe(0);
    });

    it("grants read-cap to an explicit recipient (HR dept DID)", async () => {
      const hrDept = "did:web:kyber.etzhayyim.com:dept:hr";
      const r = await registerEmployee(e, { employeeId: "emp1", name: "Taro Yamada", email: "taro@example.com", department: "hr", salary: "8000000", recipients: [hrDept] });
      expect(r.status).toBe("registered");
      expect((await listEmployees(e)).total).toBe(1);
    });
  });

  describe("coverage rollup", () => {
    it("counts plaintext accounts + bindings + E2E employees", async () => {
      await createAccount(e, { accountCode: "1000", name: "Cash", accountType: "asset" });
      await createAccount(e, { accountCode: "1100", name: "AR", accountType: "asset" });
      await createAccount(e, { accountCode: "4000", name: "Revenue", accountType: "revenue" });
      await registerIntegration(e, { integrationId: "mailer", name: "com.etzhayyim.apps.mailer", category: "messaging" });
      await registerEmployee(e, { employeeId: "emp1", name: "Taro", email: "t@example.com", department: "hr", salary: "8000000" });
      const cov = await coverage(e);
      expect(cov.accountCount).toBe(3);
      expect(cov.integrationBindingCount).toBe(1);
      expect(cov.employeeCount).toBe(1);
      expect(cov.accountsByType?.asset).toBe(2);
      expect(cov.accountsByType?.revenue).toBe(1);
    });
  });
});
