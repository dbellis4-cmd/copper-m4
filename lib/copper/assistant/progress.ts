// What Ask Copper is doing, step by step, as it streams in: Gemini's thinking
// summaries, each tool call (with what went in and what came out), and the
// reply. The panel draws this as it changes.
// Two agents can take part in one answer: Copper, and the Refund agent it
// hands refunds to (Module 4). Each step says which agent took it.

/** Who is talking: Copper, or the Refund agent that handles refunds. */
export type AgentId = "copper" | "refund";

export const AGENT_NAMES: Record<AgentId, string> = {
  copper: "Copper",
  refund: "Refund agent",
};

export type ThinkingStep = { type: "thinking"; text: string; agent?: AgentId };

export type ToolStep = {
  type: "tool";
  id: string;
  name: string;
  /** "calling" until the tool's result comes back. */
  state: "calling" | "done" | "error";
  input?: unknown;
  output?: unknown;
  agent?: AgentId;
};

export type Step = ThinkingStep | ToolStep;

export type Progress = {
  steps: Step[];
  reply: string;
  status: "working" | "done" | "error";
  /** Who wrote the reply, and so who answers the next question. */
  agent?: AgentId;
};

/** Every tool call in an answer, in order. */
export function toolCallsOf(progress: Progress) {
  return progress.steps
    .filter((step): step is ToolStep => step.type === "tool")
    .map(({ name, input, output }) => ({ name, input, output }));
}

/**
 * Every tool, and what it does in plain English. The chat panel lists these,
 * so they live here (and not in tools.ts or refund-tools.ts, which read the
 * database and can't be imported by a client component).
 */
export const TOOL_LABELS: Record<string, string> = {
  get_products: "Listing the products",
  get_prices: "Looking up prices",
  calculate_cost: "Working out the cost",
  check_availability: "Checking stock",
  search_docs: "Searching the documents",
  transfer_to_refund_agent: "Handing off to the Refund agent",
  lookup_order: "Looking up the order",
  request_refund: "Requesting the refund",
  check_refund_status: "Checking the refund",
  transfer_back_to_copper: "Handing back to Copper",
};

/** The tools each agent can use, in the order the panel lists them. */
export const AGENT_TOOLS: Record<AgentId, string[]> = {
  copper: [
    "get_products",
    "get_prices",
    "calculate_cost",
    "check_availability",
    "search_docs",
    "transfer_to_refund_agent",
  ],
  refund: [
    "lookup_order",
    "request_refund",
    "check_refund_status",
    "search_docs",
    "transfer_back_to_copper",
  ],
};

/** The tools that hand the chat to the other agent. */
export const HANDOFFS: Record<string, AgentId> = {
  transfer_to_refund_agent: "refund",
  transfer_back_to_copper: "copper",
};
