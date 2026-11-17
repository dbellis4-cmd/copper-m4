import type { Metadata } from "next";
import { AskCopper } from "@/components/copper/ask-copper";
import { RefundConsole } from "@/components/copper/refund-console";
import { SiteHeader } from "@/components/copper/site-header";
import { SetupRequired } from "@/components/setup-required";
import { isAiConfigured } from "@/lib/ai/call";
import { isRefundsConfigured } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Support | Copper State Labs" };

// The Refund Console (Module 4): an internal page with no login, since this
// is a demo. The console loads its data in the browser, so this page stays
// simple and never waits on the database.
export default function Support() {
  return (
    // Leaves room on the right for the docked chat.
    <div className="flex flex-1 flex-col lg:pr-[28rem]">
      <SiteHeader />
      <main
        data-testid="refund-console"
        className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-8"
      >
        <div className="space-y-2">
          <h1 className="font-display text-3xl font-bold">Refund Console</h1>
          <p className="text-muted-foreground">
            Ask for a refund in the chat as the customer. Copper hands you to
            the Refund agent, which asks the app for the refund. The app checks
            the amount against your limit: at or under it, the refund goes
            through; over it, it waits here for you.
          </p>
        </div>
        {isRefundsConfigured() ? (
          <RefundConsole />
        ) : (
          <SetupRequired service="refunds" />
        )}
      </main>
      <AskCopper aiConfigured={isAiConfigured()} docked />
    </div>
  );
}
