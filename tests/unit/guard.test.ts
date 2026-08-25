import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTenantGuard } from '../../src/guard.js'
import { TenantRequiredError } from '../../src/errors.js'
import type { DatabaseAdapter, QueryResult } from '../../src/types.js'

/**
 * Creates a mock DatabaseAdapter for testing.
 */
function createMockAdapter(): DatabaseAdapter & {
  lastQuery: { sql: string; params: unknown[] } | null
  queryResults: QueryResult
} {
  const mock = {
    lastQuery: null as { sql: string; params: unknown[] } | null,
    queryResults: { rows: [{ id: 1 }], rowCount: 1 } as QueryResult,

    async query(sql: string, params?: unknown[]): Promise<QueryResult> {
      mock.lastQuery = { sql, params: params ?? [] }
      return mock.queryResults
    },

    async beginTransaction() {
      const trxQueries: { sql: string; params: unknown[] }[] = []
      return {
        async query(sql: string, params?: unknown[]): Promise<QueryResult> {
          trxQueries.push({ sql, params: params ?? [] })
          mock.lastQuery = { sql, params: params ?? [] }
          return mock.queryResults
        },
        async commit() {},
        async rollback() {},
        _queries: trxQueries,
      }
    },
  }

  return mock
}

describe('TenantGuard', () => {
  let adapter: ReturnType<typeof createMockAdapter>

  beforeEach(() => {
    adapter = createMockAdapter()
  })

  describe('query()', () => {
    it('should scope queries with tenant_id when context is active', async () => {
      const guard = createTenantGuard(adapter, { paramStyle: 'numbered' })

      await guard.run('tenant-abc', async () => {
        await guard.query('SELECT * FROM users')
      })

      expect(adapter.lastQuery!.sql).toBe('SELECT * FROM users WHERE tenant_id = $1')
      expect(adapter.lastQuery!.params).toEqual(['tenant-abc'])
    })

    it('should throw TenantRequiredError when no context is active', async () => {
      const guard = createTenantGuard(adapter, { paramStyle: 'numbered' })

      await expect(guard.query('SELECT * FROM users')).rejects.toThrow(TenantRequiredError)
    })

    it('should use column overrides', async () => {
      const guard = createTenantGuard(adapter, {
        paramStyle: 'numbered',
        columnOverrides: { orders: 'company_id' },
      })

      await guard.run('tenant-abc', async () => {
        await guard.query('SELECT * FROM orders')
      })

      expect(adapter.lastQuery!.sql).toBe('SELECT * FROM orders WHERE company_id = $1')
    })

    it('should not scope shared tables', async () => {
      const guard = createTenantGuard(adapter, {
        paramStyle: 'numbered',
        sharedTables: ['countries'],
      })

      await guard.run('tenant-abc', async () => {
        await guard.query('SELECT * FROM countries')
      })

      expect(adapter.lastQuery!.sql).toBe('SELECT * FROM countries')
      expect(adapter.lastQuery!.params).toEqual([])
    })

    it('should scope INSERT queries', async () => {
      const guard = createTenantGuard(adapter, { paramStyle: 'numbered' })

      await guard.run('tenant-abc', async () => {
        await guard.query(
          'INSERT INTO users (name, email) VALUES ($1, $2)',
          ['John', 'john@test.com'],
        )
      })

      expect(adapter.lastQuery!.sql).toBe(
        'INSERT INTO users (name, email, tenant_id) VALUES ($1, $2, $3)',
      )
      expect(adapter.lastQuery!.params).toEqual(['John', 'john@test.com', 'tenant-abc'])
    })

    it('should scope UPDATE queries', async () => {
      const guard = createTenantGuard(adapter, { paramStyle: 'numbered' })

      await guard.run('tenant-abc', async () => {
        await guard.query('UPDATE users SET name = $1 WHERE id = $2', ['Jane', 1])
      })

      expect(adapter.lastQuery!.sql).toBe(
        'UPDATE users SET name = $1 WHERE (id = $2) AND tenant_id = $3',
      )
      expect(adapter.lastQuery!.params).toEqual(['Jane', 1, 'tenant-abc'])
    })

    it('should scope DELETE queries', async () => {
      const guard = createTenantGuard(adapter, { paramStyle: 'numbered' })

      await guard.run('tenant-abc', async () => {
        await guard.query('DELETE FROM users WHERE id = $1', [42])
      })

      expect(adapter.lastQuery!.sql).toBe(
        'DELETE FROM users WHERE (id = $1) AND tenant_id = $2',
      )
      expect(adapter.lastQuery!.params).toEqual([42, 'tenant-abc'])
    })
  })

  describe('unscoped()', () => {
    it('should execute query without tenant scoping', async () => {
      const guard = createTenantGuard(adapter, { paramStyle: 'numbered' })

      await guard.unscoped('SELECT * FROM users')

      expect(adapter.lastQuery!.sql).toBe('SELECT * FROM users')
      expect(adapter.lastQuery!.params).toEqual([])
    })

    it('should throw and emit error event when unscoped query fails in adapter', async () => {
      const failingAdapter = createMockAdapter()
      failingAdapter.query = async () => {
        throw new Error('Unscoped DB error')
      }
      const guard = createTenantGuard(failingAdapter, { paramStyle: 'numbered' })
      const errors: unknown[] = []
      guard.events.on('error', (e) => errors.push(e))

      await expect(guard.unscoped('SELECT * FROM crash')).rejects.toThrow('Unscoped DB error')
      expect(errors).toHaveLength(1)
    })
  })

  describe('run()', () => {
    it('should set tenant context for the duration of the callback', async () => {
      const guard = createTenantGuard(adapter, { paramStyle: 'numbered' })

      const tenantId = await guard.run('tenant-xyz', async () => {
        return guard.context.get()
      })

      expect(tenantId).toBe('tenant-xyz')
    })

    it('should isolate concurrent tenant contexts', async () => {
      const guard = createTenantGuard(adapter, { paramStyle: 'numbered' })

      const results = await Promise.all([
        guard.run('tenant-1', async () => {
          await new Promise((r) => setTimeout(r, 20))
          return guard.context.get()
        }),
        guard.run('tenant-2', async () => {
          await new Promise((r) => setTimeout(r, 10))
          return guard.context.get()
        }),
      ])

      expect(results).toEqual(['tenant-1', 'tenant-2'])
    })
  })

  describe('transaction()', () => {
    it('should scope queries within a transaction', async () => {
      const guard = createTenantGuard(adapter, { paramStyle: 'numbered' })

      await guard.run('tenant-abc', async () => {
        await guard.transaction(async (trx) => {
          await trx.query('SELECT * FROM users')
        })
      })

      expect(adapter.lastQuery!.sql).toBe('SELECT * FROM users WHERE tenant_id = $1')
    })

    it('should throw TenantRequiredError without context', async () => {
      const guard = createTenantGuard(adapter, { paramStyle: 'numbered' })

      await expect(
        guard.transaction(async (trx) => {
          await trx.query('SELECT * FROM users')
        }),
      ).rejects.toThrow(TenantRequiredError)
    })

    it('should support unscoped queries within a transaction', async () => {
      const guard = createTenantGuard(adapter, { paramStyle: 'numbered' })

      await guard.run('tenant-abc', async () => {
        await guard.transaction(async (trx) => {
          await trx.unscoped('SELECT * FROM countries')
        })
      })

      expect(adapter.lastQuery!.sql).toBe('SELECT * FROM countries')
    })
  })

  describe('events', () => {
    it('should emit query:scoped event', async () => {
      const guard = createTenantGuard(adapter, { paramStyle: 'numbered' })
      const events: unknown[] = []

      guard.events.on('query:scoped', (e) => events.push(e))

      await guard.run('tenant-abc', async () => {
        await guard.query('SELECT * FROM users')
      })

      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        tenantId: 'tenant-abc',
        table: 'users',
      })
    })

    it('should emit query:bypassed event for unscoped', async () => {
      const guard = createTenantGuard(adapter, { paramStyle: 'numbered' })
      const events: unknown[] = []

      guard.events.on('query:bypassed', (e) => events.push(e))

      await guard.unscoped('SELECT * FROM users')

      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ reason: 'unscoped' })
    })

    it('should emit tenant:missing event when query without context', async () => {
      const guard = createTenantGuard(adapter, { paramStyle: 'numbered' })
      const events: unknown[] = []

      guard.events.on('tenant:missing', (e) => events.push(e))

      try {
        await guard.query('SELECT * FROM users')
      } catch {
        // Expected
      }

      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ sql: 'SELECT * FROM users' })
    })

    it('should emit tenant:set event on run()', async () => {
      const guard = createTenantGuard(adapter, { paramStyle: 'numbered' })
      const events: unknown[] = []

      guard.events.on('tenant:set', (e) => events.push(e))

      await guard.run('tenant-abc', async () => {})

      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ tenantId: 'tenant-abc' })
    })

    it('should emit query:shared for shared table queries', async () => {
      const guard = createTenantGuard(adapter, {
        paramStyle: 'numbered',
        sharedTables: ['countries'],
      })
      const events: unknown[] = []

      guard.events.on('query:shared', (e) => events.push(e))

      await guard.run('tenant-abc', async () => {
        await guard.query('SELECT * FROM countries')
      })

      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ table: 'countries' })
    })

    it('should emit error event on adapter failure', async () => {
      const failAdapter = createMockAdapter()
      failAdapter.query = async () => {
        throw new Error('Connection refused')
      }

      const guard = createTenantGuard(failAdapter, { paramStyle: 'numbered' })
      const errors: unknown[] = []

      guard.events.on('error', (e) => errors.push(e))

      await guard.run('tenant-abc', async () => {
        await expect(guard.query('SELECT * FROM users')).rejects.toThrow('Connection refused')
      })

      expect(errors).toHaveLength(1)
    })
  })
})
