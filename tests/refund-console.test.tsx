// Module 4: the Refund Console on /support (specs/module-4/spec.md, section
// 5). Uses the in-memory refund store, so no database is needed.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  consoleView,
  REFUNDS_CHANGED,
  requestRefund,
} from "@/lib/copper/refunds";
import {
  createFakeRefundStore,
  type FakeRefundStore,
} from "./helpers/fake-refund-store";

let store: FakeRefundStore | null;
vi.mock("@/lib/copper/refund-store", () => ({
  createRefundStore: () => store,
}));

beforeEach(() => {
  store = createFakeRefundStore();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.resetModules();
});

const fake = () => store as FakeRefundStore;

describe("consoleView", () => {
  it("lists the demo customer's orders with status, and the refunds waiting", async () => {
    await requestRefund(fake(), 1001);
    await requestRefund(fake(), 1004);
    const view = await consoleView(fake());
    expect(view.customer).toBe("Maya Reyes");
    expect(view.limitUsd).toBe(50);
    expect(view.orders.map((o) => [o.orderId, o.refundStatus])).toEqual([
      [1001, "refunded_auto"],
      [1002, "paid"],
      [1003, "paid"],
      [1004, "waiting"],
    ]);
    expect(view.waiting).toEqual([
      expect.objectContaining({
        orderId: 1004,
        item: "Copper Home",
        amountUsd: 149,
        limitUsd: 50,
      }),
    ]);
  });
});

describe("The console's server actions", () => {
  it("A3/A4: Approve and Reject decide a waiting refund once", async () => {
    const { decideRefund } = await import("@/lib/copper/refund-console");
    await requestRefund(fake(), 1003);
    const id = fake().refunds[0].id;

    const approved = await decideRefund(id, "approved");
    expect(approved).toMatchObject({ status: "ok" });
    if (approved.status !== "ok") return;
    expect(approved.view.waiting).toEqual([]);
    expect(approved.view.orders[2].refundStatus).toBe("approved");

    // A second click (or a second person) can't change it.
    expect(await decideRefund(id, "rejected")).toMatchObject({
      status: "ok",
      message: "That refund was already decided.",
    });
    expect(fake().refunds[0].status).toBe("approved");
  });

  it("saves a new limit, and refuses one that isn't a number from 0 to 10,000", async () => {
    const { saveLimit } = await import("@/lib/copper/refund-console");
    expect(await saveLimit(0)).toMatchObject({
      status: "ok",
      view: { limitUsd: 0 },
    });
    expect(await saveLimit(-5)).toMatchObject({
      message: "Enter a limit from $0 to $10,000.",
      view: { limitUsd: 0 },
    });
  });

  it("Reset demo clears every refund and puts the limit back to $50", async () => {
    const { resetDemo, saveLimit } =
      await import("@/lib/copper/refund-console");
    await saveLimit(10);
    await requestRefund(fake(), 1001);
    const reset = await resetDemo();
    expect(reset).toMatchObject({ status: "ok", view: { limitUsd: 50 } });
    expect(fake().refunds).toEqual([]);
  });

  it("says the database can't be reached when Supabase isn't set up or is down", async () => {
    const { loadConsole } = await import("@/lib/copper/refund-console");
    fake().down = true;
    expect(await loadConsole()).toMatchObject({ status: "unavailable" });
    store = null;
    expect(await loadConsole()).toMatchObject({ status: "unavailable" });
  });
});

async function renderConsole() {
  const { RefundConsole } = await import("@/components/copper/refund-console");
  render(<RefundConsole />);
  await screen.findByRole("heading", { name: "Waiting for your approval" });
  // Wait until the first load has finished and the buttons can be clicked.
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /reset demo/i })).toBeEnabled(),
  );
}

/** Generous, because the full test suite runs many files at once. */
const slow = { timeout: 5000 };

describe("The Refund Console page", () => {
  it("shows the limit, an empty approval list and Maya's orders", async () => {
    await renderConsole();
    expect(screen.getByLabelText("Limit in dollars")).toHaveValue(50);
    expect(
      screen.getByText(
        "Refunds up to $50 go through on their own. Anything larger needs your approval.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Nothing is waiting/)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Maya Reyes's orders" }),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("order")).toHaveLength(4);
  });

  it("A3: a waiting refund can be approved, and its order shows Approved", async () => {
    await requestRefund(fake(), 1004);
    await renderConsole();
    const row = screen.getByTestId("waiting-refund");
    expect(within(row).getByText("Copper Home")).toBeInTheDocument();
    expect(within(row).getByText("$149")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Approve refund for order 1004" }),
    );
    await waitFor(
      () => expect(screen.queryByTestId("waiting-refund")).toBeNull(),
      slow,
    );
    const order = screen.getAllByTestId("order")[3];
    expect(within(order).getByText("Approved")).toBeInTheDocument();
  });

  it("A4: Reject marks it rejected", async () => {
    await requestRefund(fake(), 1003);
    await renderConsole();
    fireEvent.click(
      screen.getByRole("button", { name: "Reject refund for order 1003" }),
    );
    await waitFor(
      () =>
        expect(
          within(screen.getAllByTestId("order")[2]).getByText("Rejected"),
        ).toBeInTheDocument(),
      slow,
    );
  });

  it("A7: setting the limit to $0 says every refund needs approval", async () => {
    await renderConsole();
    fireEvent.change(screen.getByLabelText("Limit in dollars"), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save limit" }));
    await waitFor(
      () =>
        expect(
          screen.getByText("Every refund needs your approval."),
        ).toBeInTheDocument(),
      slow,
    );
    expect(fake().limitUsd).toBe(0);
  });

  it("a reload doesn't wipe a limit someone is still typing", async () => {
    await renderConsole();
    const box = screen.getByLabelText("Limit in dollars");
    fireEvent.change(box, { target: { value: "25" } });
    // Clicking back into the page reloads it.
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(
      () =>
        expect(
          screen.getByRole("button", { name: /reset demo/i }),
        ).toBeEnabled(),
      slow,
    );
    expect(box).toHaveValue(25);
    fireEvent.click(screen.getByRole("button", { name: "Save limit" }));
    await waitFor(() => expect(fake().limitUsd).toBe(25), slow);
  });

  it("reloads when the chat makes a refund", async () => {
    await renderConsole();
    expect(screen.queryByTestId("waiting-refund")).toBeNull();
    await requestRefund(fake(), 1003);
    await act(async () => {
      window.dispatchEvent(new Event(REFUNDS_CHANGED));
    });
    await waitFor(
      () => expect(screen.getByTestId("waiting-refund")).toBeInTheDocument(),
      slow,
    );
  });

  it("shows the Supabase setup card on /support when Supabase isn't set up", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    const { default: Support } = await import("@/app/support/page");
    render(<Support />);
    const main = within(screen.getByTestId("refund-console"));
    expect(main.getByText(/set up supabase/i)).toBeInTheDocument();
    expect(main.getByText("SUPABASE_SECRET_KEY")).toBeInTheDocument();
  });

  it("shows the console on /support when Supabase is set up", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
    const { default: Support } = await import("@/app/support/page");
    render(<Support />);
    expect(
      await screen.findByRole("heading", { name: "Waiting for your approval" }),
    ).toBeInTheDocument();
  });
});
