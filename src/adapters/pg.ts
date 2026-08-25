/**
 * PostgreSQL adapter for @silviosln/tenant-guard
 *
 * Wraps the `pg` driver (Pool or Client) to implement the DatabaseAdapter interface.
 *
 * @example
 * ```typescript
 * import { createTenantGuardPg } from '@silviosln/tenant-guard/pg'
 * import { Pool } from 'pg'
 *
 * const pool = new Pool({ connectionString: process.env.DATABASE_URL })
 * const guard = createTenantGuardPg(pool, {
 *   defaultColumn: 'tenant_id',
 *   sharedTables: ['countries'],
 * })
 * ```
 */

import type { Pool, PoolClient } from 'pg'
import { createTenantGuard, type TenantGuard } from '../guard.js'
import type { DatabaseAdapter, QueryResult, TenantGuardConfig, TransactionClient } from '../types.js'

/**
 * Create a DatabaseAdapter from a pg Pool instance.
 */
export function createPgAdapter(pool: Pool): DatabaseAdapter {
  return {
    async query(sql: string, params?: unknown[]): Promise<QueryResult> {
      const result = await pool.query(sql, params)
      return {
        rows: result.rows,
        rowCount: result.rowCount ?? 0,
      }
    },

    async beginTransaction(): Promise<TransactionClient> {
      const client: PoolClient = await pool.connect()
      await client.query('BEGIN')

      return {
        async query(sql: string, params?: unknown[]): Promise<QueryResult> {
          const result = await client.query(sql, params)
          return {
            rows: result.rows,
            rowCount: result.rowCount ?? 0,
          }
        },

        async commit(): Promise<void> {
          try {
            await client.query('COMMIT')
          } finally {
            client.release()
          }
        },

        async rollback(): Promise<void> {
          try {
            await client.query('ROLLBACK')
          } finally {
            client.release()
          }
        },
      }
    },
  }
}

/**
 * Create a fully configured TenantGuard using a pg Pool.
 *
 * Convenience function that creates the adapter and guard in one step.
 * Automatically sets paramStyle to 'numbered' ($1, $2, ...).
 */
export function createTenantGuardPg(pool: Pool, config?: Omit<TenantGuardConfig, 'paramStyle'>): TenantGuard {
  const adapter = createPgAdapter(pool)
  return createTenantGuard(adapter, {
    ...config,
    paramStyle: 'numbered',
  })
}
