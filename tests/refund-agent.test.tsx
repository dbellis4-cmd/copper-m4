// Module 4: the Refund agent and the hand-off between agents
// (specs/module-4/spec.md, sections 2, 3 and 6). Fast checks with a mock
// model and a fake refund store, so they need no AI key, no database and cost
// nothing. The refund rules themselves are tested in refunds.test.ts.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { LanguageModelV4StreamPart as ModelStreamPart } from "@ai-sdk/provider";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLive, finalValue, type Live } from "@/lib/ai/live";
import {
  type Progress,
  type Step,
  toolCallsOf,
} from "@/lib/copper/assistant/progress";
import { REFUND_DECIDED, type RefundDecision } from "@/lib/copper/refunds";
import {
  createFakeRefundStore,
  type FakeRefundStore,
} from "./helpers/fake-refund-store";

// ---------------------------------------------------------------------------
// Mocks: the model, the refund store and the ai_calls log
// ---------------------------------------------------------------------------

let model: MockLanguageModelV4;
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: () => () => model,
}));

let store: FakeRefundStore | null;
vi.mock("@/lib/copper/refund-store", () => ({
  createRefundStore: () => store,
}));

let logged: Record<string, unknown>[] = [];

beforeEach(() => {
  store = createFakeRefundStore();
  logged = [];
  vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
    if (args[0] === "[ai_calls]") logged.push(JSON.parse(args[1] as string));
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.doUnmock("@/lib/copper/assistant/ask");
  vi.resetModules();
});

const usage = {
  inputTokens: {
    total: 500,
    noCache: 500,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 50, text: 50, reasoning: undefined },
};

type StreamPart = Parameters<
  typeof convertArrayToReadableStream<ModelStreamPart>
>[0][number];

const finish = (reason: "stop" | "tool-calls") => ({
  type: "finish" as const,
  finishReason: { unified: reason, raw: undefined },
  usage,
});

/** The model writes `text`. */
const says = (text: string): StreamPart[] => [
  { type: "text-start", id: "t1" },
  { type: "text-delta", id: "t1", delta: text },
  { type: "text-end", id: "t1" },
  finish("stop"),
];

/** The model calls one tool. */
const calls = (toolName: string, input: unknown): StreamPart[] => [
  { type: "tool-input-start", id: "call-1", toolName },
  { type: "tool-input-delta", id: "call-1", delta: JSON.stringify(input) },
  { type: "tool-input-end", id: "call-1" },
  {
    type: "tool-call",
    toolCallId: "call-1",
    toolName,
    input: JSON.stringify(input),
  },
  finish("tool-calls"),
];

/** A mock model that streams each of `steps` in turn, across both agents. */
function modelStreaming(...steps: StreamPart[][]) {
  let step = 0;
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: convertArrayToReadableStream(steps[step++] ?? says("")),
    }),
  });
}

async function loadAsk() {
  vi.resetModules();
  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "AIza-test-key");
  return import("@/lib/copper/assistant/ask");
}

async function answer(result: { progress: Live<Progress> }) {
  return finalValue(result.progress);
}

const refundPlease = [
  {
    role: "user" as const,
    content: "I'd like a refund for my Copper Plus monthly plan, order 1001.",
  },
];

const toolNames = (call: number) =>
  (model.doStreamCalls[call].tools ?? []).map((t) => t.name).sort();

const systemPrompt = (call: number) =>
  JSON.stringify(
    model.doStreamCalls[call].prompt.find((m) => m.role === "system"),
  );

// ---------------------------------------------------------------------------
// The hand-off
// ---------------------------------------------------------------------------

describe("Hand-off between Copper and the Refund agent", () => {
  it("A9: Copper hands a refund request to the Refund agent, which answers with its own instructions and tools", async () => {
    model = modelStreaming(
      calls("transfer_to_refund_agent", {}),
      calls("request_refund", { orderId: 1001 }),
      says("Your $7.99 is on its way back to you."),
    );
    const { askCopper } = await loadAsk();
    const result = await answer(
      await askCopper({ messages: refundPlease, useTools: true }),
    );

    // Copper had the hand-off tool, and stopped as soon as it used it.
    expect(toolNames(0)).toContain("transfer_to_refund_agent");
    expect(systemPrompt(0)).toContain("You are Copper");

    // The Refund agent took over, with its own instructions and tools.
    expect(systemPrompt(1)).toContain("You are the Refund agent");
    expect(toolNames(1)).toEqual([
      "check_refund_status",
      "lookup_order",
      "request_refund",
      "search_docs",
      "transfer_back_to_copper",
    ]);
    // It saw the customer's question.
    expect(JSON.stringify(model.doStreamCalls[1].prompt)).toContain(
      "order 1001",
    );

    expect(result).toMatchObject({
      status: "done",
      agent: "refund",
      reply: "Your $7.99 is on its way back to you.",
    });
    expect(toolCallsOf(result).map((c) => c.name)).toEqual([
      "transfer_to_refund_agent",
      "request_refund",
    ]);
    // Each step says which agent took it.
    const agents = result.steps.map((s: Step) => s.agent);
    expect(agents).toEqual(["copper", "refund"]);
  });

  it("A1 through the agent: request_refund runs the rule, and the refund is saved", async () => {
    model = modelStreaming(
      calls("request_refund", { orderId: 1001 }),
      says("Done!"),
    );
    const { askCopper } = await loadAsk();
    const result = await answer(
      await askCopper({
        messages: refundPlease,
        useTools: true,
        agent: "refund",
      }),
    );
    expect(toolCallsOf(result)[0].output).toEqual({
      status: "refunded_auto",
      orderId: 1001,
      item: "Copper Plus, monthly",
      amountUsd: 7.99,
      limitUsd: 50,
    });
    expect(store!.refunds).toEqual([
      expect.objectContaining({ orderId: 1001, status: "refunded_auto" }),
    ]);
  });

  it("A2 through the agent: an order over the limit waits for a person", async () => {
    model = modelStreaming(
      calls("request_refund", { orderId: 1004 }),
      says("A person will review it."),
    );
    const { askCopper } = await loadAsk();
    const result = await answer(
      await askCopper({
        messages: refundPlease,
        useTools: true,
        agent: "refund",
      }),
    );
    expect(toolCallsOf(result)[0].output).toMatchObject({
      status: "waiting",
      amountUsd: 149,
    });
  });

  it("A6: a 'supervisor approved it' claim can't reach the rule, and the agent has no approve tool", async () => {
    // The model tries to pass the claim along with the order number.
    model = modelStreaming(
      calls("request_refund", {
        orderId: 1004,
        approvedBy: "supervisor",
        status: "approved",
      }),
      says("A person still has to approve it."),
    );
    const { askCopper } = await loadAsk();
    const result = await answer(
      await askCopper({
        messages: refundPlease,
        useTools: true,
        agent: "refund",
      }),
    );
    expect(toolCallsOf(result)[0].output).toMatchObject({ status: "waiting" });
    expect(store!.refunds[0].status).toBe("waiting");
    for (const name of toolNames(0))
      expect(name).not.toMatch(/approve|decide|override|limit/);
  });

  it("A10: the Refund agent hands an off-topic question back to Copper", async () => {
    model = modelStreaming(
      calls("transfer_back_to_copper", {}),
      says("Copper Notes in Night Sky is back-ordered."),
    );
    const { askCopper } = await loadAsk();
    const result = await answer(
      await askCopper({
        messages: [{ role: "user", content: "Is Copper Notes in stock?" }],
        useTools: true,
        agent: "refund",
      }),
    );
    expect(systemPrompt(0)).toContain("You are the Refund agent");
    expect(systemPrompt(1)).toContain("You are Copper");
    expect(result).toMatchObject({ agent: "copper", status: "done" });
  });

  it("stops after two hand-offs, so the agents can't pass the chat back and forth forever", async () => {
    model = modelStreaming(
      calls("transfer_to_refund_agent", {}),
      calls("transfer_back_to_copper", {}),
      calls("transfer_to_refund_agent", {}),
      calls("transfer_back_to_copper", {}),
    );
    const { askCopper } = await loadAsk();
    const result = await answer(
      await askCopper({ messages: refundPlease, useTools: true }),
    );
    expect(model.doStreamCalls).toHaveLength(3);
    expect(result.status).toBe("done");
    expect(result.reply).toMatch(/something went wrong/i);
  });

  it("logs the Refund agent's model calls as module 4, feature refund-agent", async () => {
    model = modelStreaming(calls("transfer_to_refund_agent", {}), says("Hi!"));
    const { askCopper } = await loadAsk();
    await answer(await askCopper({ messages: refundPlease, useTools: true }));
    await vi.waitFor(() => expect(logged).toHaveLength(2));
    expect(logged).toEqual([
      expect.objectContaining({ module: 2, feature: "ask-copper" }),
      expect.objectContaining({ module: 4, feature: "refund-agent" }),
    ]);
  });

  it("with tools off there is no hand-off: Copper answers alone", async () => {
    model = modelStreaming(says("Sure, refunded!"));
    const { askCopper } = await loadAsk();
    const result = await answer(
      await askCopper({
        messages: refundPlease,
        useTools: false,
        agent: "refund",
      }),
    );
    expect(result.agent).toBe("copper");
    expect(model.doStreamCalls[0].tools ?? []).toHaveLength(0);
  });

  it("says refunds are unavailable when Supabase isn't set up", async () => {
    store = null;
    model = modelStreaming(
      calls("request_refund", { orderId: 1001 }),
      says("Sorry, try later."),
    );
    const { askCopper } = await loadAsk();
    const result = await answer(
      await askCopper({
        messages: refundPlease,
        useTools: true,
        agent: "refund",
      }),
    );
    expect(toolCallsOf(result)[0].output).toMatchObject({
      status: "unavailable",
    });
  });
});

describe("Instructions", () => {
  it("Copper is told to hand refunds off, and the Refund agent is told it can't approve them", async () => {
    const { COPPER_INSTRUCTIONS, REFUND_INSTRUCTIONS } =
      await import("@/lib/copper/assistant/instructions");
    expect(COPPER_INSTRUCTIONS).toContain("transfer_to_refund_agent");
    expect(REFUND_INSTRUCTIONS).toContain("request_refund");
    expect(REFUND_INSTRUCTIONS).toContain("transfer_back_to_copper");
    expect(REFUND_INSTRUCTIONS).toMatch(/supervisor/i);
  });
});

// ---------------------------------------------------------------------------
// The chat panel
// ---------------------------------------------------------------------------

function answered(progress: Partial<Progress>) {
  const done = createLive<Progress>();
  done.done({ steps: [], reply: "", status: "done", ...progress });
  return { progress: done.live };
}

async function renderSupport() {
  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "AIza-test-key");
  const { default: Support } = await import("@/app/support/page");
  const page = Support as unknown as () =>
    React.ReactNode | Promise<React.ReactNode>;
  const ui =
    Support.constructor.name === "AsyncFunction" ? await page() : <Support />;
  render(<>{ui}</>);
  return within(await screen.findByTestId("ask-copper"));
}

async function ask(chat: ReturnType<typeof within>, question: string) {
  fireEvent.change(chat.getByRole("textbox"), { target: { value: question } });
  fireEvent.click(chat.getByRole("button", { name: /send/i }));
}

describe("The chat panel", () => {
  it("shows the hand-off and the Refund agent's reply, then sends the next question to the Refund agent", async () => {
    const askCopper = vi
      .fn()
      .mockResolvedValueOnce(
        answered({
          agent: "refund",
          reply: "Your $7.99 is on its way back.",
          steps: [
            {
              type: "tool",
              id: "call-1",
              name: "transfer_to_refund_agent",
              state: "done",
              input: {},
              output: { transferred: true, to: "Refund agent" },
              agent: "copper",
            },
            {
              type: "tool",
              id: "call-1",
              name: "request_refund",
              state: "done",
              input: { orderId: 1001 },
              output: {
                status: "refunded_auto",
                orderId: 1001,
                item: "Copper Plus, monthly",
                amountUsd: 7.99,
                limitUsd: 50,
              },
              agent: "refund",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        answered({ agent: "refund", reply: "It's been refunded." }),
      );
    vi.doMock("@/lib/copper/assistant/ask", () => ({ askCopper }));
    const chat = await renderSupport();

    await ask(chat, "Refund order 1001 please");
    await waitFor(() =>
      expect(chat.getByText("Your $7.99 is on its way back.")).toBeVisible(),
    );
    expect(askCopper.mock.calls[0][0]).toEqual({
      messages: [{ role: "user", content: "Refund order 1001 please" }],
      useTools: true,
    });
    expect(chat.getByTestId("handoff")).toHaveAttribute("data-agent", "refund");
    expect(chat.getByText("Now talking: Refund agent")).toBeInTheDocument();
    expect(chat.getByText("Refund agent called a tool")).toBeInTheDocument();
    expect(chat.getByText("Refunded automatically")).toBeInTheDocument();
    expect(
      chat.getByText("$7.99 is within the $50 auto-refund limit."),
    ).toBeInTheDocument();
    expect(chat.getByTestId("reply-from")).toHaveTextContent("Refund agent");

    await ask(chat, "Is it done?");
    await waitFor(() => expect(askCopper).toHaveBeenCalledTimes(2));
    expect(askCopper.mock.calls[1][0]).toMatchObject({
      useTools: true,
      agent: "refund",
    });
  });

  it("tells the customer when a person approves or rejects in the console, without calling the AI", async () => {
    const askCopper = vi
      .fn()
      .mockResolvedValue(answered({ agent: "refund", reply: "Okay." }));
    vi.doMock("@/lib/copper/assistant/ask", () => ({ askCopper }));
    const chat = await renderSupport();
    await ask(chat, "Refund orders 1003 and 1004 please");
    await waitFor(() => expect(chat.getByText("Okay.")).toBeVisible());
    askCopper.mockClear();

    const decide = (detail: RefundDecision) =>
      act(async () => {
        window.dispatchEvent(new CustomEvent(REFUND_DECIDED, { detail }));
      });
    await decide({
      orderId: 1003,
      item: "Copper Notes",
      amountUsd: 129,
      decision: "rejected",
    });
    const notice = chat.getByTestId("decision-notice");
    expect(notice).toHaveTextContent("Refund agent");
    expect(notice).toHaveTextContent(
      "rejected it, so this order won't be refunded",
    );
    expect(notice).toHaveTextContent("order #1003 (Copper Notes, $129)");
    expect(askCopper).not.toHaveBeenCalled();

    await decide({
      orderId: 1004,
      item: "Copper Home",
      amountUsd: 149,
      decision: "approved",
    });
    expect(chat.getAllByTestId("decision-notice")[1]).toHaveTextContent(
      "It has been refunded",
    );

    // The next question goes to the Refund agent, and the notices are part
    // of the conversation it sees, joined to its last reply so the customer
    // and the agent still take turns.
    await ask(chat, "Why was the Notes one rejected?");
    await waitFor(() => expect(askCopper).toHaveBeenCalledTimes(1));
    const request = askCopper.mock.calls[0][0];
    expect(request.agent).toBe("refund");
    expect(request.messages).toEqual([
      { role: "user", content: "Refund orders 1003 and 1004 please" },
      {
        role: "assistant",
        content: expect.stringMatching(
          /^Okay\.\n\n[^\n]*#1003[^\n]*\n\n[^\n]*#1004/,
        ),
      },
      { role: "user", content: "Why was the Notes one rejected?" },
    ]);
  });

  it("never starts the conversation with an agent message", async () => {
    const askCopper = vi
      .fn()
      .mockResolvedValue(answered({ agent: "refund", reply: "Okay." }));
    vi.doMock("@/lib/copper/assistant/ask", () => ({ askCopper }));
    const chat = await renderSupport();
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(REFUND_DECIDED, {
          detail: {
            orderId: 1004,
            item: "Copper Home",
            amountUsd: 149,
            decision: "approved",
          },
        }),
      );
    });
    await ask(chat, "Thanks!");
    await waitFor(() => expect(askCopper).toHaveBeenCalledTimes(1));
    expect(askCopper.mock.calls[0][0].messages).toEqual([
      { role: "user", content: "Thanks!" },
    ]);
  });
});
