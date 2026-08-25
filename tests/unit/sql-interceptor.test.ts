import { describe, it, expect, beforeEach } from 'vitest'
import { SqlInterceptor } from '../../src/sql/interceptor.js'
import { TableResolver } from '../../src/sql/table-resolver.js'
import { QueryInterceptError } from '../../src/errors.js'

describe('SqlInterceptor', () => {
  let interceptor: SqlInterceptor
  let interceptorMysql: SqlInterceptor

  beforeEach(() => {
    const tableResolver = new TableResolver({
      defaultColumn: 'tenant_id',
      overrides: { orders: 'company_id' },
      sharedTables: ['countries', 'currencies'],
    })

    interceptor = new SqlInterceptor({
      tableResolver,
      paramStyle: 'numbered',
    })

    interceptorMysql = new SqlInterceptor({
      tableResolver,
      paramStyle: 'positional',
    })
  })

  // ─── SELECT ────────────────────────────────────────────────

  describe('SELECT queries', () => {
    it('should inject WHERE clause for SELECT without WHERE', () => {
      const result = interceptor.intercept(
        'SELECT * FROM users',
        [],
        'tenant-abc',
      )
      expect(result.sql).toBe('SELECT * FROM users WHERE tenant_id = $1')
      expect(result.params).toEqual(['tenant-abc'])
    })

    it('should inject AND for SELECT with existing WHERE and parenthesize existing condition', () => {
      const result = interceptor.intercept(
        'SELECT * FROM users WHERE active = $1',
        [true],
        'tenant-abc',
      )
      expect(result.sql).toBe('SELECT * FROM users WHERE (active = $1) AND tenant_id = $2')
      expect(result.params).toEqual([true, 'tenant-abc'])
    })

    it('should handle SELECT with complex OR conditions safely', () => {
      const result = interceptor.intercept(
        'SELECT * FROM users WHERE status = $1 OR status = $2',
        ['pending', 'draft'],
        'tenant-abc',
      )
      expect(result.sql).toBe('SELECT * FROM users WHERE (status = $1 OR status = $2) AND tenant_id = $3')
      expect(result.params).toEqual(['pending', 'draft', 'tenant-abc'])
    })

    it('should handle SELECT without FROM table (e.g. SELECT 1, SELECT NOW())', () => {
      const result1 = interceptor.intercept('SELECT 1', [], 'tenant-abc')
      expect(result1.sql).toBe('SELECT 1')
      expect(result1.params).toEqual([])

      const result2 = interceptor.intercept('SELECT NOW(), @@version', [], 'tenant-abc')
      expect(result2.sql).toBe('SELECT NOW(), @@version')
      expect(result2.params).toEqual([])
    })

    it('should handle SELECT with ORDER BY', () => {
      const result = interceptor.intercept(
        'SELECT * FROM users ORDER BY name',
        [],
        'tenant-abc',
      )
      expect(result.sql).toBe('SELECT * FROM users WHERE tenant_id = $1 ORDER BY name')
      expect(result.params).toEqual(['tenant-abc'])
    })

    it('should handle SELECT with LIMIT', () => {
      const result = interceptor.intercept(
        'SELECT * FROM users LIMIT 10',
        [],
        'tenant-abc',
      )
      expect(result.sql).toBe('SELECT * FROM users WHERE tenant_id = $1 LIMIT 10')
      expect(result.params).toEqual(['tenant-abc'])
    })

    it('should handle SELECT with GROUP BY', () => {
      const result = interceptor.intercept(
        'SELECT status, COUNT(*) FROM users GROUP BY status',
        [],
        'tenant-abc',
      )
      expect(result.sql).toBe(
        'SELECT status, COUNT(*) FROM users WHERE tenant_id = $1 GROUP BY status',
      )
      expect(result.params).toEqual(['tenant-abc'])
    })

    it('should use column override for SELECT', () => {
      const result = interceptor.intercept(
        'SELECT * FROM orders WHERE status = $1',
        ['pending'],
        'tenant-abc',
      )
      expect(result.sql).toBe('SELECT * FROM orders WHERE (status = $1) AND company_id = $2')
      expect(result.params).toEqual(['pending', 'tenant-abc'])
    })

    it('should NOT inject for shared tables', () => {
      const result = interceptor.intercept(
        'SELECT * FROM countries',
        [],
        'tenant-abc',
      )
      expect(result.sql).toBe('SELECT * FROM countries')
      expect(result.params).toEqual([])
    })

    it('should use positional params for MySQL style', () => {
      const result = interceptorMysql.intercept(
        'SELECT * FROM users WHERE active = ?',
        [true],
        'tenant-abc',
      )
      expect(result.sql).toBe('SELECT * FROM users WHERE (active = ?) AND tenant_id = ?')
      expect(result.params).toEqual([true, 'tenant-abc'])
    })
  })

  // ─── INSERT ────────────────────────────────────────────────

  describe('INSERT queries', () => {
    it('should inject tenant column and value into single-row INSERT', () => {
      const result = interceptor.intercept(
        'INSERT INTO users (name, email) VALUES ($1, $2)',
        ['John', 'john@example.com'],
        'tenant-abc',
      )
      expect(result.sql).toBe(
        'INSERT INTO users (name, email, tenant_id) VALUES ($1, $2, $3)',
      )
      expect(result.params).toEqual(['John', 'john@example.com', 'tenant-abc'])
    })

    it('should support multi-row batch INSERT for PostgreSQL ($N)', () => {
      const result = interceptor.intercept(
        'INSERT INTO users (name, email) VALUES ($1, $2), ($3, $4)',
        ['Alice', 'alice@test.com', 'Bob', 'bob@test.com'],
        'tenant-abc',
      )
      expect(result.sql).toBe(
        'INSERT INTO users (name, email, tenant_id) VALUES ($1, $2, $5), ($3, $4, $6)',
      )
      expect(result.params).toEqual([
        'Alice',
        'alice@test.com',
        'Bob',
        'bob@test.com',
        'tenant-abc',
        'tenant-abc',
      ])
    })

    it('should support multi-row batch INSERT for MySQL (?) with correct param ordering', () => {
      const result = interceptorMysql.intercept(
        'INSERT INTO users (name, email) VALUES (?, ?), (?, ?)',
        ['Alice', 'alice@test.com', 'Bob', 'bob@test.com'],
        'tenant-abc',
      )
      expect(result.sql).toBe(
        'INSERT INTO users (name, email, tenant_id) VALUES (?, ?, ?), (?, ?, ?)',
      )
      expect(result.params).toEqual([
        'Alice',
        'alice@test.com',
        'tenant-abc',
        'Bob',
        'bob@test.com',
        'tenant-abc',
      ])
    })

    it('should use column override for INSERT', () => {
      const result = interceptor.intercept(
        'INSERT INTO orders (product, amount) VALUES ($1, $2)',
        ['Widget', 100],
        'tenant-abc',
      )
      expect(result.sql).toBe(
        'INSERT INTO orders (product, amount, company_id) VALUES ($1, $2, $3)',
      )
      expect(result.params).toEqual(['Widget', 100, 'tenant-abc'])
    })

    it('should NOT inject for shared tables in INSERT', () => {
      const result = interceptor.intercept(
        'INSERT INTO countries (name, code) VALUES ($1, $2)',
        ['Brazil', 'BR'],
        'tenant-abc',
      )
      expect(result.sql).toBe('INSERT INTO countries (name, code) VALUES ($1, $2)')
      expect(result.params).toEqual(['Brazil', 'BR'])
    })

    it('should NOT duplicate tenant column when explicitly provided in INSERT column list (positional - MySQL)', () => {
      const result = interceptorMysql.intercept(
        'INSERT INTO users (name, tenant_id, email) VALUES (?, ?, ?)',
        ['John', 'legacy-tenant-id', 'john@example.com'],
        'tenant-abc',
      )
      // SQL remains unchanged — no Column 'tenant_id' specified twice error!
      expect(result.sql).toBe('INSERT INTO users (name, tenant_id, email) VALUES (?, ?, ?)')
      // Parameter at tenant_id position is enforced to the active context's tenantId
      expect(result.params).toEqual(['John', 'tenant-abc', 'john@example.com'])
    })

    it('should NOT duplicate tenant column when explicitly provided in INSERT column list (numbered - PostgreSQL)', () => {
      const result = interceptor.intercept(
        'INSERT INTO users (tenant_id, name, email) VALUES ($1, $2, $3)',
        ['wrong-tenant', 'John', 'john@example.com'],
        'tenant-abc',
      )
      expect(result.sql).toBe('INSERT INTO users (tenant_id, name, email) VALUES ($1, $2, $3)')
      expect(result.params).toEqual(['tenant-abc', 'John', 'john@example.com'])
    })

    it('should NOT duplicate tenant column in batch INSERT with explicit tenant column', () => {
      const result = interceptorMysql.intercept(
        'INSERT INTO users (name, tenant_id) VALUES (?, ?), (?, ?)',
        ['Alice', 't-old-1', 'Bob', 't-old-2'],
        'tenant-abc',
      )
      expect(result.sql).toBe('INSERT INTO users (name, tenant_id) VALUES (?, ?), (?, ?)')
      expect(result.params).toEqual(['Alice', 'tenant-abc', 'Bob', 'tenant-abc'])
    })

    it('should NOT duplicate column when using table override column explicitly', () => {
      const result = interceptor.intercept(
        'INSERT INTO orders (product, company_id, amount) VALUES ($1, $2, $3)',
        ['Widget', 'old-company', 100],
        'tenant-abc',
      )
      expect(result.sql).toBe('INSERT INTO orders (product, company_id, amount) VALUES ($1, $2, $3)')
      expect(result.params).toEqual(['Widget', 'tenant-abc', 100])
    })

    it('should throw for INSERT without explicit column list', () => {
      expect(() =>
        interceptor.intercept(
          'INSERT INTO users VALUES ($1, $2)',
          ['John', 'john@example.com'],
          'tenant-abc',
        ),
      ).toThrow(QueryInterceptError)
    })
  })

  // ─── UPDATE ────────────────────────────────────────────────

  describe('UPDATE queries', () => {
    it('should inject WHERE clause for UPDATE without WHERE', () => {
      const result = interceptor.intercept(
        'UPDATE users SET name = $1',
        ['Jane'],
        'tenant-abc',
      )
      expect(result.sql).toBe('UPDATE users SET name = $1 WHERE tenant_id = $2')
      expect(result.params).toEqual(['Jane', 'tenant-abc'])
    })

    it('should inject AND for UPDATE with existing WHERE and parenthesize', () => {
      const result = interceptor.intercept(
        'UPDATE users SET name = $1 WHERE id = $2',
        ['Jane', 42],
        'tenant-abc',
      )
      expect(result.sql).toBe('UPDATE users SET name = $1 WHERE (id = $2) AND tenant_id = $3')
      expect(result.params).toEqual(['Jane', 42, 'tenant-abc'])
    })

    it('should use column override for UPDATE', () => {
      const result = interceptor.intercept(
        'UPDATE orders SET status = $1 WHERE id = $2',
        ['shipped', 1],
        'tenant-abc',
      )
      expect(result.sql).toBe('UPDATE orders SET status = $1 WHERE (id = $2) AND company_id = $3')
      expect(result.params).toEqual(['shipped', 1, 'tenant-abc'])
    })

    it('should NOT inject for shared tables in UPDATE', () => {
      const result = interceptor.intercept(
        'UPDATE countries SET name = $1 WHERE code = $2',
        ['Brasil', 'BR'],
        'tenant-abc',
      )
      expect(result.sql).toBe('UPDATE countries SET name = $1 WHERE code = $2')
      expect(result.params).toEqual(['Brasil', 'BR'])
    })
  })

  // ─── DELETE ────────────────────────────────────────────────

  describe('DELETE queries', () => {
    it('should inject WHERE clause for DELETE without WHERE', () => {
      const result = interceptor.intercept(
        'DELETE FROM users',
        [],
        'tenant-abc',
      )
      expect(result.sql).toBe('DELETE FROM users WHERE tenant_id = $1')
      expect(result.params).toEqual(['tenant-abc'])
    })

    it('should inject AND for DELETE with existing WHERE and parenthesize', () => {
      const result = interceptor.intercept(
        'DELETE FROM users WHERE id = $1',
        [42],
        'tenant-abc',
      )
      expect(result.sql).toBe('DELETE FROM users WHERE (id = $1) AND tenant_id = $2')
      expect(result.params).toEqual([42, 'tenant-abc'])
    })

    it('should use column override for DELETE', () => {
      const result = interceptor.intercept(
        'DELETE FROM orders WHERE id = $1',
        [1],
        'tenant-abc',
      )
      expect(result.sql).toBe('DELETE FROM orders WHERE (id = $1) AND company_id = $2')
      expect(result.params).toEqual([1, 'tenant-abc'])
    })

    it('should NOT inject for shared tables in DELETE', () => {
      const result = interceptor.intercept(
        'DELETE FROM countries WHERE code = $1',
        ['BR'],
        'tenant-abc',
      )
      expect(result.sql).toBe('DELETE FROM countries WHERE code = $1')
      expect(result.params).toEqual(['BR'])
    })
  })

  // ─── UNKNOWN ───────────────────────────────────────────────

  describe('UNKNOWN queries', () => {
    it('should return query as-is for DDL statements', () => {
      const result = interceptor.intercept(
        'CREATE TABLE test (id INT)',
        [],
        'tenant-abc',
      )
      expect(result.sql).toBe('CREATE TABLE test (id INT)')
      expect(result.params).toEqual([])
    })

    it('should return query as-is for TRUNCATE', () => {
      const result = interceptor.intercept(
        'TRUNCATE TABLE users',
        [],
        'tenant-abc',
      )
      expect(result.sql).toBe('TRUNCATE TABLE users')
      expect(result.params).toEqual([])
    })
  })

  // ─── Edge Cases ────────────────────────────────────────────

  describe('Edge cases', () => {
    it('should handle queries with SQL comments', () => {
      const result = interceptor.intercept(
        '-- Get all users\nSELECT * FROM users',
        [],
        'tenant-abc',
      )
      expect(result.sql).toContain('tenant_id = $1')
    })

    it('should handle queries with extra whitespace', () => {
      const result = interceptor.intercept(
        'SELECT   *   FROM   users',
        [],
        'tenant-abc',
      )
      expect(result.sql).toContain('tenant_id')
      expect(result.params).toEqual(['tenant-abc'])
    })

    it('should handle quoted table names', () => {
      const result = interceptor.intercept(
        'SELECT * FROM "users"',
        [],
        'tenant-abc',
      )
      expect(result.sql).toContain('tenant_id = $1')
    })

    it('should handle schema-qualified table names (public.users)', () => {
      const result = interceptor.intercept(
        'SELECT * FROM public.users',
        [],
        'tenant-abc',
      )
      expect(result.sql).toBe('SELECT * FROM public.users WHERE tenant_id = $1')
    })

    it('should handle backtick and double-quoted table names in INSERT, UPDATE, and DELETE', () => {
      const insertBacktick = interceptorMysql.intercept(
        'INSERT INTO `users` (name) VALUES (?)',
        ['Alice'],
        'tenant-1',
      )
      expect(insertBacktick.sql).toBe('INSERT INTO `users` (name, tenant_id) VALUES (?, ?)')

      const updateBacktick = interceptorMysql.intercept(
        'UPDATE `users` SET name = ?',
        ['Bob'],
        'tenant-1',
      )
      expect(updateBacktick.sql).toBe('UPDATE `users` SET name = ? WHERE tenant_id = ?')

      const deleteBacktick = interceptorMysql.intercept(
        'DELETE FROM `users` WHERE id = ?',
        [1],
        'tenant-1',
      )
      expect(deleteBacktick.sql).toBe('DELETE FROM `users` WHERE (id = ?) AND tenant_id = ?')

      const updateDoubleQuote = interceptor.intercept(
        'UPDATE "users" SET name = $1',
        ['Bob'],
        'tenant-1',
      )
      expect(updateDoubleQuote.sql).toBe('UPDATE "users" SET name = $1 WHERE tenant_id = $2')
    })

    it('should handle SELECT with FOR UPDATE and FOR SHARE (inserting WHERE before clause)', () => {
      const resForUpdate = interceptor.intercept(
        'SELECT * FROM users FOR UPDATE',
        [],
        'tenant-abc',
      )
      expect(resForUpdate.sql).toBe('SELECT * FROM users WHERE tenant_id = $1 FOR UPDATE')

      const resForShare = interceptor.intercept(
        'SELECT * FROM users FOR SHARE',
        [],
        'tenant-abc',
      )
      expect(resForShare.sql).toBe('SELECT * FROM users WHERE tenant_id = $1 FOR SHARE')
    })

    it('should handle UPDATE and DELETE with LIMIT without WHERE clause', () => {
      const updateLimit = interceptorMysql.intercept(
        'UPDATE users SET active = ? LIMIT 5',
        [1],
        'tenant-abc',
      )
      expect(updateLimit.sql).toBe('UPDATE users SET active = ? WHERE tenant_id = ? LIMIT 5')
      expect(updateLimit.params).toEqual([1, 'tenant-abc'])

      const deleteLimit = interceptorMysql.intercept(
        'DELETE FROM users LIMIT 10',
        [],
        'tenant-abc',
      )
      expect(deleteLimit.sql).toBe('DELETE FROM users WHERE tenant_id = ? LIMIT 10')
      expect(deleteLimit.params).toEqual(['tenant-abc'])
    })

    it('should handle INSERT without VALUES keyword (e.g. INSERT INTO ... SELECT)', () => {
      const result = interceptor.intercept(
        'INSERT INTO backup_users (name) SELECT name FROM users',
        [],
        'tenant-abc',
      )
      expect(result.sql).toBe('INSERT INTO backup_users (name, tenant_id) SELECT name FROM users')
      expect(result.params).toEqual(['tenant-abc'])
    })
  })
})
