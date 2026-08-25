/**
 * SqlInterceptor — the core engine that modifies SQL queries to inject tenant scoping.
 *
 * Supports SELECT, INSERT, UPDATE, and DELETE statements.
 * Uses regex-based parsing to inject WHERE clauses and column values.
 *
 * Parameter styles:
 * - 'numbered': PostgreSQL style ($1, $2, $3, ...)
 * - 'positional': MySQL style (?, ?, ?, ...)
 */

import { parseStatement } from './parser.js'
import { TableResolver } from './table-resolver.js'
import type { InterceptedQuery } from '../types.js'
import { QueryInterceptError, StrictModeError } from '../errors.js'

export type ParamStyle = 'positional' | 'numbered'

export interface SqlInterceptorConfig {
  tableResolver: TableResolver
  paramStyle: ParamStyle
  strictMode?: boolean
}

export class SqlInterceptor {
  private readonly tableResolver: TableResolver
  private readonly paramStyle: ParamStyle
  private readonly strictMode: boolean

  constructor(config: SqlInterceptorConfig) {
    this.tableResolver = config.tableResolver
    this.paramStyle = config.paramStyle
    this.strictMode = config.strictMode ?? false
  }

  /**
   * Intercept a SQL query and inject tenant scoping.
   *
   * @param sql - The original SQL query
   * @param params - The original query parameters
   * @param tenantId - The tenant ID to scope to
   * @returns The modified query and parameters with tenant scope injected
   */
  intercept(sql: string, params: unknown[], tenantId: string): InterceptedQuery {
    if (this.strictMode) {
      // Check for JOIN, WITH, UNION or multiple SELECTs (subqueries)
      if (/\b(JOIN|WITH|UNION)\b/i.test(sql) || /\bSELECT\b.*\bSELECT\b/i.test(sql)) {
        throw new StrictModeError(sql)
      }
    }

    const parsed = parseStatement(sql)

    // If we can't identify the table (or it's a SELECT without FROM like SELECT 1, SELECT NOW())
    if (!parsed.table) {
      if (parsed.type === 'UNKNOWN' || parsed.type === 'SELECT') {
        return { sql, params: [...params] }
      }
      throw new QueryInterceptError(
        `Could not identify target table in ${parsed.type} statement`,
        sql,
      )
    }

    // Check if the table is shared (no scoping needed)
    const column = this.tableResolver.getColumn(parsed.table)
    if (column === null) {
      return { sql, params: [...params] }
    }

    switch (parsed.type) {
      case 'SELECT':
        return this.interceptSelect(sql, params, tenantId, column, parsed.hasWhere)
      case 'INSERT':
        return this.interceptInsert(sql, params, tenantId, column)
      case 'UPDATE':
        return this.interceptUpdate(sql, params, tenantId, column, parsed.hasWhere)
      case 'DELETE':
        return this.interceptDelete(sql, params, tenantId, column, parsed.hasWhere)
      default:
        return { sql, params: [...params] }
    }
  }

  /**
   * Check if a table is shared (no scoping applied).
   */
  isSharedTable(tableName: string): boolean {
    return this.tableResolver.isShared(tableName)
  }

  /**
   * Get the tenant column for a table, or null if shared.
   */
  getColumnForTable(tableName: string): string | null {
    return this.tableResolver.getColumn(tableName)
  }

  // ─── Private Interceptors ──────────────────────────────────────────

  private interceptSelect(
    sql: string,
    params: unknown[],
    tenantId: string,
    column: string,
    hasWhere: boolean,
  ): InterceptedQuery {
    const newParams = [...params, tenantId]
    const placeholder = this.placeholder(newParams.length)
    const condition = `${column} = ${placeholder}`

    let newSql: string

    if (hasWhere) {
      const whereMatch = /\bWHERE\s+/i.exec(sql)
      if (whereMatch) {
        const whereStart = whereMatch.index
        const whereEndKeyword = whereStart + whereMatch[0].length
        const insertPoint = this.findWhereInsertPoint(sql)
        const whereBody = sql.substring(whereEndKeyword, insertPoint).trim()
        const beforeWhere = sql.substring(0, whereStart).trimEnd()
        const afterWhere = sql.substring(insertPoint).trim()

        newSql = `${beforeWhere} WHERE (${whereBody}) AND ${condition}${afterWhere ? ' ' + afterWhere : ''}`
      } else {
        newSql = `${sql} WHERE ${condition}`
      }
    } else {
      const insertPoint = this.findWhereInsertPoint(sql)
      if (insertPoint === sql.length) {
        newSql = `${sql} WHERE ${condition}`
      } else {
        const before = sql.substring(0, insertPoint).replace(/\s+$/, '')
        const after = sql.substring(insertPoint)
        newSql = `${before} WHERE ${condition} ${after}`
      }
    }

    return { sql: newSql, params: newParams }
  }

  private parseColumnList(columnListStr: string): string[] {
    return columnListStr.split(',').map((c) => {
      const trimmed = c.trim().replace(/["`]/g, '').toLowerCase()
      const parts = trimmed.split('.')
      return parts[parts.length - 1]!
    })
  }

  private interceptInsert(
    sql: string,
    params: unknown[],
    tenantId: string,
    column: string,
  ): InterceptedQuery {
    const columnListMatch = sql.match(
      /\bINSERT\s+INTO\s+(?:"[^"]+"|`[^`]+`|\w+(?:\.\w+)?)\s*\(([^)]+)\)/i,
    )

    if (!columnListMatch) {
      throw new QueryInterceptError(
        `INSERT without explicit column list cannot be safely scoped. Add "${column}" to your column list.`,
        sql,
      )
    }

    const columnList = columnListMatch[1]!
    const parsedColumns = this.parseColumnList(columnList)
    const targetColLower = column.toLowerCase()
    const existingColIndex = parsedColumns.indexOf(targetColLower)

    // If the tenant column is ALREADY explicitly present in the INSERT query (common in legacy code)
    if (existingColIndex !== -1) {
      const valuesMatch = /\bVALUES\s*/i.exec(sql)
      if (!valuesMatch) {
        return { sql, params: [...params] }
      }

      const valuesStartIndex = valuesMatch.index + valuesMatch[0].length
      const valuesPart = sql.substring(valuesStartIndex)
      const newParams = [...params]

      if (this.paramStyle === 'positional') {
        const tupleMatches = valuesPart.matchAll(/\(([^)]+)\)/g)
        for (const tupleMatch of tupleMatches) {
          const tupleContent = tupleMatch[1]!
          const items = tupleContent.split(',').map((s) => s.trim())
          if (items[existingColIndex]?.includes('?')) {
            const beforeTuple = valuesPart.substring(0, tupleMatch.index!)
            const qBeforeTuple = (beforeTuple.match(/\?/g) || []).length
            const inTupleBeforeItem = items.slice(0, existingColIndex).join(', ')
            const qInTupleBeforeItem = (inTupleBeforeItem.match(/\?/g) || []).length
            const paramIndexToOverride = qBeforeTuple + qInTupleBeforeItem
            if (paramIndexToOverride < newParams.length) {
              newParams[paramIndexToOverride] = tenantId
            }
          }
        }
      } else {
        const tupleMatches = valuesPart.matchAll(/\(([^)]+)\)/g)
        for (const tupleMatch of tupleMatches) {
          const tupleContent = tupleMatch[1]!
          const items = tupleContent.split(',').map((s) => s.trim())
          const item = items[existingColIndex]
          if (item) {
            const dollarMatch = item.match(/\$(\d+)/)
            if (dollarMatch) {
              const paramNum = parseInt(dollarMatch[1]!, 10)
              if (paramNum > 0 && paramNum <= newParams.length) {
                newParams[paramNum - 1] = tenantId
              }
            }
          }
        }
      }

      return { sql, params: newParams }
    }

    // Tenant column is not present — inject it into column list and VALUES
    const newColumnList = `${columnList}, ${column}`
    let newSql = sql.replace(columnList, newColumnList)

    const valuesMatch = /\bVALUES\s*/i.exec(newSql)
    if (!valuesMatch) {
      return { sql: newSql, params: [...params, tenantId] }
    }

    const valuesStartIndex = valuesMatch.index + valuesMatch[0].length
    const beforeValues = newSql.substring(0, valuesStartIndex)
    const valuesPart = newSql.substring(valuesStartIndex)

    const newParams: unknown[] = []
    let currentParamOffset = 0
    let numberedIndex = params.length

    const modifiedValuesPart = valuesPart.replace(/\(([^)]+)\)/g, (_match, tupleContent: string) => {
      if (this.paramStyle === 'positional') {
        const qCount = (tupleContent.match(/\?/g) || []).length
        const tupleParams = params.slice(currentParamOffset, currentParamOffset + qCount)
        currentParamOffset += qCount
        newParams.push(...tupleParams, tenantId)
        return `(${tupleContent}, ?)`
      } else {
        numberedIndex++
        newParams.push(tenantId)
        const placeholder = this.placeholder(numberedIndex)
        return `(${tupleContent}, ${placeholder})`
      }
    })

    newSql = beforeValues + modifiedValuesPart
    const finalParams = this.paramStyle === 'positional' ? newParams : [...params, ...newParams]

    return { sql: newSql, params: finalParams }
  }

  private interceptUpdate(
    sql: string,
    params: unknown[],
    tenantId: string,
    column: string,
    hasWhere: boolean,
  ): InterceptedQuery {
    const newParams = [...params, tenantId]
    const placeholder = this.placeholder(newParams.length)
    const condition = `${column} = ${placeholder}`

    let newSql: string

    if (hasWhere) {
      const whereMatch = /\bWHERE\s+/i.exec(sql)
      if (whereMatch) {
        const whereStart = whereMatch.index
        const whereEndKeyword = whereStart + whereMatch[0].length
        const insertPoint = this.findWhereInsertPoint(sql)
        const whereBody = sql.substring(whereEndKeyword, insertPoint).trim()
        const beforeWhere = sql.substring(0, whereStart).trimEnd()
        const afterWhere = sql.substring(insertPoint).trim()

        newSql = `${beforeWhere} WHERE (${whereBody}) AND ${condition}${afterWhere ? ' ' + afterWhere : ''}`
      } else {
        newSql = `${sql} WHERE ${condition}`
      }
    } else {
      const insertPoint = this.findWhereInsertPoint(sql)
      if (insertPoint === sql.length) {
        newSql = `${sql} WHERE ${condition}`
      } else {
        const before = sql.substring(0, insertPoint).replace(/\s+$/, '')
        const after = sql.substring(insertPoint)
        newSql = `${before} WHERE ${condition} ${after}`
      }
    }

    return { sql: newSql, params: newParams }
  }

  private interceptDelete(
    sql: string,
    params: unknown[],
    tenantId: string,
    column: string,
    hasWhere: boolean,
  ): InterceptedQuery {
    const newParams = [...params, tenantId]
    const placeholder = this.placeholder(newParams.length)
    const condition = `${column} = ${placeholder}`

    let newSql: string

    if (hasWhere) {
      const whereMatch = /\bWHERE\s+/i.exec(sql)
      if (whereMatch) {
        const whereStart = whereMatch.index
        const whereEndKeyword = whereStart + whereMatch[0].length
        const insertPoint = this.findWhereInsertPoint(sql)
        const whereBody = sql.substring(whereEndKeyword, insertPoint).trim()
        const beforeWhere = sql.substring(0, whereStart).trimEnd()
        const afterWhere = sql.substring(insertPoint).trim()

        newSql = `${beforeWhere} WHERE (${whereBody}) AND ${condition}${afterWhere ? ' ' + afterWhere : ''}`
      } else {
        newSql = `${sql} WHERE ${condition}`
      }
    } else {
      const insertPoint = this.findWhereInsertPoint(sql)
      if (insertPoint === sql.length) {
        newSql = `${sql} WHERE ${condition}`
      } else {
        const before = sql.substring(0, insertPoint).replace(/\s+$/, '')
        const after = sql.substring(insertPoint)
        newSql = `${before} WHERE ${condition} ${after}`
      }
    }

    return { sql: newSql, params: newParams }
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  /**
   * Generate a parameter placeholder based on the param style.
   * For 'numbered' (PostgreSQL): $1, $2, $3, ...
   * For 'positional' (MySQL): ?
   */
  private placeholder(position: number): string {
    return this.paramStyle === 'numbered' ? `$${position}` : '?'
  }

  /**
   * Find the position in the SQL string where a WHERE clause should be inserted.
   * Returns the index before ORDER BY, GROUP BY, HAVING, LIMIT, UNION, FOR UPDATE, or end of string.
   */
  private findWhereInsertPoint(sql: string): number {
    const clauses = /\b(ORDER\s+BY|GROUP\s+BY|HAVING|LIMIT|UNION|FOR\s+UPDATE|FOR\s+SHARE)\b/gi
    const match = clauses.exec(sql)
    return match ? match.index : sql.length
  }
}
