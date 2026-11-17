// A refund's status as a colored pill, used by the chat and the Refund
// Console so both name and color each status the same way.
import { type RefundStatus, STATUS_LABELS } from "@/lib/copper/refunds";
import { cn } from "@/lib/utils";

const COLORS: Record<RefundStatus | "paid", string> = {
  paid: "bg-background text-muted-foreground border",
  refunded_auto: "bg-accent text-white",
  waiting: "bg-chart-4 text-chart-5",
  approved: "bg-accent text-white",
  rejected: "bg-chart-3 text-white",
};

export function RefundStatusPill({
  status,
}: {
  status: RefundStatus | "paid";
}) {
  return (
    <span
      data-testid="refund-status"
      data-status={status}
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        COLORS[status] ?? COLORS.paid,
      )}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
