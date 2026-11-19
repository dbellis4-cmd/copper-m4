"use client";

// The Refund Console (Module 4): the internal page where a person sets the
// auto-refund limit and approves or rejects refunds over it. Every button
// runs a server action (lib/copper/refund-console.ts) and redraws from what
// the database says. It also reloads when the chat beside it makes a refund.
import { RotateCcwIcon } from "lucide-react";
import {
  type FormEvent,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { RefundStatusPill } from "@/components/copper/refund-status";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { formatUsd } from "@/lib/copper/catalog";
import {
  type ConsoleResult,
  decideRefund,
  loadConsole,
  resetDemo,
  saveLimit,
} from "@/lib/copper/refund-console";
import {
  REFUND_DECIDED,
  type RefundDecision,
  REFUNDS_CHANGED,
  type WaitingRefund,
} from "@/lib/copper/refunds";

export function RefundConsole() {
  const [result, setResult] = useState<ConsoleResult | null>(null);
  const [limitDraft, setLimitDraft] = useState("");
  const [pending, startTransition] = useTransition();
  // Counts requests, so a slow older one can't overwrite a newer answer.
  const latest = useRef(0);
  // How many button changes are still saving: background reloads wait.
  const saving = useRef(0);
  // True while someone is typing a new limit, so a reload won't replace it.
  const editing = useRef(false);

  /**
   * Runs a server action and shows the fresh view it returns. A background
   * reload is skipped while a change is saving (the change's own answer is
   * fresher).
   */
  function run(action: () => Promise<ConsoleResult>, { change = false } = {}) {
    if (!change && saving.current > 0) return;
    const request = ++latest.current;
    if (change) saving.current++;
    startTransition(async () => {
      try {
        const next = await action();
        if (request !== latest.current) return;
        startTransition(() => {
          setResult(next);
          if (next.status === "ok" && !editing.current)
            setLimitDraft(String(next.view.limitUsd));
        });
      } finally {
        if (change) saving.current--;
      }
    });
  }

  /** A button's change: saved, then the page shows the result. */
  const change = (action: () => Promise<ConsoleResult>) =>
    run(action, { change: true });

  /**
   * Approve or Reject. Once the database confirms it, tell the chat beside
   * the console, so the Refund agent can let the customer know.
   */
  const decide = (
    refund: WaitingRefund,
    decision: RefundDecision["decision"],
  ) =>
    change(async () => {
      const result = await decideRefund(refund.refundId, decision);
      if (result.status === "ok" && !result.message) {
        const detail: RefundDecision = {
          orderId: refund.orderId,
          item: refund.item,
          amountUsd: refund.amountUsd,
          decision,
        };
        window.dispatchEvent(new CustomEvent(REFUND_DECIDED, { detail }));
      }
      return result;
    });

  // Load on open, when the chat makes a refund, and when the tab comes back
  // into view (someone may have decided a refund in another tab).
  useEffect(() => {
    const reload = () => run(loadConsole);
    reload();
    window.addEventListener(REFUNDS_CHANGED, reload);
    window.addEventListener("focus", reload);
    return () => {
      window.removeEventListener(REFUNDS_CHANGED, reload);
      window.removeEventListener("focus", reload);
    };
  }, []);

  if (!result)
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <Spinner className="size-4" /> Loading the refunds…
      </p>
    );
  if (result.status === "unavailable")
    return (
      <div className="space-y-3">
        <p className="text-sm">{result.message}</p>
        <Button variant="outline" onClick={() => run(loadConsole)}>
          Try again
        </Button>
      </div>
    );

  const { view, message } = result;
  const limit = formatUsd(view.limitUsd);

  function submitLimit(event: FormEvent) {
    event.preventDefault();
    const value = limitDraft.trim() === "" ? Number.NaN : Number(limitDraft);
    editing.current = false;
    change(() => saveLimit(value));
  }

  return (
    <div className="space-y-8" aria-busy={pending}>
      {message && (
        <p
          role="status"
          className="border-chart-3 bg-chart-3/10 rounded-lg border px-4 py-2 text-sm"
        >
          {message}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Auto-refund limit</CardTitle>
          <CardDescription>
            {view.limitUsd === 0
              ? "Every refund needs your approval."
              : `Refunds up to ${limit} go through on their own. Anything larger needs your approval.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submitLimit} className="flex items-end gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="refund-limit">Limit in dollars</Label>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">$</span>
                <Input
                  id="refund-limit"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={10000}
                  step="0.01"
                  value={limitDraft}
                  onChange={(event) => {
                    editing.current = true;
                    setLimitDraft(event.target.value);
                  }}
                  className="w-32"
                />
              </div>
            </div>
            <Button
              type="submit"
              disabled={pending || limitDraft === String(view.limitUsd)}
            >
              Save limit
            </Button>
          </form>
        </CardContent>
      </Card>

      <section aria-labelledby="waiting-heading" className="space-y-3">
        <h2 id="waiting-heading" className="font-display text-xl font-bold">
          Waiting for your approval
        </h2>
        {view.waiting.length === 0 ? (
          <p className="text-muted-foreground rounded-xl border border-dashed px-4 py-6 text-sm">
            Nothing is waiting. Refunds over the limit will stop here.
          </p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {view.waiting.map((refund) => (
              <li
                key={refund.refundId}
                data-testid="waiting-refund"
                className="flex flex-wrap items-center gap-3 px-4 py-3"
              >
                <span className="text-muted-foreground font-mono">
                  #{refund.orderId}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{refund.item}</p>
                  <p className="text-muted-foreground text-xs">
                    Over the {formatUsd(refund.limitUsd)} limit when requested
                  </p>
                </div>
                <span className="font-mono">{formatUsd(refund.amountUsd)}</span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={pending}
                    aria-label={`Approve refund for order ${refund.orderId}`}
                    onClick={() => decide(refund, "approved")}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={pending}
                    aria-label={`Reject refund for order ${refund.orderId}`}
                    onClick={() => decide(refund, "rejected")}
                  >
                    Reject
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="orders-heading" className="space-y-3">
        <h2 id="orders-heading" className="font-display text-xl font-bold">
          {view.customer}&apos;s orders
        </h2>
        <ul className="divide-y rounded-xl border">
          {view.orders.map((order) => (
            <li
              key={order.orderId}
              data-testid="order"
              className="flex items-center gap-3 px-4 py-3"
            >
              <span className="text-muted-foreground font-mono">
                #{order.orderId}
              </span>
              <span className="min-w-0 flex-1 font-medium">{order.item}</span>
              <RefundStatusPill status={order.refundStatus} />
              <span className="w-16 text-right font-mono">
                {formatUsd(order.amountUsd)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <div className="flex items-center gap-3 border-t pt-4">
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => {
            editing.current = false;
            change(resetDemo);
          }}
        >
          <RotateCcwIcon /> Reset demo
        </Button>
        <p className="text-muted-foreground text-xs">
          Clears every refund and puts the limit back to $50.
        </p>
      </div>
    </div>
  );
}
