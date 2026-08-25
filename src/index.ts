/**
 * @silviosln/tenant-guard
 *
 * Lightweight, framework-agnostic multi-tenancy library for Node.js.
 * Manages tenant context, intercepts SQL queries to inject security scopes,
 * and provides adapters for PostgreSQL and MySQL.
 *
 * @example
 * ```typescript
 * // Using with PostgreSQL
 * import { createTenantGuardPg } from '@silviosln/tenant-guard/pg'
 * import { Pool } from 'pg'
 *
 * const pool = new Pool({ connectionString: process.env.DATABASE_URL })
 * const guard = createTenantGuardPg(pool, {
 *   defaultColumn: 'tenant_id',
 *   sharedTables: ['countries', 'currencies'],
 * })
 *
 * await guard.run('tenant-abc', async () => {
 *   const users = await guard.query('SELECT * FROM users')
 *   // Executes: SELECT * FROM users WHERE tenant_id = $1
 * })
 * ```
 *
 * @packageDocumentation
 */

// Core
export { TenantContext } from './context.js'
export { createTenantGuard } from './guard.js'
export type { TenantGuard, ScopedTransaction } from './guard.js'

// Events
export { TenantGuardEmitter } from './events.js'
export type { TenantGuardEventMap } from './events.js'

// Errors
export { TenantGuardError, TenantRequiredError, QueryInterceptError } from './errors.js'

// Types
export type {
  TenantGuardConfig,
  DatabaseAdapter,
  QueryResult,
  TransactionClient,
  InterceptedQuery,
  TenantResolver,
} from './types.js'

// SQL (for advanced usage / custom adapters)
export { SqlInterceptor } from './sql/interceptor.js'
export { TableResolver } from './sql/table-resolver.js'
export { parseStatement } from './sql/parser.js'
export type { StatementType, ParsedStatement } from './sql/parser.js'

// Resolvers
export { fromHeader, fromSubdomain, fromJwt } from './resolvers/index.js'
