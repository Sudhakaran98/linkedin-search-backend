/**
 * PostgreSQL full-text search query builder.
 *
 * Skills rules:
 *   "double quoted phrase" → phrase query using the <-> operator
 *   NOT keyword before a word  → prefixes it with ! (negation)
 *   comma / & / plain spaces   → AND between terms
 *
 * Designation rules:
 *   Multi-word input (space detected) → treated as a phrase query
 *   Single word                        → exact term match
 *
 * The returned string is valid input for PostgreSQL: to_tsquery('english', <string>)
 */

export const SUBSET_SIZE = 1000;
export const PAGE_SIZE   = 20;

export function getSubsetOffset(subset: number): number {
  return subset * SUBSET_SIZE;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildTsQuery(
  skills?: string,
  designation?: string
): string | null {
  const parts: string[] = [];

  if (skills?.trim()) {
    const s = parseSkillsQuery(skills.trim());
    if (s) parts.push(s);
  }

  if (designation?.trim()) {
    const d = parseDesignationQuery(designation.trim());
    if (d) parts.push(d);
  }

  return parts.length > 0 ? parts.join(" & ") : null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Strip characters that are not valid inside a tsquery lexeme. */
function sanitize(word: string): string {
  return word.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase();
}

/**
 * Build a tsquery fragment for the skills field.
 *
 * Parsing order:
 *  1. Pull out all "quoted phrases" → converted to (word1 <-> word2) tokens
 *  2. Scan remaining words for NOT <word> pairs → become !word tokens
 *  3. Everything else → plain AND term
 * All resulting tokens are joined with &.
 */
export function parseSkillsQuery(raw: string): string | null {
  const tokens: string[] = [];

  // Step 1 – extract double-quoted phrases and replace with placeholders
  const phrases: string[] = [];
  let working = raw.replace(/"([^"]+)"/g, (_m, content: string) => {
    const words = content.trim().split(/\s+/).map(sanitize).filter(Boolean);
    if (words.length === 0) return "";
    const tok =
      words.length === 1 ? words[0] : `(${words.join(" <-> ")})`;
    phrases.push(tok);
    return `__PH${phrases.length - 1}__`;
  });

  // Step 2 – tokenise remaining text (commas and & treated as AND separators)
  const rawTokens = working
    .replace(/[,&]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  let i = 0;
  while (i < rawTokens.length) {
    const tok = rawTokens[i];

    // Phrase placeholder
    const phMatch = tok.match(/^__PH(\d+)__$/);
    if (phMatch) {
      tokens.push(phrases[parseInt(phMatch[1], 10)]);
      i++;
      continue;
    }

    // AND keyword → just a separator, skip it
    if (tok.toUpperCase() === "AND") {
      i++;
      continue;
    }

    // NOT keyword → negate the next token
    if (tok.toUpperCase() === "NOT" && i + 1 < rawTokens.length) {
      const next = rawTokens[i + 1];
      const phMatch2 = next.match(/^__PH(\d+)__$/);
      if (phMatch2) {
        tokens.push(`!${phrases[parseInt(phMatch2[1], 10)]}`);
      } else {
        const w = sanitize(next);
        if (w) tokens.push(`!${w}`);
      }
      i += 2;
      continue;
    }

    // Plain word
    const w = sanitize(tok);
    if (w) tokens.push(w);
    i++;
  }

  return tokens.length > 0 ? tokens.join(" & ") : null;
}

/**
 * Build a tsquery fragment for the designation field.
 * No quote handling needed; if the value contains spaces it is treated as
 * a phrase (word1 <-> word2 <-> word3), otherwise as a single term.
 */
export function parseDesignationQuery(raw: string): string | null {
  const clean = raw.replace(/"/g, " ");
  const words  = clean.trim().split(/\s+/).map(sanitize).filter(Boolean);
  if (words.length === 0) return null;
  return words.length === 1 ? words[0] : `(${words.join(" <-> ")})`;
}
