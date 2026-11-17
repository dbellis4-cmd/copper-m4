"use server";

// The Refund Console's server actions: the code its buttons run on the
// server. Each one returns the console's fresh view, so the page redraws with
// what's really in the database. These are the only way to approve or reject
// a refund: the chat's agents have no tool that reaches them.
// No login: this is a demo, so anyone who opens /support can use them.
import { createRefundStore } from "@/lib/copper/refund-store";
import {
  type ConsoleView,
  consoleView,
  decideWaitingRefund,
  type RefundStore,
  setRefundLimit,
} from "@/lib/copper/refunds";

export type ConsoleResult =
  | { status: "ok"; view: ConsoleView; message?: string }
  | { status: "unavailable"; message: string };

const UNAVAILABLE: ConsoleResult = {
  status: "unavailable",
  message: "The refund database can't be reached right now. Try again soon.",
};

/** Runs `change` (if any), then reads the fresh view. */
async function withView(
  change?: (store: RefundStore) => Promise<string | undefined>,
): Promise<ConsoleResult> {
  const store = createRefundStore();
  if (!store) return UNAVAILABLE;
  try {
    const message = await change?.(store);
    return { status: "ok", view: await consoleView(store), message };
  } catch {
    return UNAVAILABLE;
  }
}

/** The console's current view. */
export async function loadConsole(): Promise<ConsoleResult> {
  return withView();
}

/** The Approve and Reject buttons. */
export async function decideRefund(
  refundId: number,
  decision: "approved" | "rejected",
): Promise<ConsoleResult> {
  return withView(async (store) =>
    (await decideWaitingRefund(store, refundId, decision)) === "decided"
      ? undefined
      : "That refund was already decided.",
  );
}

/** The auto-refund limit box. */
export async function saveLimit(limitUsd: number): Promise<ConsoleResult> {
  return withView(async (store) =>
    (await setRefundLimit(store, limitUsd)) === null
      ? "Enter a limit from $0 to $10,000."
      : undefined,
  );
}

/** The Reset demo button: no refunds, and the limit back to $50. */
export async function resetDemo(): Promise<ConsoleResult> {
  return withView(async (store) => {
    await store.reset();
    return undefined;
  });
}
