/**
 * PostgreSQL full-text search query builder.
 *
 * Skills rules:
 *   - "double quoted phrase" → phrase query using the <-> operator
 *   - AND / OR / NOT are translated to &, |, !
 *   - Parentheses are preserved for grouping
 *   - Plain spaces or commas between terms are treated as AND
 *
 * Designation rules:
 *   - Multi-word input (space detected) → treated as a phrase query
 *   - Single word → exact term match
 *
 * The returned string is valid input for to_tsquery('english', <string>).
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

type Token =
  | { type: "term"; value: string }
  | { type: "and" }
  | { type: "or" }
  | { type: "not" }
  | { type: "lparen" }
  | { type: "rparen" };

function isPrimaryToken(token?: Token): boolean {
  return token?.type === "term" || token?.type === "lparen" || token?.type === "not";
}

function tokenizeSkillsQuery(raw: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < raw.length) {
    const char = raw[i];

    if (/\s/.test(char) || char === ",") {
      i++;
      continue;
    }

    if (char === "(") {
      tokens.push({ type: "lparen" });
      i++;
      continue;
    }

    if (char === ")") {
      tokens.push({ type: "rparen" });
      i++;
      continue;
    }

    if (char === "&") {
      tokens.push({ type: "and" });
      i++;
      continue;
    }

    if (char === "|") {
      tokens.push({ type: "or" });
      i++;
      continue;
    }

    if (char === "!") {
      tokens.push({ type: "not" });
      i++;
      continue;
    }

    if (char === '"') {
      let j = i + 1;
      while (j < raw.length && raw[j] !== '"') j++;
      const content = raw.slice(i + 1, j);
      const words = content.trim().split(/\s+/).map(sanitize).filter(Boolean);
      if (words.length === 1) {
        tokens.push({ type: "term", value: words[0] });
      } else if (words.length > 1) {
        tokens.push({ type: "term", value: `(${words.join(" <-> ")})` });
      }
      i = j < raw.length ? j + 1 : raw.length;
      continue;
    }

    let j = i;
    while (j < raw.length && !/[\s(),&|!"]/.test(raw[j])) j++;
    const rawWord = raw.slice(i, j);
    const upper = rawWord.toUpperCase();

    if (upper === "AND") {
      tokens.push({ type: "and" });
    } else if (upper === "OR") {
      tokens.push({ type: "or" });
    } else if (upper === "NOT") {
      tokens.push({ type: "not" });
    } else {
      const word = sanitize(rawWord);
      if (word) tokens.push({ type: "term", value: word });
    }

    i = j;
  }

  return tokens;
}

class SkillsQueryParser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): string | null {
    const expression = this.parseOrExpression();
    return expression || null;
  }

  private current(): Token | undefined {
    return this.tokens[this.pos];
  }

  private consume(type?: Token["type"]): Token | undefined {
    const token = this.current();
    if (!token) return undefined;
    if (type && token.type !== type) return undefined;
    this.pos += 1;
    return token;
  }

  private parseOrExpression(): string | null {
    let left = this.parseAndExpression();
    if (!left) return null;

    while (this.current()?.type === "or") {
      this.consume("or");
      const right = this.parseAndExpression();
      if (!right) continue;
      left = `(${left} | ${right})`;
    }

    return left;
  }

  private parseAndExpression(): string | null {
    let left = this.parseUnaryExpression();
    if (!left) return null;

    while (true) {
      const token = this.current();

      if (token?.type === "and") {
        this.consume("and");
        const right = this.parseUnaryExpression();
        if (!right) continue;
        left = `(${left} & ${right})`;
        continue;
      }

      if (isPrimaryToken(token)) {
        const right = this.parseUnaryExpression();
        if (!right) continue;
        left = `(${left} & ${right})`;
        continue;
      }

      break;
    }

    return left;
  }

  private parseUnaryExpression(): string | null {
    if (this.current()?.type === "not") {
      this.consume("not");
      const operand = this.parseUnaryExpression();
      return operand ? `!(${operand})` : null;
    }

    return this.parsePrimaryExpression();
  }

  private parsePrimaryExpression(): string | null {
    const token = this.current();
    if (!token) return null;

    if (token.type === "term") {
      this.consume("term");
      return token.value;
    }

    if (token.type === "lparen") {
      this.consume("lparen");
      const expression = this.parseOrExpression();
      this.consume("rparen");
      return expression ? `(${expression})` : null;
    }

    return null;
  }
}

/**
 * Build a tsquery fragment for the skills field.
 *
 * Supports boolean input with AND / OR / NOT / parentheses and quoted phrases.
 * Plain spaces or commas between terms are treated as AND.
 */
function parseSkillsQuery(raw: string): string | null {
  const tokens = tokenizeSkillsQuery(raw);
  if (tokens.length === 0) return null;

  return new SkillsQueryParser(tokens).parse();
}

/**
 * Build a tsquery fragment for the designation field.
 * No quote handling needed; if the value contains spaces it is treated as
 * a phrase (word1 <-> word2 <-> word3), otherwise as a single term.
 */
function parseDesignationQuery(raw: string): string | null {
  // Strip any stray quotes (designation doesn't use quote-phrase logic)
  const clean = raw.replace(/"/g, " ");
  const words = clean.trim().split(/\s+/).map(sanitize).filter(Boolean);
  if (words.length === 0) return null;
  return words.length === 1 ? words[0] : `(${words.join(" <-> ")})`;
}
