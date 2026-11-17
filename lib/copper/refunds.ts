// The refund rules (specs/module-4/spec.md, section 4). This is the code that
// decides a refund, so the model can't argue past it: the Refund agent's tools
// call these functions, and the amount always comes from the order, never from
// the chat.
// Where the data lives is hidden behind RefundStore, so tests can use a fake
// store and the app uses Supabase (lib/copper/refund-store.ts).

/** The demo has one customer and no login, so the chat always acts as her. */
export const DEMO_CUSTOMER = "Maya Reyes";

/** The limit the demo starts with, and goes back to on reset. */
export const DEFAULT_LIMIT_USD = 50;

/** The highest limit the console accepts. */
export const MAX_LIMIT_USD = 10_000;

export type Order = {
  id: number;
  customer: string;
  item: string;
  amountUsd: number;
  orderedAt: string;
};

export type RefundStatus =
  "refunded_auto" | "waiting" | "approved" | "rejected";

/** How the chat and the console name each status ("paid": no refund yet). */
export const STATUS_LABELS: Record<RefundStatus | "paid", string> = {
  paid: "Paid",
  refunded_auto: "Refunded automatically",
  waiting: "Waiting for approval",
  approved: "Approved",
  rejected: "Rejected",
};

export type Refund = {
  id: number;
  orderId: number;
  amountUsd: number;
  /** The limit when the refund was requested. */
  limitUsd: number;
  status: RefundStatus;
  requestedAt: string;
  decidedAt: string | null;
};

/** Where orders, refunds and the limit are kept. Methods throw if it's down. */
export interface RefundStore {
  getOrder(id: number): Promise<Order | null>;
  listOrders(customer: string): Promise<Order[]>;
  getRefundForOrder(orderId: number): Promise<Refund | null>;
  listRefunds(): Promise<Refund[]>;
  getLimit(): Promise<number>;
  setLimit(limitUsd: number): Promise<void>;
  /** Returns "duplicate" if the order already has a refund. */
  insertRefund(
    refund: Pick<Refund, "orderId" | "amountUsd" | "limitUsd" | "status">,
  ): Promise<Refund | "duplicate">;
  /** Approves or rejects a refund only if it's still waiting; else null. */
  decideRefund(
    refundId: number,
    status: "approved" | "rejected",
  ): Promise<Refund | null>;
  /** Deletes every refund and puts the limit back to the default. */
  reset(): Promise<void>;
}

/** Dollars to whole cents, so $7.99 vs $8.00 compares exactly. */
const cents = (usd: number) => Math.round(usd * 100);

/** The rule itself: at or under the limit goes through; over it waits. */
export function decide(
  amountUsd: number,
  limitUsd: number,
): "refunded_auto" | "waiting" {
  return cents(amountUsd) <= cents(limitUsd) ? "refunded_auto" : "waiting";
}

const UNAVAILABLE = {
  status: "unavailable",
  message: "Refunds can't be processed right now. Please try again soon.",
} as const;

export type Unavailable = typeof UNAVAILABLE;

export type OrderSummary = {
  orderId: number;
  item: string;
  amountUsd: number;
  orderedAt: string;
  /** "paid" when no refund has been asked for. */
  refundStatus: RefundStatus | "paid";
};

const summarize = (order: Order, refund: Refund | null): OrderSummary => ({
  orderId: order.id,
  item: order.item,
  amountUsd: order.amountUsd,
  orderedAt: order.orderedAt,
  refundStatus: refund?.status ?? "paid",
});

/** The demo customer's order, or null if it doesn't exist or isn't hers. */
async function findOwnOrder(store: RefundStore, orderId: number) {
  const order = await store.getOrder(orderId);
  return order && order.customer === DEMO_CUSTOMER ? order : null;
}

export type LookupResult =
  | { status: "ok"; orders: OrderSummary[] }
  | { status: "not_found"; orderId: number }
  | Unavailable;

/** lookup_order: one order by number, or all of the customer's orders. */
export async function lookupOrder(
  store: RefundStore,
  orderId?: number,
): Promise<LookupResult> {
  try {
    if (orderId === undefined) {
      const orders = await store.listOrders(DEMO_CUSTOMER);
      const refunds = await store.listRefunds();
      return {
        status: "ok",
        orders: orders.map((order) =>
          summarize(order, refunds.find((r) => r.orderId === order.id) ?? null),
        ),
      };
    }
    const order = await findOwnOrder(store, orderId);
    if (!order) return { status: "not_found", orderId };
    return {
      status: "ok",
      orders: [summarize(order, await store.getRefundForOrder(order.id))],
    };
  } catch {
    return UNAVAILABLE;
  }
}

export type RefundResult =
  | {
      status: "refunded_auto" | "waiting";
      orderId: number;
      item: string;
      amountUsd: number;
      limitUsd: number;
    }
  | {
      status: "already_requested";
      orderId: number;
      item: string;
      refundStatus: RefundStatus;
    }
  | { status: "not_found"; orderId: number }
  | Unavailable;

/**
 * request_refund: refunds an order now if it's at or under the limit, or
 * leaves it waiting for a person. One refund per order, ever.
 */
export async function requestRefund(
  store: RefundStore,
  orderId: number,
): Promise<RefundResult> {
  try {
    const order = await findOwnOrder(store, orderId);
    if (!order) return { status: "not_found", orderId };

    const already = (refund: Refund) => ({
      status: "already_requested" as const,
      orderId: order.id,
      item: order.item,
      refundStatus: refund.status,
    });
    const existing = await store.getRefundForOrder(order.id);
    if (existing) return already(existing);

    const limitUsd = await store.getLimit();
    const status = decide(order.amountUsd, limitUsd);
    const saved = await store.insertRefund({
      orderId: order.id,
      amountUsd: order.amountUsd,
      limitUsd,
      status,
    });
    if (saved === "duplicate") {
      // Another request for this order landed first.
      const winner = await store.getRefundForOrder(order.id);
      return winner ? already(winner) : UNAVAILABLE;
    }
    return {
      status,
      orderId: order.id,
      item: order.item,
      amountUsd: order.amountUsd,
      limitUsd,
    };
  } catch {
    return UNAVAILABLE;
  }
}

export type StatusResult =
  | {
      status: "ok";
      orderId: number;
      item: string;
      refundStatus: RefundStatus | "paid";
    }
  | { status: "not_found"; orderId: number }
  | Unavailable;

/** check_refund_status: where an order's refund stands. */
export async function checkRefundStatus(
  store: RefundStore,
  orderId: number,
): Promise<StatusResult> {
  try {
    const order = await findOwnOrder(store, orderId);
    if (!order) return { status: "not_found", orderId };
    const refund = await store.getRefundForOrder(order.id);
    return {
      status: "ok",
      orderId: order.id,
      item: order.item,
      refundStatus: refund?.status ?? "paid",
    };
  } catch {
    return UNAVAILABLE;
  }
}

/**
 * The console's Approve and Reject buttons. Only a waiting refund can be
 * decided, and only once. The model has no tool that reaches this.
 */
export async function decideWaitingRefund(
  store: RefundStore,
  refundId: number,
  decision: "approved" | "rejected",
): Promise<"decided" | "not_waiting"> {
  return (await store.decideRefund(refundId, decision))
    ? "decided"
    : "not_waiting";
}

/**
 * The console's limit box. Returns the limit it saved, rounded to cents, or
 * null if the value isn't a number from 0 to MAX_LIMIT_USD.
 */
export async function setRefundLimit(
  store: RefundStore,
  limitUsd: number,
): Promise<number | null> {
  if (!Number.isFinite(limitUsd) || limitUsd < 0 || limitUsd > MAX_LIMIT_USD) {
    return null;
  }
  const rounded = cents(limitUsd) / 100;
  await store.setLimit(rounded);
  return rounded;
}

export type WaitingRefund = {
  refundId: number;
  orderId: number;
  item: string;
  amountUsd: number;
  /** The limit it was over when it was requested. */
  limitUsd: number;
  requestedAt: string;
};

/** Everything the Refund Console shows. */
export type ConsoleView = {
  customer: string;
  limitUsd: number;
  waiting: WaitingRefund[];
  orders: OrderSummary[];
};

/** The Refund Console's view: the limit, refunds waiting, and every order. */
export async function consoleView(store: RefundStore): Promise<ConsoleView> {
  const [orders, refunds, limitUsd] = await Promise.all([
    store.listOrders(DEMO_CUSTOMER),
    store.listRefunds(),
    store.getLimit(),
  ]);
  const refundFor = (orderId: number) =>
    refunds.find((r) => r.orderId === orderId) ?? null;
  return {
    customer: DEMO_CUSTOMER,
    limitUsd,
    waiting: refunds
      .filter((r) => r.status === "waiting")
      .flatMap((r) => {
        const order = orders.find((o) => o.id === r.orderId);
        return order
          ? [
              {
                refundId: r.id,
                orderId: r.orderId,
                item: order.item,
                amountUsd: r.amountUsd,
                limitUsd: r.limitUsd,
                requestedAt: r.requestedAt,
              },
            ]
          : [];
      }),
    orders: orders.map((order) => summarize(order, refundFor(order.id))),
  };
}

/**
 * The browser event the chat fires after a refund tool runs, so the Refund
 * Console on the same page reloads and shows the change.
 */
export const REFUNDS_CHANGED = "copper:refunds-changed";
