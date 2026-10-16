import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
  AgentSession,
  CreateAgentSessionOptions,
  CreateAgentSessionResult,
  ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import { resolveDataDir } from "../app-runtime.ts";
import { migrate, openDatabase } from "../db/client.ts";
import { createAgentRepository } from "../db/repositories/agent-repository.ts";
import { createProjectRepository } from "../db/repositories/project-repository.ts";
import { createGroupTaskRepository } from "../db/repositories/group-task-repository.ts";
import { createMessageRepository } from "../db/repositories/message-repository.ts";
import { createSessionRepository } from "../db/repositories/session-repository.ts";
import { createTraceExtension } from "./trace-extension.ts";
import { createTraceQueryService } from "../services/trace-query-service.ts";
import { createQueryContactSessionsTool } from "./tools/query-contact-sessions.ts";
import { createDelegateToMemberTool } from "./tools/delegate-to-member.ts";
import { getPiModelRuntime } from "./model-runtime.ts";
import { createSessionRegistry, type SessionRegistry } from "./session-registry.ts";
import { createHandoffService, type HandoffContext } from "../services/handoff-service.ts";
import { enqueueCommittedWorkItem } from "../scheduler/work-scheduler.ts";

export type SessionKind = "contact_chat" | "task";

export interface CreateContactSessionOptions {
  taskId?: string;
  sessionKind: SessionKind;
  workItemId?: string;
  runId?: string;
  handoffDepth?: number;
}

type SessionFactoryRuntime = Pick<ModelRuntime, "getAvailable">;

interface SessionFactoryDependencies {
  db: Database.Database;
  runtime: SessionFactoryRuntime;
  dataDir: string;
  agentDir?: string;
  sessionRegistry: SessionRegistry;
  handoffService?: ReturnType<typeof createHandoffService>;
  createSession?: (
    options: CreateAgentSessionOptions,
  ) => Promise<CreateAgentSessionResult>;
  createResourceLoader?: (options: ConstructorParameters<typeof DefaultResourceLoader>[0]) => ResourceLoader;
}

const activeTaskRunContexts = new Map<string, HandoffContext>();

export function setTaskSessionRunContext(
  piSessionId: string,
  context: HandoffContext | undefined,
): void {
  if (context) activeTaskRunContexts.set(piSessionId, context);
  else activeTaskRunContexts.delete(piSessionId);
}

const collaborationProtocol = [
  "Collaboration protocol:",
  "- Treat the supplied task as the only task context for this session.",
  "- Make claims about other task members only from the member descriptions below.",
  "- Report blockers and handoffs explicitly; do not claim work is complete without evidence.",
].join("\n");

function safePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function createTaskSystemPrompt(
  db: Database.Database,
  contactId: string,
  taskId: string,
): string {
  const task = db.prepare(`
    SELECT tasks.description
    FROM tasks
    JOIN task_members ON task_members.task_id = tasks.id
    WHERE tasks.id = ? AND task_members.contact_id = ?
  `).get(taskId, contactId) as { description: string } | undefined;
  if (!task) {
    throw new Error(`Contact ${contactId} is not a member of task ${taskId}`);
  }
  const members = db.prepare(`
    SELECT contacts.name, contacts.description
    FROM task_members
    JOIN contacts ON contacts.id = task_members.contact_id
    WHERE task_members.task_id = ?
    ORDER BY contacts.id
  `).all(taskId) as Array<{ name: string; description: string }>;

  return [
    "Selected task:",
    task.description,
    "",
    "Task member descriptions:",
    ...members.map((member) => `- ${member.name}: ${member.description}`),
    "",
    collaborationProtocol,
  ].join("\n");
}

function getOrCreateConversation(
  db: Database.Database,
  contactId: string,
  sessionKind: SessionKind,
  taskId?: string,
): string {
  const selectConversation = sessionKind === "task"
    ? db.prepare(`
        SELECT id FROM conversations WHERE kind = 'task' AND task_id = ? ORDER BY id LIMIT 1
      `)
    : db.prepare(`
        SELECT id FROM conversations WHERE kind = 'private' AND contact_id = ? ORDER BY id LIMIT 1
      `);
  const insert = db.transaction(() => {
    const existing = sessionKind === "task"
      ? selectConversation.get(taskId) as { id: string } | undefined
      : selectConversation.get(contactId) as { id: string } | undefined;
    if (existing) return existing.id;
    const task = sessionKind === "task" ? createGroupTaskRepository(db).getTask(taskId!) : undefined;
    if (sessionKind === "task" && !task) throw new Error(`Task not found: ${taskId}`);
    return createMessageRepository(db).createConversation({
      id: randomUUID(),
      groupId: task?.groupId ?? null,
      taskId: task?.id ?? null,
      contactId: sessionKind === "contact_chat" ? contactId : null,
      kind: sessionKind === "task" ? "task" : "private",
    }).id;
  });
  return insert();
}

export function createSessionFactory(dependencies: SessionFactoryDependencies) {
  const contacts = createAgentRepository(dependencies.db);
  const projects = createProjectRepository(dependencies.db);
  const tasks = createGroupTaskRepository(dependencies.db);
  const sessionMappings = createSessionRepository(dependencies.db);
  const sessionRegistry = dependencies.sessionRegistry;
  const handoffService = dependencies.handoffService
    ?? createHandoffService(dependencies.db, { enqueueWorkItem: enqueueCommittedWorkItem });
  const agentDir = dependencies.agentDir ?? getAgentDir();
  const constructSession = dependencies.createSession ?? createAgentSession;
  const constructResourceLoader = dependencies.createResourceLoader
    ?? ((options) => new DefaultResourceLoader(options));

  function buildTaskSystemPrompt(contactId: string, taskId: string): Promise<string> {
    return Promise.resolve(createTaskSystemPrompt(dependencies.db, contactId, taskId));
  }

  async function createContactSession(
    contactId: string,
    options: CreateContactSessionOptions,
  ): Promise<AgentSession> {
    if (options.sessionKind === "task" && !options.taskId) {
      throw new Error("Task sessions require a taskId");
    }
    if (options.sessionKind === "contact_chat" && options.taskId) {
      throw new Error("Contact-chat sessions cannot include a taskId");
    }
    const contact = contacts.getContact(contactId);
    if (!contact) throw new Error(`Contact not found: ${contactId}`);
    if (contact.modelProvider !== "github-copilot") {
      throw new Error("AChat POC v1 supports only github-copilot contact models");
    }
    const model = (await dependencies.runtime.getAvailable("github-copilot"))
      .find((candidate) => candidate.provider === "github-copilot" && candidate.id === contact.modelId);
    if (!model) {
      throw new Error(`Contact model ${contact.modelId} is not currently available from github-copilot`);
    }

    let cwd = dependencies.dataDir;
    let systemPrompt: string | undefined;
    if (options.sessionKind === "task") {
      const task = tasks.getTask(options.taskId!);
      if (!task) throw new Error(`Task not found: ${options.taskId}`);
      const project = projects.getProject(task.projectId);
      if (!project) throw new Error(`Project not found: ${task.projectId}`);
      if (!tasks.listTaskMembers(task.id).includes(contactId)) {
        throw new Error(`Contact ${contactId} is not a member of task ${task.id}`);
      }
      cwd = project.rootPath;
      systemPrompt = createTaskSystemPrompt(dependencies.db, contactId, task.id);
    } else {
      systemPrompt = [
        `You are the AChat assistant for ${contact.name}.`,
        "Use only the current contact-chat conversation; do not assume task context.",
      ].join("\n");
    }

    const sessionKey = {
      contactId,
      sessionKind: options.sessionKind,
      taskId: options.sessionKind === "task" ? options.taskId : undefined,
      modelId: model.id,
    };
    const existing = sessionRegistry.get(sessionKey);
    if (existing) return existing;

    const sessionDir = path.join(
      dependencies.dataDir,
      "sessions",
      safePathSegment(contactId),
      options.sessionKind,
      ...(options.sessionKind === "task" ? [safePathSegment(options.taskId!)] : []),
    );
    const taskId = options.sessionKind === "task" ? options.taskId! : null;
    const conversationId = getOrCreateConversation(
      dependencies.db,
      contactId,
      options.sessionKind,
      options.sessionKind === "task" ? options.taskId : undefined,
    );
    let existingMapping = sessionMappings.getSessionMappingForContact(contactId, taskId);
    if (existingMapping && !existsSync(existingMapping.sessionFile)) {
      sessionMappings.deleteSessionMapping(existingMapping.id);
      existingMapping = undefined;
    }
    const sessionRoot = path.resolve(sessionDir);
    const sessionManager = existingMapping
      ? (() => {
          const existingFile = path.resolve(existingMapping!.sessionFile);
          if (!existingFile.startsWith(`${sessionRoot}${path.sep}`)) {
            throw new Error("Stored Pi session file is outside the AChat session root");
          }
          return SessionManager.open(existingFile, sessionDir, cwd);
        })()
      : SessionManager.create(cwd, sessionDir);
    const settingsManager = SettingsManager.create(cwd, agentDir);
    const resourceLoader = constructResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      systemPrompt,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
    await resourceLoader.reload();

    const sessionOptions: CreateAgentSessionOptions = {
      cwd,
      agentDir,
      model: model as Model<Api>,
      modelRuntime: dependencies.runtime as ModelRuntime,
      sessionManager,
      settingsManager,
      resourceLoader,
      ...(options.sessionKind === "contact_chat"
        ? { noTools: "all" as const }
        : { tools: ["read", "write", "edit", "bash", "grep", "find", "ls"] }),
    };
    const mapping = existingMapping ?? (() => {
      const sessionFile = sessionManager.getSessionFile();
      if (!sessionFile) throw new Error("Pi did not provide a session file path");
      return sessionMappings.createSessionMapping({
        id: randomUUID(),
        contactId,
        taskId,
        conversationId,
        kind: options.sessionKind === "task" ? "task" : "private",
        piSessionId: sessionManager.getSessionId(),
        sessionFile,
      });
    })();
    const trace = createTraceExtension(dependencies.db);
    const traceScope = {
      id: mapping.id,
      contactId: mapping.contactId,
      taskId: mapping.taskId,
      kind: mapping.kind,
      piSessionId: mapping.piSessionId,
    };
    sessionOptions.modelRuntime = trace.instrumentModelRuntime(
      dependencies.runtime as ModelRuntime,
      traceScope,
    );
    if (options.sessionKind === "contact_chat") {
      sessionOptions.customTools = [
        createQueryContactSessionsTool(contactId, createTraceQueryService(dependencies.db)),
      ];
    } else {
      sessionOptions.customTools = [
        createDelegateToMemberTool(
          () => activeTaskRunContexts.get(mapping.piSessionId),
          handoffService,
        ),
      ];
    }
    let result: CreateAgentSessionResult;
    try {
      result = await constructSession(sessionOptions);
    } catch (error) {
      if (!existingMapping) sessionMappings.deleteSessionMapping(mapping.id);
      throw error;
    }
    trace.subscribeToSession(traceScope, result.session);
    sessionRegistry.set(sessionKey, result.session);
    return result.session;
  }

  return { buildTaskSystemPrompt, createContactSession };
}

async function withDefaultDatabase<T>(
  operation: (db: Database.Database) => Promise<T> | T,
): Promise<T> {
  const db = openDatabase(path.join(resolveDataDir(), "achat.sqlite"));
  try {
    migrate(db);
    return await operation(db);
  } finally {
    db.close();
  }
}

let processSessionDatabase: Database.Database | undefined;

function getProcessSessionDatabase(): Database.Database {
  if (processSessionDatabase?.open) return processSessionDatabase;
  const db = openDatabase(path.join(resolveDataDir(), "achat.sqlite"));
  try {
    migrate(db);
    processSessionDatabase = db;
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

const processSessionRegistry = createSessionRegistry();

export function buildTaskSystemPrompt(contactId: string, taskId: string): Promise<string> {
  return withDefaultDatabase((db) =>
    Promise.resolve(createTaskSystemPrompt(db, contactId, taskId)));
}

export async function createContactSession(
  contactId: string,
  options: CreateContactSessionOptions,
): Promise<AgentSession> {
  const runtime = await getPiModelRuntime();
  return createSessionFactory({
    db: getProcessSessionDatabase(),
    runtime,
    dataDir: resolveDataDir(),
    agentDir: getAgentDir(),
    sessionRegistry: processSessionRegistry,
  }).createContactSession(contactId, options);
}
