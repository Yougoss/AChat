import type { ExtensionAPI, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import {
  createApprovalService,
  type ToolApprovalContext,
} from "../services/approval-service.ts";
import type Database from "better-sqlite3";

interface ApprovalExtensionOptions {
  db?: Database.Database;
  service?: ReturnType<typeof createApprovalService>;
  context: Omit<ToolApprovalContext, "toolCallId">;
}

const readOnlyTools = new Set(["read", "grep", "find", "ls"]);

export function createApprovalExtension(options: ApprovalExtensionOptions) {
  if (!options.service && !options.db) {
    throw new Error("Approval extension requires a database-backed service");
  }
  const service = options.service ?? createApprovalService(options.db!);
  return (pi: ExtensionAPI): void => {
    pi.on("tool_call", async (event: ToolCallEvent) => {
      if (readOnlyTools.has(event.toolName)) return;
      try {
        const decision = await service.requestToolApproval(
          { ...options.context, toolCallId: event.toolCallId },
          { toolName: event.toolName, input: event.input },
        );
        return decision === "approved"
          ? undefined
          : {
              block: true,
              terminate: true,
              reason: "This action was denied by the user.",
            };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Approval request failed";
        return {
          block: true,
          terminate: true,
          reason: `Approval request failed: ${message}`,
        };
      }
    });
  };
}
