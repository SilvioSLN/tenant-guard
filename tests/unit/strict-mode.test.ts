import { describe, it, expect, beforeEach } from 'vitest'
import { createTenantGuard } from '../../src/guard.js'
import type { DatabaseAdapter } from '../../src/types.js'
import { StrictModeError } from '../../src/errors.js'

describe('Strict Mode (strictMode)', () => {
  let mockAdapter: DatabaseAdapter
  let queries: string[]

  beforeEach(() => {
    queries = []
    mockAdapter = {
      async query(sql) {
        queries.push(sql)
        return { rows: [], rowCount: 0 }
      },
      async beginTransaction() {
        return {
          async query(sql) {
            queries.push(sql)
            return { rows: [], rowCount: 0 }
          },
          async commit() {},
          async rollback() {},
        }
      },
    }
  })

  it('should block queries with JOIN when strictMode is enabled', async () => {
    const guard = createTenantGuard(mockAdapter, { strictMode: true })

    await guard.run('tenant-1', async () => {
      await expect(
        guard.query('SELECT * FROM users u JOIN orders o ON u.id = o.user_id')
      ).rejects.toThrow(StrictModeError)

      // Different casing
      await expect(
        guard.query('select * from users u join orders o on u.id = o.user_id')
      ).rejects.toThrow(StrictModeError)
    })
  })

  it('should block queries with WITH (CTEs) when strictMode is enabled', async () => {
    const guard = createTenantGuard(mockAdapter, { strictMode: true })

    await guard.run('tenant-1', async () => {
      await expect(
        guard.query('WITH active_users AS (SELECT * FROM users) SELECT * FROM active_users')
      ).rejects.toThrow(StrictModeError)
    })
  })

  it('should block queries with UNION when strictMode is enabled', async () => {
    const guard = createTenantGuard(mockAdapter, { strictMode: true })

    await guard.run('tenant-1', async () => {
      await expect(
        guard.query('SELECT * FROM users UNION SELECT * FROM old_users')
      ).rejects.toThrow(StrictModeError)
    })
  })

  it('should block multiple SELECTs (subqueries) when strictMode is enabled', async () => {
    const guard = createTenantGuard(mockAdapter, { strictMode: true })

    await guard.run('tenant-1', async () => {
      await expect(
        guard.query('SELECT * FROM users WHERE id IN (SELECT user_id FROM orders)')
      ).rejects.toThrow(StrictModeError)
    })
  })

  it('should allow normal CRUD queries when strictMode is enabled', async () => {
    const guard = createTenantGuard(mockAdapter, { strictMode: true })

    await guard.run('tenant-1', async () => {
      await guard.query('SELECT * FROM users WHERE active = 1')
      await guard.query('INSERT INTO users (name) VALUES ($1)', ['John'])
      await guard.query('UPDATE users SET name = $1 WHERE id = 1', ['John'])
      await guard.query('DELETE FROM users WHERE id = 1')

      expect(queries).toHaveLength(4)
      expect(queries[0]).toContain('SELECT * FROM users WHERE (active = 1) AND tenant_id = $1')
      expect(queries[1]).toContain('INSERT INTO users (name, tenant_id) VALUES ($1, $2)')
    })
  })

  it('should NOT block complex queries if strictMode is false (default)', async () => {
    const guard = createTenantGuard(mockAdapter, { strictMode: false })

    await guard.run('tenant-1', async () => {
      // It won't throw StrictModeError, though the regex might mangle it.
      // This test just ensures the strict check is bypassed.
      await guard.query('SELECT * FROM users u JOIN orders o ON u.id = o.user_id')
      expect(queries).toHaveLength(1)
    })
  })

  it('should allow complex queries via .unscoped() even when strictMode is true', async () => {
    const guard = createTenantGuard(mockAdapter, { strictMode: true })

    await guard.run('tenant-1', async () => {
      await guard.unscoped('SELECT * FROM users u JOIN orders o ON u.id = o.user_id')
      await guard.unscoped('WITH active_users AS (SELECT * FROM users) SELECT * FROM active_users')
      expect(queries).toHaveLength(2)
      // Unscoped query hits adapter exactly as written
      expect(queries[0]).toBe('SELECT * FROM users u JOIN orders o ON u.id = o.user_id')
    })
  })
})
