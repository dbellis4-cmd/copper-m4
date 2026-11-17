// A refund store kept in memory, for tests. It behaves like the Supabase one:
// one refund per order, and only a waiting refund can be decided.
import {
  DEFAULT_LIMIT_USD,
  type Order,
  type Refund,
  type RefundStore,
} from "@/lib/copper/refunds";

export const DEMO_ORDERS: Order[] = [
  {
    id: 1001,
    customer: "Maya Reyes",
    item: "Copper Plus, monthly",
    amountUsd: 7.99,
    orderedAt: "2026-11-01",
  },
  {
    id: 1002,
    customer: "Maya Reyes",
    item: "Copper Plus, annual",
    amountUsd: 79,
    orderedAt: "2026-11-05",
  },
  {
    id: 1003,
    customer: "Maya Reyes",
    item: "Copper Notes",
    amountUsd: 129,
    orderedAt: "2026-11-08",
  },
  {
    id: 1004,
    customer: "Maya Reyes",
    item: "Copper Home",
    amountUsd: 149,
    orderedAt: "2026-11-10",
  },
  // Someone else's order: the demo customer must never reach it.
  {
    id: 2001,
    customer: "Sam Ortiz",
    item: "Copper Notes",
    amountUsd: 20,
    orderedAt: "2026-11-02",
  },
];

export type FakeRefundStore = RefundStore & {
  refunds: Refund[];
  limitUsd: number;
  /** Set to make every call throw, like a paused database. */
  down: boolean;
};

export function createFakeRefundStore(): FakeRefundStore {
  let nextId = 1;
  const store: FakeRefundStore = {
    refunds: [],
    limitUsd: DEFAULT_LIMIT_USD,
    down: false,

    async getOrder(id) {
      guard();
      return DEMO_ORDERS.find((o) => o.id === id) ?? null;
    },
    async listOrders(customer) {
      guard();
      return DEMO_ORDERS.filter((o) => o.customer === customer);
    },
    async getRefundForOrder(orderId) {
      guard();
      return store.refunds.find((r) => r.orderId === orderId) ?? null;
    },
    async listRefunds() {
      guard();
      return [...store.refunds];
    },
    async getLimit() {
      guard();
      return store.limitUsd;
    },
    async setLimit(limitUsd) {
      guard();
      store.limitUsd = limitUsd;
    },
    async insertRefund(refund) {
      guard();
      if (store.refunds.some((r) => r.orderId === refund.orderId)) {
        return "duplicate";
      }
      const saved: Refund = {
        ...refund,
        id: nextId++,
        requestedAt: new Date().toISOString(),
        decidedAt: null,
      };
      store.refunds.push(saved);
      return saved;
    },
    async decideRefund(refundId, status) {
      guard();
      const refund = store.refunds.find((r) => r.id === refundId);
      if (!refund || refund.status !== "waiting") return null;
      refund.status = status;
      refund.decidedAt = new Date().toISOString();
      return refund;
    },
    async reset() {
      guard();
      store.refunds = [];
      store.limitUsd = DEFAULT_LIMIT_USD;
    },
  };

  function guard() {
    if (store.down) throw new Error("database is down");
  }
  return store;
}
