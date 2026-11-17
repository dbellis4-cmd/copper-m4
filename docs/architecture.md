# Architecture

How the Copper State Labs app fits together. Each module adds a section at the
end (see [Adding a module](#adding-a-module)) when it changes how the app
works: new pages, tables or AI calls.

_Fictional — for educational use._

## The starter app (Module 0)

A Next.js app that builds, runs and deploys with **no environment variables**.
A Google AI Studio key is optional until a module needs one.

| Piece | Where | What it does |
|---|---|---|
| Pages | `app/` | `layout.tsx` sets the fonts and theme; `page.tsx` is the placeholder home page |
| Brand components | `components/copper/` | `Logo`, `SiteHeader`, `SiteFooter`, `ModeToggle` |
| UI kit | `components/ui/` (shadcn), `components/ai-elements/` (AI Elements) | The only UI libraries the app uses |
| Setup card | `components/setup-required.tsx` | `<SetupRequired service="ai" />`, shown instead of a page whose service isn't configured |
| Company catalog | `lib/copper/catalog.ts`, `lib/copper/data/catalog.json` | Product, plan and privacy facts from the Product Bible (Sections 3, 4, 8 and 10). Pages read prices and plan details from here instead of typing them (added in the Module 1 starter) |
| AI wrapper | `lib/ai/call.ts` | `callText` and `callObject`: every model call goes through these and is logged to the terminal |
| Models and prices | `lib/ai/models.ts`, `lib/ai/pricing.ts` | The approved Gemini models and their token prices |

## Data flow

1. A user opens a page in `app/`.
2. Server code checks what's configured (`isAiConfigured()`). If the key is
   missing, the page renders `<SetupRequired />` instead of crashing.
3. Data comes from files under `lib/copper/data/`.
4. AI requests go through `callText` / `callObject` in `lib/ai/call.ts`, which
   calls Google and then prints one `[ai_calls]` line: `module`, `feature`,
   `model`, tokens, `cost_usd`, `latency_ms`, `ok`.

```ts
const { text } = await callText(
  { module: 2, feature: "ask-copper" },
  { prompt },
);
```

## Two kinds of "AI tiers"

Don't mix these up:

- **Copper State Labs' product tiers** (On-device, Raw Ore, Refined, the
  Copper Cloud) are part of the fictional company. They are facts in the
  [Product Bible](copper-state-labs/product-bible.md) and rows in the `ai_tiers`
  table.
- **The models this app calls** are real Claude models listed in
  `lib/ai/models.ts`. Their cost is logged in `ai_calls`.

## Decisions

- **No environment variables required.** Every service is optional, so a fresh
  clone builds and deploys before any accounts are set up.
- **One AI wrapper.** Routing every call through `lib/ai/call.ts` gives one
  place to log cost and latency per module and feature.
- **No authentication or row-level security yet.** They arrive in a later
  module.

## Adding a module

When a module changes how the app fits together, add a section here:

```md
## Module N: <feature name>

**Summary:** one or two sentences: what this adds and why.

| Piece | Where | What it does |
|---|---|---|
| Page / route | `app/...` | |
| Components | `components/...` | |
| Data | `lib/copper/data/...` | Data files added |
| AI calls | `lib/ai/call.ts` (module, feature) | Model, prompt purpose, expected cost per call |

**Data flow:** user action → page → server code → database / model → response.

**Decisions and trade-offs:** what you chose, the alternatives, and why.

**Risks and open questions:** cost, privacy, accuracy or safety risks, and how
you handle them.
```

## Module 3 starter: Ask Copper

**Summary:** Ask Copper, the Module 2 shopping chatbot, finished: a floating
chat panel that answers prices, totals and stock with four tools and shows
each step. Module 3 teaches it to answer from the customer documents.

| Piece | Where | What it does |
|---|---|---|
| Component | `components/copper/ask-copper.tsx` | The launcher and chat panel, mounted from `app/page.tsx` and opened by the header's `#ask` link. Draws each answer as stations: the tools on offer, thinking, each tool call, then the reply |
| Server Action | `lib/copper/assistant/ask.ts` | `askCopper()`: streams the conversation with `callStream`, up to 5 steps, and sends each step back as a live `Progress` |
| Tools | `lib/copper/assistant/tools.ts` | `copperTools`: `get_products`, `get_prices`, `calculate_cost`, `check_availability` |
| Instructions | `lib/copper/assistant/instructions.ts` | `COPPER_INSTRUCTIONS`. Copper says it can't help yet with warranty, setup, troubleshooting or privacy |
| Data | `lib/copper/inventory.ts`, `lib/copper/documents.ts` | Stock from `lib/copper/data/inventory.json`; `DOCUMENTS`: the four customer documents and their PDF paths under `public/docs/`. The PDFs are added in class |
| AI calls | `{ module: 2, feature: "ask-copper" }` | One streamed call per question |

## Module 3: Document passages and embeddings

**Summary:** The four customer PDFs in `public/docs/` are split into passages
of a few sentences and embedded with Gemini, so Ask Copper can find the
passages that answer a question and cite their page.

| Piece | Where | What it does |
|---|---|---|
| Build script | `scripts/embed-docs.mjs` (`npm run embed-docs`) | Reads each PDF in `DOCUMENTS` page by page (with `unpdf`), splits pages with `splitPage()`, embeds every passage and writes the JSON. Re-run it when a PDF changes |
| Splitter | `lib/copper/split-passages.ts` | `splitPage()`: drops the footer lines, then groups sentences three at a time (at most ~600 characters) |
| Data | `lib/copper/data/passages.json`, `lib/copper/passages.ts` | `PASSAGES`: `documentId`, `title`, `page`, `text` (starts with the document title) and `embedding`. Importing it loads every passage into memory once per server |
| Tool | `lib/copper/assistant/tools.ts` | `search_docs`: embeds the question, ranks every passage by cosine similarity and returns the 5 closest with title, page, a `/docs/<file>.pdf#page=N` link and a score. The tool card lists them with links; the instructions tell Copper to use it for setup, troubleshooting, warranty and policy questions and to cite the page |
| Citations | `lib/copper/assistant/citations.ts`, `lib/copper/assistant/instructions.ts` | Copper answers document questions only from `search_docs`, ends every sentence with `[Title, p. N]`, and says "I couldn't find that in our support docs" otherwise. `splitCitations()` lets the panel link each citation to that PDF page; unknown titles stay plain text |
| AI calls | `callEmbedMany` in `lib/ai/call.ts`, `{ module: 3, feature: "embed-docs" }` | `gemini-embedding-2` at 768 dimensions. One call per run of the script, plus one `{ module: 3, feature: "search-docs" }` call per search. Google doesn't report embedding tokens, so the log's tokens and cost are null |

**Data flow:** PDF → pages → passages → Gemini embeddings → `passages.json` →
`PASSAGES` in memory. Question → `search_docs` → question embedding → 5
closest passages → Copper answers from them and cites the page.

**Decisions and trade-offs:** A JSON file in memory instead of a vector
database: about 120 passages is under 1 MB, so searching all of them is
instant and needs no new service. 768 dimensions instead of 3072 keeps the
file small with little loss in accuracy. The title goes at the start of each
passage so similar passages from different documents (Copper Home vs. Copper
Notes) embed differently.

**Risks and open questions:** Questions must be embedded with the same model
and dimensions (`EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`) or the search
returns nonsense. Tables lose their columns when turned into text. Embeddings match meaning
better than exact strings, so an error code like C-47 can rank below other
error-code passages (it was third in testing); keyword search alongside would fix that.

## Module 4 starter: Support page

**Summary:** An empty Support page titled "Refund Console", with Ask Copper
(as finished in Module 3) docked on the right. Module 4 builds refunds here: a
second agent, and a person approving the large ones.

| Piece | Where | What it does |
|---|---|---|
| Page | `app/support/page.tsx` | The "Refund Console" title and nothing else yet, linked from the header as Support |
| Chat panel | `components/copper/ask-copper.tsx` | With the `docked` prop it starts open and the page beside it stays clickable. It is the same single agent and tools as on the home page |

## Module 4: Refund agent and Refund Console

**Summary:** Copper hands refund requests to a second agent, the Refund agent,
with its own instructions and tools. The app (not the model) compares the
order amount with an auto-refund limit: at or under it, the refund goes
through; over it, it waits for a person to Approve or Reject in the Refund
Console on `/support`. The spec is `specs/module-4/spec.md`.

| Piece | Where | What it does |
|---|---|---|
| Page | `app/support/page.tsx` | The Refund Console beside the docked chat. Shows `<SetupRequired service="refunds" />` when the Supabase variables aren't set. No login: this is a demo |
| Components | `components/copper/refund-console.tsx`, `components/copper/refund-status.tsx` | The limit box, "Waiting for your approval" with Approve/Reject, the demo customer's orders with a status pill, and Reset demo. Loads in the browser and reloads when the chat fires `REFUNDS_CHANGED` or the tab regains focus |
| Server Actions | `lib/copper/refund-console.ts` | `loadConsole`, `decideRefund`, `saveLimit`, `resetDemo`. Each returns the fresh view. The only way to approve or reject a refund |
| Refund rules | `lib/copper/refunds.ts` | `requestRefund()`: amount from the order, never the chat; at or under the limit → `refunded_auto`, over → `waiting`; one refund per order; only the demo customer's orders. Also `lookupOrder`, `checkRefundStatus`, `decideWaitingRefund`, `setRefundLimit` (0 to 10,000), `consoleView` |
| Data | `supabase/migrations/20261117000000_refunds.sql`, `lib/copper/refund-store.ts` | Tables `orders` (Maya Reyes's 4 orders), `refunds` (unique per order) and `refund_settings` (one row: the limit, default $50). Row-level security lets anyone read and nobody write; the server writes with `SUPABASE_SECRET_KEY` via `createSecretClient()` |
| Agents and tools | `lib/copper/assistant/ask.ts`, `refund-tools.ts`, `instructions.ts`, `progress.ts` | Copper gains `transfer_to_refund_agent`. The Refund agent has `REFUND_INSTRUCTIONS` and `lookup_order`, `request_refund`, `check_refund_status`, `search_docs`, `transfer_back_to_copper`. A hand-off tool stops the current agent (`hasToolCall`) and the other one answers the same question; at most 2 hand-offs per question. `Progress.agent` says who answered, and the chat sends it back as `agent` with the next question |
| Chat panel | `components/copper/ask-copper.tsx` | Labels each step and the reply with its agent, shows a "Now talking: Refund agent" station with that agent's tools, and draws refund results with the status pill |
| AI calls | `{ module: 2, feature: "ask-copper" }`, `{ module: 4, feature: "refund-agent" }` | One streamed call per agent per question, so a hand-off logs two rows. A refund question takes 2–4 model requests |

**Data flow:** customer asks for a refund → Copper calls
`transfer_to_refund_agent` → Refund agent calls `request_refund(orderId)` →
`requestRefund()` reads the order and the limit from Supabase and saves a
refund as `refunded_auto` or `waiting` → the chat fires `REFUNDS_CHANGED` and
the console reloads → a person clicks Approve or Reject → `decideRefund()`
updates the row (only if still waiting) → the customer asks again and
`check_refund_status` reports it.

**Decisions and trade-offs:** The rule is code, not instructions, so the model
can't be talked past it: `request_refund` takes only an order number, and no
tool can approve. Supabase instead of memory, so refunds survive restarts and
deploys; the secret key stays on the server (no `NEXT_PUBLIC_` prefix). A
unique `order_id` blocks a second refund for an order even if two requests
arrive at once. The console loads in the browser rather than on the server so
the page never waits on the database. One demo customer and no login keep the
demo simple.

**Risks and open questions:** Anyone who opens `/support` can approve refunds
or change the limit: fine for a demo, not for production (needs login and
roles). The free Google key allows 20 requests a day, and a full demo uses
about 10; when it runs out the chat says "Sorry" and the terminal logs
`[ask-copper] ... failed:` with Google's reason. Free keys can't use Gemini
2.5 Flash, so set `AI_MODEL=google/gemini-3-flash` locally and on Vercel. Not
yet handled: partial refunds, return windows (30 days for devices; Copper Plus
terms), and cancelling a waiting request.
