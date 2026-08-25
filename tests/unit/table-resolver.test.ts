import { describe, it, expect } from 'vitest'
import { TableResolver } from '../../src/sql/table-resolver.js'

describe('TableResolver', () => {
  describe('getColumn()', () => {
    it('should return default column for unknown tables', () => {
      const resolver = new TableResolver({ defaultColumn: 'tenant_id' })
      expect(resolver.getColumn('users')).toBe('tenant_id')
      expect(resolver.getColumn('orders')).toBe('tenant_id')
    })

    it('should return overridden column for configured tables', () => {
      const resolver = new TableResolver({
        defaultColumn: 'tenant_id',
        overrides: { orders: 'company_id', invoices: 'org_id' },
      })
      expect(resolver.getColumn('orders')).toBe('company_id')
      expect(resolver.getColumn('invoices')).toBe('org_id')
      expect(resolver.getColumn('users')).toBe('tenant_id')
    })

    it('should return null for shared tables', () => {
      const resolver = new TableResolver({
        defaultColumn: 'tenant_id',
        sharedTables: ['countries', 'currencies'],
      })
      expect(resolver.getColumn('countries')).toBeNull()
      expect(resolver.getColumn('currencies')).toBeNull()
      expect(resolver.getColumn('users')).toBe('tenant_id')
    })

    it('should be case-insensitive for table names', () => {
      const resolver = new TableResolver({
        defaultColumn: 'tenant_id',
        overrides: { Orders: 'company_id' },
        sharedTables: ['Countries'],
      })
      expect(resolver.getColumn('orders')).toBe('company_id')
      expect(resolver.getColumn('ORDERS')).toBe('company_id')
      expect(resolver.getColumn('countries')).toBeNull()
      expect(resolver.getColumn('COUNTRIES')).toBeNull()
    })
  })

  describe('isShared()', () => {
    it('should return true for shared tables', () => {
      const resolver = new TableResolver({
        defaultColumn: 'tenant_id',
        sharedTables: ['countries'],
      })
      expect(resolver.isShared('countries')).toBe(true)
    })

    it('should return false for non-shared tables', () => {
      const resolver = new TableResolver({
        defaultColumn: 'tenant_id',
        sharedTables: ['countries'],
      })
      expect(resolver.isShared('users')).toBe(false)
    })

    it('should be case-insensitive', () => {
      const resolver = new TableResolver({
        defaultColumn: 'tenant_id',
        sharedTables: ['Countries'],
      })
      expect(resolver.isShared('countries')).toBe(true)
      expect(resolver.isShared('COUNTRIES')).toBe(true)
    })
  })
})
