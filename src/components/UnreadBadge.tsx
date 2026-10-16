interface UnreadBadgeProps {
  count: number;
}

export function UnreadBadge({ count }: UnreadBadgeProps) {
  const safeCount = Math.max(0, Math.floor(count));
  return (
    <span
      className={`unread-badge ${safeCount ? "has-unread" : ""}`}
      aria-label={safeCount ? `${safeCount} unread runs` : "No unread runs"}
    >
      {safeCount ? (safeCount > 99 ? "99+" : safeCount) : "No unread runs"}
    </span>
  );
}
