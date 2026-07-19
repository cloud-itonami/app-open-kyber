import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
  straightLineSchedule,
  registerFixedAsset,
  listFixedAssets,
  runDepreciation,
  listDepreciationRuns,
  divMoney,
  mulMoneyInt,
  sumMoney,
} from "../src/index.js";

const OWNER = "did:web:kyber.etzhayyim.com";

describe("money — divide/multiply (depreciation math)", () => {
  it("divides half-up and multiplies exactly", () => {
    expect(divMoney("1000", 3, 2)).toBe("333.33");
    expect(divMoney("10", 4, 2)).toBe("2.5");
    expect(mulMoneyInt("333.33", 3)).toBe("999.99");
    expect(divMoney("1", 8, 2)).toBe("0.13"); // 0.125 → half-up 0.13
  });
});

describe("straight-line depreciation schedule (exact, last-period adjusted)", () => {
  it("sums to the depreciable base with no rounding drift", () => {
    const s = straightLineSchedule("1000", "100", 3); // base 900 / 3 = 300
    expect(s.map((r) => r.amount)).toEqual(["300", "300", "300"]);
    expect(s[2].accumulated).toBe("900");
  });
  it("absorbs the rounding remainder in the final period", () => {
    const s = straightLineSchedule("1000", "0", 3); // 333.33 × 2 + remainder
    expect(s[0].amount).toBe("333.33");
    expect(s[2].amount).toBe("333.34"); // last period absorbs 0.01
    expect(sumMoney(s.map((r) => r.amount))).toBe("1000");
    expect(s[2].accumulated).toBe("1000");
  });
  it("rejects salvage > cost and non-positive life", () => {
    expect(() => straightLineSchedule("100", "200", 12)).toThrow();
    expect(() => straightLineSchedule("100", "0", 0)).toThrow();
  });
});

describe("asset module (kotoba-Datomic; each run an accumulating fact)", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: OWNER });
  });

  it("registers, dedups, validates", async () => {
    expect((await registerFixedAsset(e, { tag: "FA-1", name: "Lathe", cost: "1200000", salvage: "0", lifeMonths: 60 })).status).toBe("registered");
    expect((await registerFixedAsset(e, { tag: "FA-1", name: "Lathe", cost: "1200000", lifeMonths: 60 })).status).toBe("alreadyExists");
    expect((await registerFixedAsset(e, { tag: "FA-2", name: "Bad", cost: "abc", lifeMonths: 60 })).status).toBe("rejected");
    expect((await registerFixedAsset(e, { tag: "FA-3", name: "Bad life", cost: "100", lifeMonths: 0 })).status).toBe("rejected");
    expect((await registerFixedAsset(e, { tag: "FA-4", name: "Salvage>cost", cost: "100", salvage: "200", lifeMonths: 12 })).status).toBe("rejected");
    expect((await listFixedAssets(e)).total).toBe(1);
  });

  it("runs depreciation per period, idempotent, accumulating", async () => {
    await registerFixedAsset(e, { tag: "FA-1", name: "Lathe", cost: "1200", salvage: "0", lifeMonths: 12 });
    const p1 = await runDepreciation(e, { tag: "FA-1", periodIndex: 1 });
    expect(p1.status).toBe("posted");
    expect(p1.run?.amount).toBe("100");
    expect(p1.run?.accumulated).toBe("100");
    const p2 = await runDepreciation(e, { tag: "FA-1", periodIndex: 2 });
    expect(p2.run?.accumulated).toBe("200");
    // idempotent
    expect((await runDepreciation(e, { tag: "FA-1", periodIndex: 1 })).status).toBe("alreadyRun");
    // bounds + missing asset
    expect((await runDepreciation(e, { tag: "FA-1", periodIndex: 13 })).error).toBe("periodBeyondLife");
    expect((await runDepreciation(e, { tag: "ghost", periodIndex: 1 })).error).toBe("assetNotFound");
    expect((await listDepreciationRuns(e, { tag: "FA-1" })).total).toBe(2);
  });
});
