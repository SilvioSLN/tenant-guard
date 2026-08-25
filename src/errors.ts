/**
 * Custom error classes for @silviosln/tenant-guard
 *
 * All errors extend a base TenantGuardError for easy catch-all handling.
 */

/**
 * Base error class for all tenant-guard errors.
 */
export class TenantGuardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TenantGuardError'
  }
}

/**
 * Thrown when a query is attempted without a tenant in the current context
 * and no explicit bypass (unscoped) was used.
 *
 * This is a **security-critical** error — it prevents data leakage between tenants.
 */
export class TenantRequiredError extends TenantGuardError {
  constructor(sql?: string) {
    const message = sql
      ? `Tenant context is required but not set. Query attempted: "${sql.substring(0, 100)}...". Use .unscoped() for tenant-free queries.`
      : 'Tenant context is required but not set. Use .run(tenantId, fn) to set the tenant context, or .unscoped() for tenant-free queries.'
    super(message)
    this.name = 'TenantRequiredError'
  }
}

/**
 * Thrown when the SQL interceptor fails to parse or modify a query.
 */
export class QueryInterceptError extends TenantGuardError {
  /** The original SQL that failed to be intercepted. */
  public readonly originalSql: string

  constructor(message: string, originalSql: string) {
    super(`Failed to intercept query: ${message}. Original SQL: "${originalSql.substring(0, 100)}"`)
    this.name = 'QueryInterceptError'
    this.originalSql = originalSql
  }
}

/**
 * Thrown when strictMode is enabled and a complex query is intercepted.
 */
export class StrictModeError extends TenantGuardError {
  public readonly originalSql: string

  constructor(originalSql: string) {
    super(`Strict Mode is enabled. Complex queries containing JOIN, WITH, UNION, or Subqueries are blocked from automatic scoping to prevent data leaks. Use .unscoped() and apply tenant_id manually. Original SQL: "${originalSql.substring(0, 100)}"`)
    this.name = 'StrictModeError'
    this.originalSql = originalSql
  }
}
