// Where the refund flow keeps its data: the Supabase `orders`, `refunds` and
// `refund_settings` tables (supabase/migrations). This is the only file that
// knows that; the rules in lib/copper/refunds.ts only see a RefundStore.
// It writes with the secret key, so it must only ever run on the server.
import {
  DEFAULT_LIMIT_USD,
  type Order,
  type Refund,
  type RefundStatus,
  type RefundStore,
} from "@/lib/copper/refunds";
import { createSecretClient } from "@/lib/supabase/server";

type OrderRow = {
  id: number;
  customer: string;
  item: string;
  amount_usd: number | string;
  ordered_at: string;
};

type RefundRow = {
  id: number;
  order_id: number;
  amount_usd: number | string;
  limit_usd: number | string;
  status: RefundStatus;
  requested_at: string;
  decided_at: string | null;
};

const ORDER_COLUMNS = "id, customer, item, amount_usd, ordered_at";
const REFUND_COLUMNS =
  "id, order_id, amount_usd, limit_usd, status, requested_at, decided_at";

/** Postgres's "unique value already exists" error. */
const UNIQUE_VIOLATION = "23505";

const toOrder = (row: OrderRow): Order => ({
  id: row.id,
  customer: row.customer,
  item: row.item,
  amountUsd: Number(row.amount_usd),
  orderedAt: row.ordered_at,
});

const toRefund = (row: RefundRow): Refund => ({
  id: row.id,
  orderId: row.order_id,
  amountUsd: Number(row.amount_usd),
  limitUsd: Number(row.limit_usd),
  status: row.status,
  requestedAt: row.requested_at,
  decidedAt: row.decided_at,
});

/** Throws, so the rules report "unavailable" instead of guessing. */
function check<T>({
  data,
  error,
}: {
  data: T;
  error: { message: string } | null;
}) {
  if (error) throw new Error(error.message);
  return data;
}

/** The Supabase refund store, or null when the secret key isn't set. */
export function createRefundStore(): RefundStore | null {
  const supabase = createSecretClient();
  if (!supabase) return null;

  return {
    async getOrder(id) {
      const row = check(
        await supabase
          .from("orders")
          .select(ORDER_COLUMNS)
          .eq("id", id)
          .maybeSingle<OrderRow>(),
      );
      return row ? toOrder(row) : null;
    },

    async listOrders(customer) {
      const rows = check(
        await supabase
          .from("orders")
          .select(ORDER_COLUMNS)
          .eq("customer", customer)
          .order("id")
          .overrideTypes<OrderRow[], { merge: false }>(),
      );
      return (rows ?? []).map(toOrder);
    },

    async getRefundForOrder(orderId) {
      const row = check(
        await supabase
          .from("refunds")
          .select(REFUND_COLUMNS)
          .eq("order_id", orderId)
          .maybeSingle<RefundRow>(),
      );
      return row ? toRefund(row) : null;
    },

    async listRefunds() {
      const rows = check(
        await supabase
          .from("refunds")
          .select(REFUND_COLUMNS)
          .order("requested_at")
          .overrideTypes<RefundRow[], { merge: false }>(),
      );
      return (rows ?? []).map(toRefund);
    },

    async getLimit() {
      const row = check(
        await supabase
          .from("refund_settings")
          .select("auto_refund_limit_usd")
          .eq("id", 1)
          .maybeSingle<{ auto_refund_limit_usd: number | string }>(),
      );
      return row ? Number(row.auto_refund_limit_usd) : DEFAULT_LIMIT_USD;
    },

    async setLimit(limitUsd) {
      check(
        await supabase
          .from("refund_settings")
          .upsert({ id: 1, auto_refund_limit_usd: limitUsd }),
      );
    },

    async insertRefund(refund) {
      const { data, error } = await supabase
        .from("refunds")
        .insert({
          order_id: refund.orderId,
          amount_usd: refund.amountUsd,
          limit_usd: refund.limitUsd,
          status: refund.status,
          ...(refund.status === "refunded_auto" && {
            decided_at: new Date().toISOString(),
          }),
        })
        .select(REFUND_COLUMNS)
        .single<RefundRow>();
      if (error?.code === UNIQUE_VIOLATION) return "duplicate";
      const row = check({ data, error });
      if (!row) throw new Error("the refund wasn't saved");
      return toRefund(row);
    },

    async decideRefund(refundId, status) {
      // Only a refund that's still waiting changes, so a double click or two
      // people deciding at once can't decide it twice.
      const row = check(
        await supabase
          .from("refunds")
          .update({ status, decided_at: new Date().toISOString() })
          .eq("id", refundId)
          .eq("status", "waiting")
          .select(REFUND_COLUMNS)
          .maybeSingle<RefundRow>(),
      );
      return row ? toRefund(row) : null;
    },

    async reset() {
      check(await supabase.from("refunds").delete().gte("id", 0));
      check(
        await supabase
          .from("refund_settings")
          .upsert({ id: 1, auto_refund_limit_usd: DEFAULT_LIMIT_USD }),
      );
    },
  };
}
