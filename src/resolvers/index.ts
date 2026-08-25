/**
 * Tenant resolvers — optional helpers to extract tenant ID from HTTP requests.
 *
 * These are framework-agnostic: they accept a minimal request-like object
 * and return the tenant ID string or undefined.
 *
 * @example
 * ```typescript
 * import { fromHeader, fromSubdomain, fromJwt } from '@silviosln/tenant-guard'
 *
 * // In your middleware:
 * const resolver = fromHeader('X-Tenant-ID')
 * const tenantId = resolver(req)
 * ```
 */

import type { TenantResolver } from '../types.js'

/**
 * Resolve tenant ID from a request header.
 *
 * @param headerName - The header name to read. Defaults to 'x-tenant-id'.
 *                     Automatically lowercased for case-insensitive matching.
 */
export function fromHeader(headerName: string = 'x-tenant-id'): TenantResolver {
  const normalizedName = headerName.toLowerCase()

  return (req) => {
    if (!req.headers) return undefined

    const value = req.headers[normalizedName]
    if (Array.isArray(value)) return value[0]
    return value ?? undefined
  }
}

/**
 * Resolve tenant ID from the hostname subdomain.
 *
 * @param position - The subdomain position (0-indexed from left). Defaults to 0.
 *
 * @example
 * ```typescript
 * // hostname: "acme.app.example.com"
 * fromSubdomain(0) // returns "acme"
 * fromSubdomain(1) // returns "app"
 * ```
 */
export function fromSubdomain(position: number = 0): TenantResolver {
  return (req) => {
    if (!req.hostname) return undefined

    const parts = req.hostname.split('.')
    // Need at least position + 3 parts (subdomain(s) + domain + tld)
    // e.g., "tenant.example.com" = 3 parts, position 0 → need 3
    if (parts.length < position + 3) return undefined

    return parts[position]
  }
}

/**
 * Resolve tenant ID from a JWT token in the Authorization header.
 *
 * **IMPORTANT**: This performs ONLY base64 decoding of the JWT payload.
 * It does NOT verify the JWT signature. Your application should verify
 * the JWT before this resolver runs (e.g., via an auth middleware).
 *
 * @param claimPath - Dot-separated path to the tenant claim in the JWT payload.
 *                    Defaults to 'tenant_id'.
 *
 * @example
 * ```typescript
 * // JWT payload: { "tenant_id": "abc-123", "sub": "user-1" }
 * fromJwt('tenant_id')  // returns "abc-123"
 *
 * // Nested: { "app_metadata": { "org_id": "xyz" } }
 * fromJwt('app_metadata.org_id')  // returns "xyz"
 * ```
 */
export function fromJwt(claimPath: string = 'tenant_id'): TenantResolver {
  const pathParts = claimPath.split('.')

  return (req) => {
    if (!req.headers) return undefined

    const authHeader = req.headers['authorization'] ?? req.headers['Authorization']
    if (!authHeader || typeof authHeader !== 'string') return undefined

    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader

    try {
      // Decode the JWT payload (second segment)
      const segments = token.split('.')
      if (segments.length < 3) return undefined

      const payload = JSON.parse(
        Buffer.from(segments[1]!, 'base64url').toString('utf-8'),
      )

      // Navigate the dot-separated path
      let value: unknown = payload
      for (const part of pathParts) {
        if (value === null || value === undefined || typeof value !== 'object') return undefined
        value = (value as Record<string, unknown>)[part]
      }

      return typeof value === 'string' ? value : value !== undefined ? String(value) : undefined
    } catch {
      return undefined
    }
  }
}
