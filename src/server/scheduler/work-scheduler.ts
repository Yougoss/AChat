let scheduler: ((workItemId: string) => Promise<void>) | undefined;

export function setWorkItemScheduler(
  next: ((workItemId: string) => Promise<void>) | undefined,
): void {
  scheduler = next;
}

export function enqueueCommittedWorkItem(workItemId: string): Promise<void> {
  if (!scheduler) throw new Error("Task work queue is not running");
  return scheduler(workItemId);
}
