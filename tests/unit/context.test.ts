import { describe, it, expect, beforeEach } from 'vitest'
import { TenantContext } from '../../src/context.js'
import { TenantRequiredError } from '../../src/errors.js'

describe('TenantContext', () => {
  let context: TenantContext

  beforeEach(() => {
    context = new TenantContext()
  })

  describe('run()', () => {
    it('should execute function within tenant context', () => {
      const result = context.run('tenant-abc', () => {
        return context.get()
      })
      expect(result).toBe('tenant-abc')
    })

    it('should support async functions', async () => {
      const result = await context.run('tenant-xyz', async () => {
        await new Promise((r) => setTimeout(r, 10))
        return context.get()
      })
      expect(result).toBe('tenant-xyz')
    })

    it('should support nested contexts with the innermost winning', () => {
      context.run('outer', () => {
        expect(context.get()).toBe('outer')
        context.run('inner', () => {
          expect(context.get()).toBe('inner')
        })
        expect(context.get()).toBe('outer')
      })
    })

    it('should isolate concurrent async contexts', async () => {
      const results: string[] = []

      await Promise.all([
        context.run('tenant-1', async () => {
          await new Promise((r) => setTimeout(r, 20))
          results.push(context.get())
        }),
        context.run('tenant-2', async () => {
          await new Promise((r) => setTimeout(r, 10))
          results.push(context.get())
        }),
        context.run('tenant-3', async () => {
          results.push(context.get())
        }),
      ])

      expect(results).toContain('tenant-1')
      expect(results).toContain('tenant-2')
      expect(results).toContain('tenant-3')
      expect(results).toHaveLength(3)
    })
  })

  describe('get()', () => {
    it('should throw TenantRequiredError when no context is active', () => {
      expect(() => context.get()).toThrow(TenantRequiredError)
    })

    it('should return tenant ID within a context', () => {
      context.run('my-tenant', () => {
        expect(context.get()).toBe('my-tenant')
      })
    })
  })

  describe('getOptional()', () => {
    it('should return undefined when no context is active', () => {
      expect(context.getOptional()).toBeUndefined()
    })

    it('should return tenant ID within a context', () => {
      context.run('my-tenant', () => {
        expect(context.getOptional()).toBe('my-tenant')
      })
    })
  })

  describe('isActive()', () => {
    it('should return false when no context is active', () => {
      expect(context.isActive()).toBe(false)
    })

    it('should return true within a context', () => {
      context.run('my-tenant', () => {
        expect(context.isActive()).toBe(true)
      })
    })
  })
})
