/**
 * TenantGuard — the main facade that ties together context, interceptor, and adapter.
 *
 * Created via createTenantGuard() factory function.
 */

import { TenantContext } from './context.js'
import { TenantGuardEmitter } from './events.js'
import { TenantRequiredError } from './errors.js'
import { SqlInterceptor, type ParamStyle } from './sql/interceptor.js'
import { TableResolver } from './sql/table-resolver.js'
import { parseStatement } from './sql/parser.js'
import type { DatabaseAdapter, TenantGuardConfig, QueryResult, TransactionClient } from './types.js'

/**
 * The main tenant guard instance.
 * Provides scoped query execution, bypass methods, and event observability.
 */
export interface TenantGuard {
  /** The tenant context manager. */
  readonly context: TenantContext

  /** Event emitter for observability. */
  readonly events: TenantGuardEmitter

  /**
   * Execute a query within the current tenant scope.
   * Automatically injects tenant filtering/values.
   *
   * @throws {TenantRequiredError} if no tenant context is active
   */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>

  /**
   * Execute a query WITHOUT tenant scoping (explicit bypass).
   * Use for admin queries, migrations, cross-tenant reports, etc.
   */
  unscoped<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>

  /**
   * Execute a function within the context of a specific tenant.
   * All queries inside `fn` will be automatically scoped.
   */
  run<T>(tenantId: string, fn: () => Promise<T>): Promise<T>

  /**
   * Execute a function within a database transaction, scoped to the current tenant.
   * The transaction is automatically committed on success and rolled back on error.
   *
   * @throws {TenantRequiredError} if no tenant context is active
   */
  transaction<T>(fn: (trx: ScopedTransaction) => Promise<T>): Promise<T>
}

/**
 * A transaction client that automatically scopes queries to the current tenant.
 */
export interface ScopedTransaction {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>
  unscoped<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>
}

/**
 * Internal configuration with resolved defaults.
 */
interface ResolvedConfig {
  paramStyle: 'positional' | 'numbered'
  tableResolver: TableResolver
  strictMode: boolean
}

/**
 * Create a TenantGuard instance with the given adapter and configuration.
 *
 * @param adapter - The database adapter (pg, mysql2, etc.)
 * @param config - Configuration options
 * @returns A fully configured TenantGuard instance
 */
export function createTenantGuard(
  adapter: DatabaseAdapter,
  config: TenantGuardConfig = {},
): TenantGuard {
  const resolved = resolveConfig(config)
  const context = new TenantContext()
  const events = new TenantGuardEmitter()
  const interceptor = new SqlInterceptor({
    tableResolver: resolved.tableResolver,
    paramStyle: resolved.paramStyle,
    strictMode: resolved.strictMode,
  })

  function scopeQuery(sql: string, params: unknown[], tenantId: string): { sql: string; params: unknown[] } {
    const parsed = parseStatement(sql)

    // Check for shared tables
    if (parsed.table && interceptor.isSharedTable(parsed.table)) {
      events.emit('query:shared', { sql, table: parsed.table })
      return { sql, params: [...params] }
    }

    const result = interceptor.intercept(sql, params, tenantId)

    events.emit('query:scoped', {
      sql: result.sql,
      originalSql: sql,
      tenantId,
      table: parsed.table,
    })

    return result
  }

  const guard: TenantGuard = {
    context,
    events,

    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
      const tenantId = context.getOptional()

      if (!tenantId) {
        events.emit('tenant:missing', { sql })
        throw new TenantRequiredError(sql)
      }

      try {
        const scoped = scopeQuery(sql, params, tenantId)
        return await adapter.query(scoped.sql, scoped.params) as QueryResult<T>
      } catch (error) {
        events.emit('error', { error: error as Error, sql })
        throw error
      }
    },

    async unscoped<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
      events.emit('query:bypassed', { sql, reason: 'unscoped' })

      try {
        return await adapter.query(sql, params) as QueryResult<T>
      } catch (error) {
        events.emit('error', { error: error as Error, sql })
        throw error
      }
    },

    async run<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
      events.emit('tenant:set', { tenantId })
      return context.run(tenantId, fn)
    },

    async transaction<T>(fn: (trx: ScopedTransaction) => Promise<T>): Promise<T> {
      const tenantId = context.getOptional()

      if (!tenantId) {
        throw new TenantRequiredError()
      }

      const trxClient = await adapter.beginTransaction()

      const scopedTrx: ScopedTransaction = {
        async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
          const scoped = scopeQuery(sql, params, tenantId)
          return await trxClient.query(scoped.sql, scoped.params) as QueryResult<T>
        },

        async unscoped<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
          events.emit('query:bypassed', { sql, reason: 'unscoped' })
          return await trxClient.query(sql, params) as QueryResult<T>
        },
      }

      try {
        const result = await fn(scopedTrx)
        await trxClient.commit()
        return result
      } catch (error) {
        await trxClient.rollback()
        events.emit('error', { error: error as Error })
        throw error
      }
    },
  }

  return guard
}

// ─── Helpers ──────────────────────────────────────────────────────────

function resolveConfig(config: TenantGuardConfig): ResolvedConfig {
  const tableResolver = new TableResolver({
    defaultColumn: config.defaultColumn ?? 'tenant_id',
    overrides: config.columnOverrides,
    sharedTables: config.sharedTables,
  })

  return {
    paramStyle: config.paramStyle ?? 'numbered',
    tableResolver,
    strictMode: config.strictMode ?? false,
  }
}
