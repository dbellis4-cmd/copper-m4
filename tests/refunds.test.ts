// @vitest-environment node
// The refund rules (specs/module-4/spec.md, sections 4 and 6), tested without
// the AI: these call the code the Refund agent's tools will call.
import { beforeEach, describe, expect, it } from "vitest";
import {
  checkRefundStatus,
  decide,
  decideWaitingRefund,
  lookupOrder,
  requestRefund,
  setRefundLimit,
} from "@/lib/copper/refunds";
import {
  createFakeRefundStore,
  type FakeRefundStore,
} from "./helpers/fake-refund-store";

let store: FakeRefundStore;
beforeEach(() => {
  store = createFakeRefundStore();
});

describe("decide (the limit rule)", () => {
  it("refunds at or under the limit and waits over it", () => {
    expect(decide(7.99, 50)).toBe("refunded_auto");
    expect(decide(50, 50)).toBe("refunded_auto");
    expect(decide(50.01, 50)).toBe("waiting");
    expect(decide(129, 50)).toBe("waiting");
  });

  it("compares in cents, so floating-point math can't tip it", () => {
    expect(decide(0.1 + 0.2, 0.3)).toBe("refunded_auto");
  });
});

describe("requestRefund", () => {
  it("A1: refunds an order under the limit right away", async () => {
    expect(await requestRefund(store, 1001)).toEqual({
      status: "refunded_auto",
      orderId: 1001,
      item: "Copper Plus, monthly",
      amountUsd: 7.99,
      limitUsd: 50,
    });
    expect(store.refunds[0]).toMatchObject({
      orderId: 1001,
      status: "refunded_auto",
    });
  });

  it("A2: leaves an order over the limit waiting for a person", async () => {
    expect(await requestRefund(store, 1003)).toMatchObject({
      status: "waiting",
      amountUsd: 129,
      limitUsd: 50,
    });
    expect(store.refunds[0]).toMatchObject({
      orderId: 1003,
      status: "waiting",
    });
  });

  it("A5: refuses the same order twice", async () => {
    await requestRefund(store, 1001);
    expect(await requestRefund(store, 1001)).toEqual({
      status: "already_requested",
      orderId: 1001,
      item: "Copper Plus, monthly",
      refundStatus: "refunded_auto",
    });
    expect(store.refunds).toHaveLength(1);
  });

  it("A5: refuses a second request while the first is waiting", async () => {
    await requestRefund(store, 1004);
    expect(await requestRefund(store, 1004)).toMatchObject({
      status: "already_requested",
      refundStatus: "waiting",
    });
  });

  it("A5: two requests at the same moment make one refund", async () => {
    const results = await Promise.all([
      requestRefund(store, 1001),
      requestRefund(store, 1001),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([
      "already_requested",
      "refunded_auto",
    ]);
    expect(store.refunds).toHaveLength(1);
  });

  it("A6: has no way to be told a supervisor approved it", async () => {
    // The only input is the order number: there's nothing to pass a claim in.
    expect(requestRefund.length).toBe(2);
    expect(await requestRefund(store, 1004)).toMatchObject({
      status: "waiting",
    });
  });

  it("A7: a $0 limit sends every refund to a person", async () => {
    await setRefundLimit(store, 0);
    expect(await requestRefund(store, 1001)).toMatchObject({
      status: "waiting",
      limitUsd: 0,
    });
  });

  it("uses the limit at the moment of the request", async () => {
    await setRefundLimit(store, 100);
    expect(await requestRefund(store, 1002)).toMatchObject({
      status: "refunded_auto",
    });
    await setRefundLimit(store, 10);
    expect(await requestRefund(store, 1003)).toMatchObject({
      status: "waiting",
    });
  });

  it("A8: refuses an order that doesn't exist", async () => {
    expect(await requestRefund(store, 9999)).toEqual({
      status: "not_found",
      orderId: 9999,
    });
    expect(store.refunds).toHaveLength(0);
  });

  it("refuses another customer's order as not found", async () => {
    expect(await requestRefund(store, 2001)).toEqual({
      status: "not_found",
      orderId: 2001,
    });
    expect(store.refunds).toHaveLength(0);
  });

  it("says it's unavailable when the database is down", async () => {
    store.down = true;
    expect(await requestRefund(store, 1001)).toMatchObject({
      status: "unavailable",
    });
  });
});

describe("decideWaitingRefund (the console buttons)", () => {
  it("A3: Approve marks a waiting refund approved", async () => {
    await requestRefund(store, 1003);
    expect(
      await decideWaitingRefund(store, store.refunds[0].id, "approved"),
    ).toBe("decided");
    expect(await checkRefundStatus(store, 1003)).toMatchObject({
      refundStatus: "approved",
    });
  });

  it("A4: Reject marks a waiting refund rejected", async () => {
    await requestRefund(store, 1003);
    await decideWaitingRefund(store, store.refunds[0].id, "rejected");
    expect(await checkRefundStatus(store, 1003)).toMatchObject({
      refundStatus: "rejected",
    });
  });

  it("can't decide a refund twice, or one that never waited", async () => {
    await requestRefund(store, 1003);
    const id = store.refunds[0].id;
    await decideWaitingRefund(store, id, "rejected");
    expect(await decideWaitingRefund(store, id, "approved")).toBe(
      "not_waiting",
    );
    expect(store.refunds[0].status).toBe("rejected");

    await requestRefund(store, 1001);
    expect(
      await decideWaitingRefund(store, store.refunds[1].id, "rejected"),
    ).toBe("not_waiting");
  });
});

describe("lookupOrder and checkRefundStatus", () => {
  it("lists only the demo customer's orders, with refund status", async () => {
    await requestRefund(store, 1001);
    const result = await lookupOrder(store);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.orders.map((o) => o.orderId)).toEqual([
      1001, 1002, 1003, 1004,
    ]);
    expect(result.orders[0].refundStatus).toBe("refunded_auto");
    expect(result.orders[1].refundStatus).toBe("paid");
  });

  it("finds one order by number", async () => {
    expect(await lookupOrder(store, 1004)).toEqual({
      status: "ok",
      orders: [
        {
          orderId: 1004,
          item: "Copper Home",
          amountUsd: 149,
          orderedAt: "2026-11-10",
          refundStatus: "paid",
        },
      ],
    });
    expect(await lookupOrder(store, 2001)).toEqual({
      status: "not_found",
      orderId: 2001,
    });
  });

  it("reports paid when no refund was asked for", async () => {
    expect(await checkRefundStatus(store, 1002)).toMatchObject({
      refundStatus: "paid",
    });
    expect(await checkRefundStatus(store, 9999)).toMatchObject({
      status: "not_found",
    });
  });
});

describe("setRefundLimit", () => {
  it("saves a limit rounded to cents", async () => {
    expect(await setRefundLimit(store, 25.555)).toBe(25.56);
    expect(store.limitUsd).toBe(25.56);
  });

  it("refuses negative, huge or non-numbers and keeps the old limit", async () => {
    for (const bad of [-1, 10_001, Number.NaN, Infinity]) {
      expect(await setRefundLimit(store, bad)).toBeNull();
    }
    expect(store.limitUsd).toBe(50);
  });
});
