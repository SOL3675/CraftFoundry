/** Human text only: deterministic UTF-16 limits, without splitting a surrogate pair.
 * Machine consumers must use statuses, counts and detail references instead.
 */
export function summarizeText(value: string, limit: number): string {
  const text = value.replace(/[\uD800-\uDFFF]/gu, '�').replace(/[\x00-\x1f\x7f\ufffe\uffff]/g, ' ').replace(/\s+/gu, ' ').trim();
  if (text.length <= limit) return text;
  let end = limit - 1;
  if (/[\uD800-\uDBFF]/u.test(text[end - 1] ?? '')) end--;
  return `${text.slice(0, end)}…`;
}
