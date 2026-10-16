import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type {
  EnqueueHandoffInput,
  HandoffContext,
} from "../../services/handoff-service.ts";
import type { createHandoffService } from "../../services/handoff-service.ts";

type HandoffService = ReturnType<typeof createHandoffService>;

export function createDelegateToMemberTool(
  getContext: () => Omit<HandoffContext, never> | undefined,
  handoffService: HandoffService,
) {
  return defineTool({
    name: "delegate_to_member",
    label: "Delegate to task member",
    description: [
      "Create a structured handoff to another member of the current task.",
      "Use this only when another member should perform a distinct piece of work.",
      "Ordinary assistant text and @mentions do not schedule work.",
    ].join(" "),
    parameters: Type.Object({
      recipientAgentId: Type.String({ minLength: 1 }),
      instruction: Type.String({ minLength: 1 }),
      expectedOutput: Type.Optional(Type.String()),
    }),
    async execute(toolCallId, params) {
      const context = getContext();
      if (!context) throw new Error("No active server-bound task run for handoff");
      const input: EnqueueHandoffInput = { ...params, toolCallId };
      const result = await handoffService.enqueueHandoff(context, input);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        details: undefined,
        isError: false,
      };
    },
  });
}
