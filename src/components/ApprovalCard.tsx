"use client";

import { useState } from "react";
import type { Approval } from "../server/domain/types.ts";

interface ApprovalCardProps {
  approval: Approval;
  onDecided?: () => void;
}

function toolName(action: unknown): string {
  if (typeof action !== "object" || action === null || !("toolName" in action)) {
    return "Tool action";
  }
  return String(action.toolName);
}

export function ApprovalCard({ approval, onDecided }: ApprovalCardProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState(approval.status);

  async function decide(decision: "approve" | "deny") {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/approvals/${encodeURIComponent(approval.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const result = await response.json() as { approval?: Approval; error?: string };
      if (!response.ok || !result.approval) {
        throw new Error(result.error ?? "Unable to record approval decision");
      }
      setStatus(result.approval.status);
      onDecided?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to record approval decision");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`approval-card approval-card-${status}`} aria-label={`Tool approval ${approval.id}`}>
      <div className="approval-card-heading">
        <div>
          <p className="eyebrow">Approval required</p>
          <h3>{toolName(approval.action)}</h3>
        </div>
        <span className={`approval-status approval-status-${status}`} role="status">
          {status}
        </span>
      </div>
      <pre className="approval-action">{JSON.stringify(approval.action, null, 2)}</pre>
      {status === "pending" ? (
        <div className="approval-actions">
          <button
            className="button button-primary"
            type="button"
            disabled={busy}
            onClick={() => void decide("approve")}
          >
            Approve action
          </button>
          <button
            className="button button-quiet"
            type="button"
            disabled={busy}
            onClick={() => void decide("deny")}
          >
            Deny action
          </button>
        </div>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </article>
  );
}
