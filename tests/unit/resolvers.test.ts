import { describe, it, expect } from 'vitest'
import { fromHeader, fromSubdomain, fromJwt } from '../../src/resolvers/index.js'

describe('Tenant Resolvers', () => {
  describe('fromHeader()', () => {
    it('should resolve tenant from default header (x-tenant-id)', () => {
      const resolver = fromHeader()
      const tenantId = resolver({ headers: { 'x-tenant-id': 'abc-123' } })
      expect(tenantId).toBe('abc-123')
    })

    it('should resolve tenant from custom header', () => {
      const resolver = fromHeader('X-Organization-ID')
      const tenantId = resolver({ headers: { 'x-organization-id': 'org-456' } })
      expect(tenantId).toBe('org-456')
    })

    it('should return undefined when header is missing', () => {
      const resolver = fromHeader()
      const tenantId = resolver({ headers: {} })
      expect(tenantId).toBeUndefined()
    })

    it('should return undefined when no headers object', () => {
      const resolver = fromHeader()
      const tenantId = resolver({})
      expect(tenantId).toBeUndefined()
    })

    it('should handle array header values (return first)', () => {
      const resolver = fromHeader()
      const tenantId = resolver({ headers: { 'x-tenant-id': ['first', 'second'] as unknown as string } })
      expect(tenantId).toBe('first')
    })
  })

  describe('fromSubdomain()', () => {
    it('should resolve first subdomain by default', () => {
      const resolver = fromSubdomain()
      const tenantId = resolver({ hostname: 'acme.app.example.com' })
      expect(tenantId).toBe('acme')
    })

    it('should resolve subdomain at specific position', () => {
      const resolver = fromSubdomain(1)
      const tenantId = resolver({ hostname: 'acme.app.example.com' })
      expect(tenantId).toBe('app')
    })

    it('should return undefined when hostname is missing', () => {
      const resolver = fromSubdomain()
      const tenantId = resolver({})
      expect(tenantId).toBeUndefined()
    })

    it('should return undefined when not enough subdomain parts', () => {
      const resolver = fromSubdomain()
      // Only "example.com" — no subdomain
      const tenantId = resolver({ hostname: 'example.com' })
      expect(tenantId).toBeUndefined()
    })

    it('should work with standard 3-part hostname', () => {
      const resolver = fromSubdomain()
      const tenantId = resolver({ hostname: 'tenant1.example.com' })
      expect(tenantId).toBe('tenant1')
    })
  })

  describe('fromJwt()', () => {
    function createJwt(payload: Record<string, unknown>): string {
      const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url')
      const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
      return `${header}.${body}.fake-signature`
    }

    it('should resolve tenant from default claim (tenant_id)', () => {
      const resolver = fromJwt()
      const token = createJwt({ tenant_id: 'abc-123', sub: 'user-1' })
      const tenantId = resolver({ headers: { authorization: `Bearer ${token}` } })
      expect(tenantId).toBe('abc-123')
    })

    it('should resolve tenant from custom claim path', () => {
      const resolver = fromJwt('org_id')
      const token = createJwt({ org_id: 'org-456', sub: 'user-1' })
      const tenantId = resolver({ headers: { authorization: `Bearer ${token}` } })
      expect(tenantId).toBe('org-456')
    })

    it('should resolve tenant from nested claim path', () => {
      const resolver = fromJwt('app_metadata.org_id')
      const token = createJwt({ app_metadata: { org_id: 'nested-789' } })
      const tenantId = resolver({ headers: { authorization: `Bearer ${token}` } })
      expect(tenantId).toBe('nested-789')
    })

    it('should return undefined when Authorization header is missing', () => {
      const resolver = fromJwt()
      const tenantId = resolver({ headers: {} })
      expect(tenantId).toBeUndefined()
    })

    it('should return undefined when token is malformed', () => {
      const resolver = fromJwt()
      const tenantId = resolver({ headers: { authorization: 'Bearer invalid-token' } })
      expect(tenantId).toBeUndefined()
    })

    it('should return undefined when claim does not exist', () => {
      const resolver = fromJwt('nonexistent')
      const token = createJwt({ tenant_id: 'abc' })
      const tenantId = resolver({ headers: { authorization: `Bearer ${token}` } })
      expect(tenantId).toBeUndefined()
    })

    it('should convert numeric claims to string', () => {
      const resolver = fromJwt('tenant_id')
      const token = createJwt({ tenant_id: 42 })
      const tenantId = resolver({ headers: { authorization: `Bearer ${token}` } })
      expect(tenantId).toBe('42')
    })

    it('should handle token without Bearer prefix', () => {
      const resolver = fromJwt()
      const token = createJwt({ tenant_id: 'abc-123' })
      const tenantId = resolver({ headers: { authorization: token } })
      expect(tenantId).toBe('abc-123')
    })

    it('should return undefined when JWT payload is not valid JSON (trigger catch)', () => {
      const resolver = fromJwt()
      const corruptedPayloadToken = 'eyJhbGciOiJIUzI1NiJ9.bm90LWpzb24tc3RyaW5n.fake-sig'
      const tenantId = resolver({ headers: { authorization: `Bearer ${corruptedPayloadToken}` } })
      expect(tenantId).toBeUndefined()
    })

    it('should return undefined when JWT token has fewer than 3 parts', () => {
      const resolver = fromJwt()
      const shortToken = 'part1.part2'
      const tenantId = resolver({ headers: { authorization: `Bearer ${shortToken}` } })
      expect(tenantId).toBeUndefined()
    })

    it('should return undefined when nested path encounters null or primitive midway', () => {
      const resolver = fromJwt('org.id.sub')
      const token = createJwt({ org: 'string-not-object' })
      const tenantId = resolver({ headers: { authorization: `Bearer ${token}` } })
      expect(tenantId).toBeUndefined()
    })

    it('should return undefined when Authorization header is not a string or req has no headers', () => {
      const resolver = fromJwt()
      expect(resolver({})).toBeUndefined()
      expect(resolver({ headers: { authorization: ['array'] as unknown as string } })).toBeUndefined()
    })
  })
})
