export type ContactId = string;
export type AgentId = string;

export interface Contact {
  id: ContactId;
  name: string;
  description: string;
  modelProvider: string;
  modelId: string;
}

export interface Agent {
  id: AgentId;
  modelProvider: string;
  modelId: string;
}

export interface Project {
  id: string;
  name: string;
  rootPath: string;
}

export interface Group {
  id: string;
  name: string;
  description: string;
}

export interface Task {
  id: string;
  groupId: string;
  projectId: string;
  description: string;
  status: string;
}

export interface TaskEvent {
  id: string;
  taskId: string;
  type: string;
  payload: unknown;
  idempotencyKey: string;
  createdAt: string;
}

export interface Conversation {
  id: string;
  groupId: string | null;
  taskId: string | null;
  kind: "task" | "private";
  createdAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  createdAt: string;
}

export interface WorkItem {
  id: string;
  taskId: string;
  contactId: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface Run {
  id: string;
  taskId: string;
  workItemId: string;
  contactId: string;
  attempt: number;
  status: "running" | "completed" | "failed" | "interrupted";
  startedAt: string;
  completedAt: string | null;
}

export interface Approval {
  id: string;
  taskId: string;
  workItemId: string;
  piSessionId: string;
  toolCallId: string;
  action: unknown;
  status: "pending" | "approved" | "denied";
  createdAt: string;
  decidedAt: string | null;
}

export interface PiSessionMapping {
  id: string;
  contactId: ContactId;
  taskId: string | null;
  conversationId: string;
  kind: "private" | "task";
  piSessionId: string;
  sessionFile: string;
  createdAt: string;
}
