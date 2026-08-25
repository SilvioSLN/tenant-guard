import { describe, it, expect, vi } from 'vitest'
import { SqlInterceptor } from '../../src/sql/interceptor.js'
import { TableResolver } from '../../src/sql/table-resolver.js'
import { TenantContext } from '../../src/context.js'
import { createTenantGuard } from '../../src/guard.js'
import type { DatabaseAdapter } from '../../src/types.js'

describe('SQL Security & Concurrency Edge Cases', () => {
  const tableResolver = new TableResolver({
    defaultColumn: 'tenant_id',
    overrides: { 'public.pedidos': 'loja_id', pedidos: 'loja_id' },
    sharedTables: ['planos', 'public.estabelecimentos', 'estabelecimentos'],
  })

  const interceptorNumbered = new SqlInterceptor({
    tableResolver,
    paramStyle: 'numbered',
  })

  const interceptorPositional = new SqlInterceptor({
    tableResolver,
    paramStyle: 'positional',
  })

  describe('Boolean Logic Precedence & SQL Injection Safety', () => {
    it('should parenthesize existing WHERE to prevent OR clause privilege escalation in SELECT', () => {
      const sql = "SELECT * FROM pedidos WHERE status = $1 OR status = 'vip'"
      const result = interceptorNumbered.intercept(sql, ['aberto'], 'loja-1')

      // Must be WHERE (status = $1 OR status = 'vip') AND loja_id = $2
      expect(result.sql).toBe("SELECT * FROM pedidos WHERE (status = $1 OR status = 'vip') AND loja_id = $2")
      expect(result.params).toEqual(['aberto', 'loja-1'])
    })

    it('should parenthesize existing WHERE with multiple logical operators in UPDATE', () => {
      const sql = 'UPDATE usuarios SET ativo = false WHERE role = $1 OR role = $2'
      const result = interceptorNumbered.intercept(sql, ['editor', 'guest'], 'tenant-10')

      expect(result.sql).toBe('UPDATE usuarios SET ativo = false WHERE (role = $1 OR role = $2) AND tenant_id = $3')
      expect(result.params).toEqual(['editor', 'guest', 'tenant-10'])
    })

    it('should parenthesize existing WHERE in DELETE queries with subconditions', () => {
      const sql = 'DELETE FROM logs WHERE nivel = ? OR (msg LIKE ? AND arquivado = ?)'
      const result = interceptorPositional.intercept(sql, ['DEBUG', '%test%', 1], 'tenant-99')

      expect(result.sql).toBe('DELETE FROM logs WHERE (nivel = ? OR (msg LIKE ? AND arquivado = ?)) AND tenant_id = ?')
      expect(result.params).toEqual(['DEBUG', '%test%', 1, 'tenant-99'])
    })
  })

  describe('Schema Qualifications & Shared Tables Handling', () => {
    it('should recognize schema-prefixed table in shared tables list', () => {
      const result = interceptorNumbered.intercept('SELECT * FROM public.estabelecimentos', [], 'tenant-1')
      expect(result.sql).toBe('SELECT * FROM public.estabelecimentos')
      expect(result.params).toEqual([])
    })

    it('should apply column override even when query uses schema prefix', () => {
      const result = interceptorNumbered.intercept('SELECT * FROM public.pedidos', [], 'tenant-1')
      expect(result.sql).toBe('SELECT * FROM public.pedidos WHERE loja_id = $1')
      expect(result.params).toEqual(['tenant-1'])
    })
  })

  describe('High Concurrency & Multi-Tenant Context Isolation', () => {
    it('should never leak tenant context across 500 concurrent asynchronous requests', async () => {
      const context = new TenantContext()
      const totalRequests = 500

      const promises = Array.from({ length: totalRequests }, async (_, i) => {
        const tenantId = `tenant-${i}`
        const delay = Math.floor(Math.random() * 20) + 1

        return context.run(tenantId, async () => {
          await new Promise((r) => setTimeout(r, delay))
          const current = context.get()
          expect(current).toBe(tenantId)
          return current
        })
      })

      const results = await Promise.all(promises)
      expect(results).toHaveLength(totalRequests)
      for (let i = 0; i < totalRequests; i++) {
        expect(results[i]).toBe(`tenant-${i}`)
      }
    })
  })

  describe('Guard Transaction Rollback on Error', () => {
    it('should automatically rollback transaction when user callback throws', async () => {
      const rollbackSpy = vi.fn()
      const commitSpy = vi.fn()

      const mockAdapter: DatabaseAdapter = {
        async query() {
          return { rows: [], rowCount: 0 }
        },
        async beginTransaction() {
          return {
            async query() {
              return { rows: [], rowCount: 0 }
            },
            async commit() {
              commitSpy()
            },
            async rollback() {
              rollbackSpy()
            },
          }
        },
      }

      const guard = createTenantGuard(mockAdapter)

      await expect(
        guard.run('tenant-err', async () => {
          await guard.transaction(async (trx) => {
            await trx.query('INSERT INTO audit (action) VALUES ($1)', ['save'])
            throw new Error('Database deadlock simulation')
          })
        }),
      ).rejects.toThrow('Database deadlock simulation')

      expect(rollbackSpy).toHaveBeenCalledTimes(1)
      expect(commitSpy).not.toHaveBeenCalled()
    })
  })
})
