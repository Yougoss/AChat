export class TaskNotFoundError extends Error {}

export class RetryConflictError extends Error {}

export function retryErrorStatus(error: unknown): number {
  if (error instanceof TaskNotFoundError) return 404;
  if (error instanceof RetryConflictError) return 409;
  return 500;
}
