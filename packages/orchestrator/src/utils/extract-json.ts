/**
 * Extract the first top-level JSON object from a string that may contain
 * preamble or postamble text (e.g. Claude outputting "Here's the JSON:\n{...}").
 *
 * Uses balanced-brace walking (O(n)) instead of a greedy regex, which breaks
 * when the JSON value contains `}` characters (e.g. code blocks in synthesis).
 *
 * Returns the extracted JSON substring, or the original string if no `{` found.
 */
export function extractJson(output: string): string {
  const start = output.indexOf('{');
  if (start === -1) return output;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < output.length; i++) {
    const ch = output[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return output.slice(start, i + 1);
    }
  }

  // Unbalanced — return from start to end as best-effort
  return output.slice(start);
}
