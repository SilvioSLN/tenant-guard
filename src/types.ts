/**
 * Core types for @silviosln/tenant-guard
 */

/**
 * Configuration for the tenant guard instance.
 */
export interface TenantGuardConfig {
  /** Default column name used to identify the tenant in tables. Defaults to 'tenant_id'. */
  defaultColumn?: string

  /** Override the tenant column name for specific tables. Example: { orders: 'company_id' } */
  columnOverrides?: Record<string, string>

  /** Tables that are shared across all tenants and should not be scoped. Example: ['countries', 'currencies'] */
  sharedTables?: string[]

  /** SQL parameter style. 'numbered' for PostgreSQL ($1, $2), 'positional' for MySQL (?). */
  paramStyle?: 'positional' | 'numbered'

  /** 
   * When true, blocks complex queries (JOIN, WITH, UNION, Subqueries) that the regex parser cannot scope safely. 
   * You must use .unscoped() for these queries. Defaults to false.
   */
  strictMode?: boolean
}

/**
 * Result of a database query.
 */
export interface QueryResult<T = Record<string, unknown>> {
  rows: T[]
  rowCount: number
}

/**
 * A transaction client with tenant scope.
 */
export interface TransactionClient {
  query(sql: string, params?: unknown[]): Promise<QueryResult>
  commit(): Promise<void>
  rollback(): Promise<void>
}

/**
 * Adapter interface that database drivers must implement.
 * This is the bridge between the tenant guard and the actual database driver.
 */
export interface DatabaseAdapter {
  /** Execute a SQL query with optional parameters. */
  query(sql: string, params?: unknown[]): Promise<QueryResult>

  /** Begin a new transaction and return a transaction client. */
  beginTransaction(): Promise<TransactionClient>
}

/**
 * Result of SQL interception — the modified query and params.
 */
export interface InterceptedQuery {
  /** The modified SQL string with tenant scope injected. */
  sql: string
  /** The modified parameters array with tenant ID appended if needed. */
  params: unknown[]
}

/**
 * Function that resolves a tenant ID from a generic request-like object.
 * Framework-agnostic — works with Express, Fastify, Koa, raw http, etc.
 */
export type TenantResolver = (req: {
  headers?: Record<string, string | string[] | undefined>
  hostname?: string
  url?: string
}) => string | undefined
