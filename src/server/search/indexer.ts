export interface PreparedSearchQuery {
  matchExpression: string;
  exactTerm: string;
}

export function prepareSearchQuery(query: string): PreparedSearchQuery | undefined {
  const terms = query.match(/[\p{L}\p{N}_]+/gu) ?? [];
  if (!terms.length) return undefined;
  return {
    matchExpression: terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR "),
    exactTerm: terms.join(" ").toLocaleLowerCase(),
  };
}

export function searchTextHasExactTerm(text: string, exactTerm: string): boolean {
  if (!exactTerm) return false;
  const normalizedText = (text.match(/[\p{L}\p{N}_]+/gu) ?? [])
    .join(" ")
    .toLocaleLowerCase();
  return normalizedText.includes(exactTerm);
}

export function createSearchPreview(content: string, query: string, maxLength = 180): string {
  const trimmed = content.trim();
  if (trimmed.length <= maxLength) return trimmed;

  const firstTerm = query.match(/[\p{L}\p{N}_]+/u)?.[0] ?? "";
  const matchIndex = firstTerm ? trimmed.toLocaleLowerCase().indexOf(firstTerm.toLocaleLowerCase()) : -1;
  const start = Math.max(0, Math.min(matchIndex - Math.floor(maxLength / 3), trimmed.length - maxLength));
  const excerpt = trimmed.slice(start, start + maxLength).trim();
  return `${start > 0 ? "…" : ""}${excerpt}${start + maxLength < trimmed.length ? "…" : ""}`;
}
