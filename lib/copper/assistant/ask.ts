"use server";

// The server action the Ask Copper chat calls. It streams the conversation to
// the model through callStream (lib/ai/call.ts), with or without the tools,
// and sends back each step as it happens, so the panel can show the agent
// thinking and using its tools.
// Module 4 adds a second agent. When Copper calls transfer_to_refund_agent,
// Copper stops and the Refund agent, with its own instructions and tools,
// answers the same question (and the reverse with transfer_back_to_copper).
// The chat remembers who answered last and sends `agent` with the next
// question, so the customer keeps talking to the Refund agent.
import { hasToolCall, stepCountIs, type ToolSet } from "ai";
import { callStream, type CallInfo, THOUGHT_SUMMARIES } from "@/lib/ai/call";
import { createLive, type Live } from "@/lib/ai/live";
import {
  COPPER_INSTRUCTIONS,
  REFUND_INSTRUCTIONS,
} from "@/lib/copper/assistant/instructions";
import {
  type AgentId,
  HANDOFFS,
  type Progress,
  type ToolStep,
} from "@/lib/copper/assistant/progress";
import {
  refundTools,
  transferToRefundAgent,
} from "@/lib/copper/assistant/refund-tools";
import { copperTools } from "@/lib/copper/assistant/tools";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type AskCopperRequest = {
  messages: ChatMessage[];
  useTools: boolean;
  /** Who answers: whoever answered last. Copper if not given. */
  agent?: AgentId;
};

export type AskCopperResult = { progress: Live<Progress> };

/** At most this many model steps (tool calls plus the reply) per agent. */
const MAX_STEPS = 5;

/** At most this many hand-offs per question, so agents can't loop forever. */
const MAX_HANDOFFS = 2;

const SORRY = "Sorry, something went wrong on my end. Please try again.";

/** Each agent's instructions, tools and ai_calls label. */
const AGENTS: Record<
  AgentId,
  { info: CallInfo; instructions: string; tools: ToolSet }
> = {
  copper: {
    info: { module: 2, feature: "ask-copper" },
    instructions: COPPER_INSTRUCTIONS,
    tools: { ...copperTools, transfer_to_refund_agent: transferToRefundAgent },
  },
  refund: {
    info: { module: 4, feature: "refund-agent" },
    instructions: REFUND_INSTRUCTIONS,
    tools: refundTools,
  },
};

export async function askCopper({
  messages,
  useTools,
  agent: firstAgent = "copper",
}: AskCopperRequest): Promise<AskCopperResult> {
  const { live, update, done } = createLive<Progress>();
  // Without tools there's nothing to hand off with, so Copper answers alone.
  let agent: AgentId = useTools ? firstAgent : "copper";
  const progress: Progress = { steps: [], reply: "", status: "working", agent };
  // A fresh copy each time, so earlier updates never change underneath the
  // panel.
  const snapshot = (): Progress => ({
    ...progress,
    steps: progress.steps.map((step) => ({ ...step })),
  });
  // Tool call ids can repeat between agents, so look only at this agent's.
  const toolStep = (id: string) =>
    progress.steps.findLast(
      (step): step is ToolStep =>
        step.type === "tool" && step.id === id && step.agent === agent,
    );

  /** Streams one agent's turn; returns who to hand off to, if anyone. */
  async function run(): Promise<AgentId | null> {
    const { info, instructions, tools } = AGENTS[agent];
    // Without tools, send no instructions either: "always use your tools"
    // with no tools makes the model answer with nothing.
    const result = callStream(info, {
      messages,
      providerOptions: THOUGHT_SUMMARIES,
      ...(useTools && {
        instructions,
        tools,
        stopWhen: [
          stepCountIs(MAX_STEPS),
          hasToolCall(...Object.keys(HANDOFFS)),
        ],
      }),
    });
    let handoff: AgentId | null = null;
    for await (const part of result.fullStream) {
      switch (part.type) {
        case "reasoning-delta": {
          const last = progress.steps.at(-1);
          if (last?.type === "thinking" && last.agent === agent)
            last.text += part.text;
          else
            progress.steps.push({ type: "thinking", text: part.text, agent });
          break;
        }
        case "tool-input-start":
          progress.steps.push({
            type: "tool",
            id: part.id,
            name: part.toolName,
            state: "calling",
            agent,
          });
          break;
        case "tool-call": {
          const step = toolStep(part.toolCallId);
          if (step) step.input = part.input;
          else
            progress.steps.push({
              type: "tool",
              id: part.toolCallId,
              name: part.toolName,
              state: "calling",
              input: part.input,
              agent,
            });
          break;
        }
        case "tool-result": {
          const step = toolStep(part.toolCallId);
          if (step) Object.assign(step, { output: part.output, state: "done" });
          handoff = HANDOFFS[part.toolName] ?? handoff;
          break;
        }
        case "tool-error": {
          const step = toolStep(part.toolCallId);
          const message =
            part.error instanceof Error
              ? part.error.message
              : String(part.error);
          if (step) Object.assign(step, { output: message, state: "error" });
          break;
        }
        case "text-delta":
          progress.reply += part.text;
          break;
        case "error":
          throw part.error;
        default:
          continue;
      }
      update(snapshot());
    }
    return handoff === agent ? null : handoff;
  }

  // Read the stream in the background, so the panel gets the first update now.
  void (async () => {
    try {
      for (let handoffs = 0; ; handoffs++) {
        const next = await run();
        if (!next || handoffs === MAX_HANDOFFS) break;
        // The next agent writes the reply: drop anything the last one said.
        agent = next;
        progress.agent = next;
        progress.reply = "";
        update(snapshot());
      }
      progress.status = "done";
      if (!progress.reply.trim()) progress.reply = SORRY;
    } catch (error) {
      // The customer sees "Sorry"; the terminal says what actually broke.
      console.error(
        `[ask-copper] ${agent} failed:`,
        error instanceof Error ? error.message : String(error),
      );
      progress.status = "error";
      if (!progress.reply.trim()) progress.reply = SORRY;
    }
    done(snapshot());
  })();

  return { progress: live };
}
