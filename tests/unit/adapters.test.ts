import { describe, it, expect, vi } from 'vitest'
import { createPgAdapter, createTenantGuardPg } from '../../src/adapters/pg.js'
import { createMysql2Adapter, createTenantGuardMysql2 } from '../../src/adapters/mysql2.js'
import type { Pool as PgPool, PoolClient } from 'pg'
import type { Pool as MysqlPool, PoolConnection, ResultSetHeader } from 'mysql2/promise'

describe('Database Adapters', () => {
  // ─── PostgreSQL Adapter ──────────────────────────────────────────

  describe('PostgreSQL Adapter', () => {
    it('should execute query via pg Pool', async () => {
      const mockPgPool = {
        query: vi.fn().mockResolvedValue({
          rows: [{ id: 1, name: 'Test' }],
          rowCount: 1,
        }),
      } as unknown as PgPool

      const adapter = createPgAdapter(mockPgPool)
      const result = await adapter.query('SELECT * FROM users WHERE tenant_id = $1', ['tenant-1'])

      expect(mockPgPool.query).toHaveBeenCalledWith('SELECT * FROM users WHERE tenant_id = $1', ['tenant-1'])
      expect(result.rows).toEqual([{ id: 1, name: 'Test' }])
      expect(result.rowCount).toBe(1)
    })

    it('should default rowCount to 0 when missing in pg result', async () => {
      const mockPgPool = {
        query: vi.fn().mockResolvedValue({
          rows: [],
          rowCount: null,
        }),
      } as unknown as PgPool

      const adapter = createPgAdapter(mockPgPool)
      const result = await adapter.query('SELECT * FROM empty')

      expect(result.rowCount).toBe(0)
    })

    it('should manage transactions with BEGIN, COMMIT and client release in pg', async () => {
      const mockClient = {
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        release: vi.fn(),
      } as unknown as PoolClient

      const mockPgPool = {
        connect: vi.fn().mockResolvedValue(mockClient),
      } as unknown as PgPool

      const adapter = createPgAdapter(mockPgPool)
      const trx = await adapter.beginTransaction()

      expect(mockPgPool.connect).toHaveBeenCalled()
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN')

      await trx.query('INSERT INTO logs (msg) VALUES ($1)', ['msg'])
      expect(mockClient.query).toHaveBeenCalledWith('INSERT INTO logs (msg) VALUES ($1)', ['msg'])

      await trx.commit()
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
      expect(mockClient.release).toHaveBeenCalled()
    })

    it('should manage rollback and release connection on error in pg', async () => {
      const mockClient = {
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        release: vi.fn(),
      } as unknown as PoolClient

      const mockPgPool = {
        connect: vi.fn().mockResolvedValue(mockClient),
      } as unknown as PgPool

      const adapter = createPgAdapter(mockPgPool)
      const trx = await adapter.beginTransaction()

      await trx.rollback()
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
      expect(mockClient.release).toHaveBeenCalled()
    })

    it('should default rowCount to 0 in pg transaction when rowCount is missing', async () => {
      const mockClient = {
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: null }),
        release: vi.fn(),
      } as unknown as PoolClient

      const mockPgPool = {
        connect: vi.fn().mockResolvedValue(mockClient),
      } as unknown as PgPool

      const adapter = createPgAdapter(mockPgPool)
      const trx = await adapter.beginTransaction()

      const res = await trx.query('DELETE FROM temp')
      expect(res.rowCount).toBe(0)
    })

    it('should create TenantGuard with createTenantGuardPg and use numbered params', async () => {
      const mockPgPool = {
        query: vi.fn().mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 }),
      } as unknown as PgPool

      const guard = createTenantGuardPg(mockPgPool, { defaultColumn: 'tenant_id' })

      await guard.run('tenant-123', async () => {
        await guard.query('SELECT * FROM users')
      })

      expect(mockPgPool.query).toHaveBeenCalledWith('SELECT * FROM users WHERE tenant_id = $1', ['tenant-123'])
    })
  })

  // ─── MySQL2 Adapter ──────────────────────────────────────────────

  describe('MySQL2 Adapter', () => {
    it('should execute query returning array rows via mysql2 Pool', async () => {
      const mockMysqlPool = {
        query: vi.fn().mockResolvedValue([
          [{ id: 10, name: 'Burger' }],
          [], // fields
        ]),
      } as unknown as MysqlPool

      const adapter = createMysql2Adapter(mockMysqlPool)
      const result = await adapter.query('SELECT * FROM products WHERE tenant_id = ?', ['tenant-1'])

      expect(mockMysqlPool.query).toHaveBeenCalledWith('SELECT * FROM products WHERE tenant_id = ?', ['tenant-1'])
      expect(result.rows).toEqual([{ id: 10, name: 'Burger' }])
      expect(result.rowCount).toBe(1)
    })

    it('should handle ResultSetHeader for INSERT/UPDATE/DELETE in mysql2', async () => {
      const header: ResultSetHeader = {
        fieldCount: 0,
        affectedRows: 3,
        insertId: 100,
        info: '',
        serverStatus: 2,
        warningStatus: 0,
        changedRows: 3,
      }

      const mockMysqlPool = {
        query: vi.fn().mockResolvedValue([header, undefined]),
      } as unknown as MysqlPool

      const adapter = createMysql2Adapter(mockMysqlPool)
      const result = await adapter.query('UPDATE products SET available = ? WHERE tenant_id = ?', [1, 'tenant-1'])

      expect(result.rows).toEqual([])
      expect(result.rowCount).toBe(3)
    })

    it('should default affectedRows to 0 when missing in mysql2 ResultSetHeader', async () => {
      const header = {
        fieldCount: 0,
        affectedRows: undefined,
      } as unknown as ResultSetHeader

      const mockMysqlPool = {
        query: vi.fn().mockResolvedValue([header, undefined]),
      } as unknown as MysqlPool

      const adapter = createMysql2Adapter(mockMysqlPool)
      const result = await adapter.query('DELETE FROM logs')

      expect(result.rowCount).toBe(0)
    })

    it('should manage transactions with beginTransaction, commit and connection release in mysql2', async () => {
      const mockConnection = {
        beginTransaction: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockResolvedValue([[{ id: 1 }], []]),
        commit: vi.fn().mockResolvedValue(undefined),
        rollback: vi.fn().mockResolvedValue(undefined),
        release: vi.fn(),
      } as unknown as PoolConnection

      const mockMysqlPool = {
        getConnection: vi.fn().mockResolvedValue(mockConnection),
      } as unknown as MysqlPool

      const adapter = createMysql2Adapter(mockMysqlPool)
      const trx = await adapter.beginTransaction()

      expect(mockMysqlPool.getConnection).toHaveBeenCalled()
      expect(mockConnection.beginTransaction).toHaveBeenCalled()

      const res = await trx.query('SELECT * FROM orders')
      expect(res.rows).toEqual([{ id: 1 }])

      await trx.commit()
      expect(mockConnection.commit).toHaveBeenCalled()
      expect(mockConnection.release).toHaveBeenCalled()
    })

    it('should handle ResultSetHeader in mysql2 transaction query and rollback', async () => {
      const header: ResultSetHeader = {
        fieldCount: 0,
        affectedRows: 1,
        insertId: 5,
        info: '',
        serverStatus: 2,
        warningStatus: 0,
        changedRows: 0,
      }

      const mockConnection = {
        beginTransaction: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockResolvedValue([header, undefined]),
        commit: vi.fn().mockResolvedValue(undefined),
        rollback: vi.fn().mockResolvedValue(undefined),
        release: vi.fn(),
      } as unknown as PoolConnection

      const mockMysqlPool = {
        getConnection: vi.fn().mockResolvedValue(mockConnection),
      } as unknown as MysqlPool

      const adapter = createMysql2Adapter(mockMysqlPool)
      const trx = await adapter.beginTransaction()

      const res = await trx.query('INSERT INTO orders (total) VALUES (?)', [50])
      expect(res.rowCount).toBe(1)
      expect(res.rows).toEqual([])

      await trx.rollback()
      expect(mockConnection.rollback).toHaveBeenCalled()
      expect(mockConnection.release).toHaveBeenCalled()
    })

    it('should default affectedRows to 0 in mysql2 transaction when missing', async () => {
      const header = {
        fieldCount: 0,
        affectedRows: undefined,
      } as unknown as ResultSetHeader

      const mockConnection = {
        beginTransaction: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockResolvedValue([header, undefined]),
        commit: vi.fn().mockResolvedValue(undefined),
        rollback: vi.fn().mockResolvedValue(undefined),
        release: vi.fn(),
      } as unknown as PoolConnection

      const mockMysqlPool = {
        getConnection: vi.fn().mockResolvedValue(mockConnection),
      } as unknown as MysqlPool

      const adapter = createMysql2Adapter(mockMysqlPool)
      const trx = await adapter.beginTransaction()

      const res = await trx.query('DELETE FROM logs')
      expect(res.rowCount).toBe(0)
    })

    it('should create TenantGuard with createTenantGuardMysql2 and use positional params', async () => {
      const mockMysqlPool = {
        query: vi.fn().mockResolvedValue([[{ id: 1 }], []]),
      } as unknown as MysqlPool

      const guard = createTenantGuardMysql2(mockMysqlPool, { defaultColumn: 'tenant_id' })

      await guard.run('tenant-mysql', async () => {
        await guard.query('SELECT * FROM products')
      })

      expect(mockMysqlPool.query).toHaveBeenCalledWith('SELECT * FROM products WHERE tenant_id = ?', ['tenant-mysql'])
    })
  })
})
