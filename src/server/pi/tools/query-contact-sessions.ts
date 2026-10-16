import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { createTraceQueryService } from "../../services/trace-query-service.ts";

type TraceQueryService = ReturnType<typeof createTraceQueryService>;

export function createQueryContactSessionsTool(
  contactId: string,
  queryService: TraceQueryService,
) {
  return defineTool({
    name: "query_contact_sessions",
    label: "Query contact sessions",
    description: [
      "Read this contact's private-chat and task-session history.",
      "Use list_sessions to browse session summaries, list_tasks to browse task summaries,",
      "or read_session with a sessionRef returned by a list operation.",
      "A taskId filters results to this contact's sessions for that task only.",
      "This tool is read-only and cannot control or modify any agent session or task.",
    ].join(" "),
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("list_sessions"),
        Type.Literal("list_tasks"),
        Type.Literal("read_session"),
      ]),
      sessionRef: Type.Optional(Type.String()),
      taskId: Type.Optional(Type.String()),
      cursor: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    }),
    async execute(_toolCallId, params) {
      let result: unknown;
      if (params.action === "list_sessions") {
        result = await queryService.listContactSessions(contactId, {
          cursor: params.cursor,
          limit: params.limit,
          taskId: params.taskId,
        });
      } else if (params.action === "list_tasks") {
        result = await queryService.listContactTasks(contactId, {
          cursor: params.cursor,
          limit: params.limit,
          taskId: params.taskId,
        });
      } else {
        if (!params.sessionRef) throw new Error("read_session requires a sessionRef");
        result = await queryService.readContactSession(contactId, params.sessionRef, {
          cursor: params.cursor,
          limit: params.limit,
          taskId: params.taskId,
        });
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        details: undefined,
        isError: false,
      };
    },
  });
}
