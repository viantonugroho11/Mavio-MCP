export const DEFAULT_MAX_RESULT_CHARS = 60_000;

export interface CappedText {
  text: string;
  truncated: boolean;
  totalChars: number;
}

/**
 * ADR-029: cap a tool result's text block. The cut is deliberately
 * mid-structure so a client cannot parse a partial JSON result as complete.
 */
export function capResultText(text: string, maxChars: number): CappedText {
  const totalChars = text.length;
  if (totalChars <= maxChars) return { text, truncated: false, totalChars };

  let end = maxChars;
  // Do not split a UTF-16 surrogate pair.
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;

  const notice =
    `\n…[result truncated: ${totalChars} chars total, showing first ${end}. ` +
    `Narrow the request (limit/fields/pagination) to get complete data.]`;
  return { text: text.slice(0, end) + notice, truncated: true, totalChars };
}
