// The Refund agent's tools (Module 4), plus the hand-off tool Copper uses to
// reach it. Each one calls the refund rules in lib/copper/refunds.ts, so the
// model never decides a refund itself: it only passes an order number, and
// the app compares the order's amount with the limit.
// There is deliberately no tool to approve a refund. Only a person in the
// Refund Console can.
import { tool } from "ai";
import { z } from "zod";
import { copperTools } from "@/lib/copper/assistant/tools";
import { createRefundStore } from "@/lib/copper/refund-store";
import {
  checkRefundStatus,
  lookupOrder,
  requestRefund,
  type RefundStore,
} from "@/lib/copper/refunds";

const UNAVAILABLE = {
  status: "unavailable",
  message: "Refunds can't be processed right now. Please try again soon.",
} as const;

/** Runs `run` with the refund store, or says refunds are unavailable. */
async function withStore<T>(run: (store: RefundStore) => Promise<T>) {
  const store = createRefundStore();
  return store ? run(store) : UNAVAILABLE;
}

const orderId = z
  .number()
  .int()
  .positive()
  .describe("The order number, e.g. 1001. Digits only, without the #.");

/** Copper's tool for handing the chat to the Refund agent. */
export const transferToRefundAgent = tool({
  description:
    "Hands the chat to the Refund agent. Use it whenever the customer wants a refund, or asks where a refund they requested stands.",
  inputSchema: z.object({}),
  execute: async () => ({
    transferred: true,
    to: "Refund agent",
  }),
});

export const refundTools = {
  lookup_order: tool({
    description:
      "Finds one of the customer's orders by its number, with its amount and refund status. Leave out the order number to list all of the customer's orders.",
    inputSchema: z.object({ orderId: orderId.optional() }),
    execute: async ({ orderId }) =>
      withStore((store) => lookupOrder(store, orderId)),
  }),
  request_refund: tool({
    description:
      "Asks the app to refund one order. The app decides: at or under the auto-refund limit it is refunded now; over the limit it waits for a person to approve or reject it. One refund per order.",
    inputSchema: z.object({ orderId }),
    execute: async ({ orderId }) =>
      withStore((store) => requestRefund(store, orderId)),
  }),
  check_refund_status: tool({
    description:
      "Checks where an order's refund stands: paid (no refund asked for), refunded_auto, waiting, approved or rejected.",
    inputSchema: z.object({ orderId }),
    execute: async ({ orderId }) =>
      withStore((store) => checkRefundStatus(store, orderId)),
  }),
  search_docs: copperTools.search_docs,
  transfer_back_to_copper: tool({
    description:
      "Hands the chat back to Copper. Use it when the customer asks about anything other than refunds, such as products, prices, stock or setup.",
    inputSchema: z.object({}),
    execute: async () => ({ transferred: true, to: "Copper" }),
  }),
};
