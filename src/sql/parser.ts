/**
 * SQL Parser — lightweight regex-based parser for SQL statement analysis.
 *
 * Identifies statement type (SELECT, INSERT, UPDATE, DELETE) and extracts
 * the primary target table. Designed to handle common SQL patterns without
 * external dependencies.
 *
 * Limitations (by design):
 * - Does not parse subqueries or CTEs
 * - Does not handle multi-table INSERT
 * - Complex JOINs are detected but only the primary table is extracted
 *
 * For queries the parser cannot handle, users should use .unscoped().
 */

export type StatementType = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'UNKNOWN'

export interface ParsedStatement {
  /** The type of SQL statement. */
  type: StatementType
  /** The primary table targeted by the statement. */
  table: string | null
  /** Whether the statement already contains a WHERE clause. */
  hasWhere: boolean
  /** Whether the statement contains JOIN clauses. */
  hasJoin: boolean
}

// Regex pattern to match a SQL identifier (table name), optionally schema-qualified.
// Supports: table, schema.table, "quoted table", `backtick table`
const TABLE_IDENT = /(?:"([^"]+)"|`([^`]+)`|(\w+(?:\.\w+)?))/

/**
 * Strips SQL comments (single-line and multi-line) and normalizes whitespace.
 */
function normalize(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, '')         // Remove single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi-line comments
    .replace(/\s+/g, ' ')            // Normalize whitespace
    .trim()
}

/**
 * Parse a SQL statement to extract its type, target table, and structural info.
 */
export function parseStatement(sql: string): ParsedStatement {
  const normalized = normalize(sql)
  const upper = normalized.toUpperCase()

  if (upper.startsWith('SELECT') || upper.startsWith('WITH')) {
    return parseSelect(normalized, upper)
  }

  if (upper.startsWith('INSERT')) {
    return parseInsert(normalized, upper)
  }

  if (upper.startsWith('UPDATE')) {
    return parseUpdate(normalized, upper)
  }

  if (upper.startsWith('DELETE')) {
    return parseDelete(normalized, upper)
  }

  return { type: 'UNKNOWN', table: null, hasWhere: false, hasJoin: false }
}

function parseSelect(normalized: string, upper: string): ParsedStatement {
  // Extract table from FROM clause
  const fromMatch = normalized.match(/\bFROM\s+(?:"([^"]+)"|`([^`]+)`|(\w+(?:\.\w+)?))/i)
  const table = fromMatch ? (fromMatch[1] ?? fromMatch[2] ?? fromMatch[3] ?? null) : null

  return {
    type: 'SELECT',
    table,
    hasWhere: /\bWHERE\b/i.test(upper),
    hasJoin: /\bJOIN\b/i.test(upper),
  }
}

function parseInsert(normalized: string, upper: string): ParsedStatement {
  // INSERT INTO table_name
  const intoMatch = normalized.match(/\bINSERT\s+INTO\s+(?:"([^"]+)"|`([^`]+)`|(\w+(?:\.\w+)?))/i)
  const table = intoMatch ? (intoMatch[1] ?? intoMatch[2] ?? intoMatch[3] ?? null) : null

  return {
    type: 'INSERT',
    table,
    hasWhere: false,
    hasJoin: false,
  }
}

function parseUpdate(normalized: string, upper: string): ParsedStatement {
  // UPDATE table_name SET ...
  const updateMatch = normalized.match(/\bUPDATE\s+(?:"([^"]+)"|`([^`]+)`|(\w+(?:\.\w+)?))/i)
  const table = updateMatch ? (updateMatch[1] ?? updateMatch[2] ?? updateMatch[3] ?? null) : null

  return {
    type: 'UPDATE',
    table,
    hasWhere: /\bWHERE\b/i.test(upper),
    hasJoin: /\bJOIN\b/i.test(upper),
  }
}

function parseDelete(normalized: string, upper: string): ParsedStatement {
  // DELETE FROM table_name
  const deleteMatch = normalized.match(/\bDELETE\s+FROM\s+(?:"([^"]+)"|`([^`]+)`|(\w+(?:\.\w+)?))/i)
  const table = deleteMatch ? (deleteMatch[1] ?? deleteMatch[2] ?? deleteMatch[3] ?? null) : null

  return {
    type: 'DELETE',
    table,
    hasWhere: /\bWHERE\b/i.test(upper),
    hasJoin: /\bJOIN\b/i.test(upper),
  }
}
