/**
 * MySQL2 adapter for @silviosln/tenant-guard
 *
 * Wraps the `mysql2/promise` driver (Pool) to implement the DatabaseAdapter interface.
 *
 * @example
 * ```typescript
 * import { createTenantGuardMysql2 } from '@silviosln/tenant-guard/mysql2'
 * import mysql from 'mysql2/promise'
 *
 * const pool = mysql.createPool({ host: 'localhost', database: 'mydb' })
 * const guard = createTenantGuardMysql2(pool, {
 *   defaultColumn: 'tenant_id',
 *   sharedTables: ['countries'],
 * })
 * ```
 */

import type { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise'
import { createTenantGuard, type TenantGuard } from '../guard.js'
import type { DatabaseAdapter, QueryResult, TenantGuardConfig, TransactionClient } from '../types.js'

/**
 * Create a DatabaseAdapter from a mysql2/promise Pool instance.
 */
export function createMysql2Adapter(pool: Pool): DatabaseAdapter {
  return {
    async query(sql: string, params?: unknown[]): Promise<QueryResult> {
      const [rows] = await pool.query(sql, params)

      // mysql2 returns different types based on the query
      if (Array.isArray(rows)) {
        return {
          rows: rows as Record<string, unknown>[],
          rowCount: rows.length,
        }
      }

      // For INSERT/UPDATE/DELETE, rows is a ResultSetHeader
      const header = rows as ResultSetHeader
      return {
        rows: [],
        rowCount: header.affectedRows ?? 0,
      }
    },

    async beginTransaction(): Promise<TransactionClient> {
      const connection: PoolConnection = await pool.getConnection()
      await connection.beginTransaction()

      return {
        async query(sql: string, params?: unknown[]): Promise<QueryResult> {
          const [rows] = await connection.query(sql, params)

          if (Array.isArray(rows)) {
            return {
              rows: rows as Record<string, unknown>[],
              rowCount: rows.length,
            }
          }

          const header = rows as ResultSetHeader
          return {
            rows: [],
            rowCount: header.affectedRows ?? 0,
          }
        },

        async commit(): Promise<void> {
          try {
            await connection.commit()
          } finally {
            connection.release()
          }
        },

        async rollback(): Promise<void> {
          try {
            await connection.rollback()
          } finally {
            connection.release()
          }
        },
      }
    },
  }
}

/**
 * Create a fully configured TenantGuard using a mysql2/promise Pool.
 *
 * Convenience function that creates the adapter and guard in one step.
 * Automatically sets paramStyle to 'positional' (? placeholders).
 */
export function createTenantGuardMysql2(pool: Pool, config?: Omit<TenantGuardConfig, 'paramStyle'>): TenantGuard {
  const adapter = createMysql2Adapter(pool)
  return createTenantGuard(adapter, {
    ...config,
    paramStyle: 'positional',
  })
}
