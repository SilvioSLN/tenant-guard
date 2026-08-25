# @silviosln/tenant-guard

> Lightweight, framework-agnostic multi-tenancy library for Node.js. Manages tenant context via `AsyncLocalStorage`, intercepts SQL queries to inject security scopes, and automates tenant isolation — without rewriting your codebase.

[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/typescript-%3E%3D5-blue)](https://www.typescriptlang.org)
[![Coverage](https://img.shields.io/badge/coverage-97.7%25-brightgreen)](https://vitest.dev)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

## Features

- 🔒 **Fail-safe security** — queries without tenant context are blocked by default (`TenantRequiredError`)
- 🛡️ **Safe Boolean Logic** — wraps existing `WHERE` conditions in parentheses `(where) AND tenant_id = ?`, preventing `OR` precedence vulnerabilities
- 🔄 **Legacy SQL Compatibility** — automatically detects if `tenant_id` is already present in `INSERT` statements to prevent duplicate column errors (`Column 'tenant_id' specified twice`)
- 🪶 **Zero external dependencies** — only uses Node.js built-in modules (`node:async_hooks`, `node:events`)
- 🔌 **Framework-agnostic** — works with Express, Fastify, Koa, Hono, raw HTTP, or standalone worker scripts
- 🗄️ **Multi-database** — official adapters for PostgreSQL (`pg`) and MySQL / TiDB (`mysql2`)
- 📦 **Batch Inserts** — supports multi-row `INSERT INTO ... VALUES (...), (...)` automatically
- 🧵 **AsyncLocalStorage** — automatic tenant propagation through the entire async call stack
- 🔄 **Scoped Transactions** — `guard.transaction(async (trx) => ...)` with automatic commit, rollback, and connection cleanup
- 📡 **Event-based observability** — subscribe to query scoping, bypass, and error events
- ⚙️ **Flexible configuration** — per-table column overrides, shared tables, schema prefixes, custom resolvers
- 📦 **Dual format** — ships as ESM + CommonJS with full TypeScript declarations

## Installation

```bash
npm install @silviosln/tenant-guard
```

Install the database driver you need (peer dependency):

```bash
# PostgreSQL
npm install pg

# MySQL / TiDB
npm install mysql2
```

## Quick Start

### PostgreSQL (`pg`)

```typescript
import { createTenantGuardPg } from '@silviosln/tenant-guard/pg'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const guard = createTenantGuardPg(pool, {
  defaultColumn: 'tenant_id',
  sharedTables: ['countries', 'currencies', 'system_plans'],
  columnOverrides: { orders: 'company_id' },
})

// In your HTTP middleware (Express, Fastify, etc.)
app.use(async (req, res, next) => {
  const tenantId = req.headers['x-tenant-id'] as string

  await guard.run(tenantId, async () => {
    // 1. SELECT query with existing WHERE — parenthesized safely
    const users = await guard.query('SELECT * FROM users WHERE active = $1', [true])
    // → SELECT * FROM users WHERE (active = $1) AND tenant_id = $2

    // 2. INSERT query — automatically injects tenant_id (or company_id for orders)
    await guard.query('INSERT INTO orders (product, amount) VALUES ($1, $2)', ['Widget', 100])
    // → INSERT INTO orders (product, amount, company_id) VALUES ($1, $2, $3)

    // 3. Scoped transaction — committed on return, rolled back on error
    await guard.transaction(async (trx) => {
      await trx.query('INSERT INTO orders (product, amount) VALUES ($1, $2)', ['Gadget', 200])
      await trx.query('UPDATE inventory SET stock = stock - 1 WHERE id = $1', [42])
    })

    // 4. Admin query — explicitly unscoped
    const plans = await guard.unscoped('SELECT * FROM system_plans')
    // → SELECT * FROM system_plans (no tenant filter)

    next()
  })
})
```

### MySQL / TiDB (`mysql2`)

```typescript
import { createTenantGuardMysql2 } from '@silviosln/tenant-guard/mysql2'
import mysql from 'mysql2/promise'

const pool = mysql.createPool({
  host: 'localhost',
  port: 3306, // or 4000 for TiDB
  user: 'root',
  database: 'mydb',
})

const guard = createTenantGuardMysql2(pool, {
  defaultColumn: 'tenant_id',
})

await guard.run('tenant-abc', async () => {
  const users = await guard.query('SELECT * FROM users WHERE active = ?', [true])
  // → SELECT * FROM users WHERE (active = ?) AND tenant_id = ?
})
```

## Legacy Code & Smart Detection

In legacy applications, developers may have already written queries that manually include `tenant_id`:

```typescript
// Legacy query containing explicit tenant_id:
await guard.query(
  'INSERT INTO products (name, tenant_id, price) VALUES (?, ?, ?)',
  ['Pizza', 'old-or-null-tenant', 45.00]
)
// ✅ Executes cleanly: INSERT INTO products (name, tenant_id, price) VALUES (?, ?, ?)
// 🔒 Overwrites parameter with active context tenantId for anti-spoofing security
```

`TenantGuard` detects that the column is already present, avoids duplicate column insertion, and safely replaces the tenant parameter with the verified context value.

## API Reference

### `createTenantGuardPg(pool, config?)`

Creates a TenantGuard instance for PostgreSQL using `$1, $2` parameter placeholders.

### `createTenantGuardMysql2(pool, config?)`

Creates a TenantGuard instance for MySQL / TiDB using `?` parameter placeholders.

### `createTenantGuard(adapter, config?)`

Low-level factory for custom database drivers.

### Config Options

```typescript
interface TenantGuardConfig {
  /** Default column name used to identify the tenant. Defaults to 'tenant_id'. */
  defaultColumn?: string

  /** Override the tenant column name for specific tables. */
  columnOverrides?: Record<string, string> // e.g. { orders: 'company_id' }

  /** Tables shared across all tenants that should never be scoped. */
  sharedTables?: string[] // e.g. ['countries', 'currencies', 'system_plans']

  /** Parameter style: 'numbered' ($1) or 'positional' (?). */
  paramStyle?: 'positional' | 'numbered'
}
```

### TenantGuard Instance Methods

| Method | Description |
|---|---|
| `guard.query(sql, params?)` | Execute a query with automatic tenant scoping. Throws if no tenant context is active. |
| `guard.unscoped(sql, params?)` | Execute a query WITHOUT tenant scoping (explicit admin bypass). |
| `guard.run(tenantId, fn)` | Execute an async function within the context of a tenant. |
| `guard.transaction(fn)` | Execute an async function within a scoped database transaction. |
| `guard.context` | Access the `TenantContext` instance (`get()`, `getOptional()`, `isActive()`). |
| `guard.events` | Access the `TenantGuardEmitter` instance. |

### Observability & Events

```typescript
guard.events.on('query:scoped', ({ sql, originalSql, tenantId, table }) => {
  logger.debug(`[Tenant: ${tenantId}] Scoped query: ${sql}`)
})

guard.events.on('query:bypassed', ({ sql, reason }) => {
  logger.warn(`Unscoped query executed: ${sql} (${reason})`)
})

guard.events.on('query:shared', ({ sql, table }) => {
  logger.debug(`Shared table query: ${table}`)
})

guard.events.on('tenant:set', ({ tenantId }) => {
  logger.info(`Tenant context set: ${tenantId}`)
})

guard.events.on('tenant:missing', ({ sql }) => {
  logger.error(`Query attempted without tenant context: ${sql}`)
})

guard.events.on('error', ({ error, sql }) => {
  logger.error(`TenantGuard error: ${error.message}`, { sql })
})
```

### Tenant Resolvers (HTTP Helpers)

Framework-agnostic helpers to extract tenant IDs from incoming requests:

```typescript
import { fromHeader, fromSubdomain, fromJwt } from '@silviosln/tenant-guard'

// 1. From request header (default: 'x-tenant-id')
const resolveHeader = fromHeader('X-Tenant-ID')
const tenantId = resolveHeader(req)

// 2. From subdomain (e.g. acme.app.com → 'acme')
const resolveSubdomain = fromSubdomain(0)
const tenantId = resolveSubdomain(req)

// 3. From JWT payload (reads without signature verification)
const resolveJwt = fromJwt('app_metadata.tenant_id')
const tenantId = resolveJwt(req)
```

## Best Practices & Complex Queries

`TenantGuard` uses a lightweight, regex-based SQL parser to achieve zero dependencies and high performance. This is perfect for 80% of use cases (standard CRUD operations). However, for complex analytical queries, you must use the right tools to avoid SQL errors or data leaks.

### When to use `guard.query()` (Automatic Scoping)
Use automatic scoping for standard queries where the target table is clear:
- Simple `SELECT`, `INSERT`, `UPDATE`, `DELETE`
- Queries targeting a single primary table without complex sub-structures.

### When to use `guard.unscoped()` (Manual Scoping)
For complex SQL, the regex engine may fail to inject the tenant condition safely. You **must** use `.unscoped()` and pass the `tenant_id` manually in these scenarios:

1. **Complex JOINs (Ambiguity Risk)**
   If multiple tables in a `JOIN` contain a `tenant_id` column, automatic injection will cause an `ambiguous column reference` database error because it doesn't know which table alias to use.
   ```typescript
   // ❌ BAD (Ambiguous column error)
   await guard.query('SELECT * FROM users u JOIN orders o ON u.id = o.user_id')

   // ✅ GOOD (Manual aliasing with unscoped)
   const tenantId = guard.context.get().tenantId
   await guard.unscoped(
     'SELECT * FROM users u JOIN orders o ON u.id = o.user_id WHERE u.tenant_id = ?',
     [tenantId]
   )
   ```

2. **CTEs (Common Table Expressions / `WITH`) and Subqueries**
   The parser does not analyze inner queries.
   ```typescript
   // ✅ GOOD (Manual scoping inside the CTE)
   const tenantId = guard.context.get().tenantId
   await guard.unscoped(
     'WITH active_users AS (SELECT * FROM users WHERE tenant_id = $1) SELECT * FROM active_users',
     [tenantId]
   )
   ```

3. **Upserts (`ON CONFLICT` / `ON DUPLICATE KEY UPDATE`)**
   Automatic scoping does not currently apply to the `UPDATE` segment of an upsert statement.

## Security Guarantees


1. **Fail-safe by default**: If no tenant context is active, `guard.query()` throws `TenantRequiredError`.
2. **Precedence Protection**: All existing WHERE clauses are enclosed in parentheses `(WHERE_BODY) AND tenant_id = ?` to avoid operator precedence flaws with `OR`.
3. **Anti-Spoofing on Inserts**: If legacy code passes a manual `tenant_id` parameter, `TenantGuard` enforces the value from the verified active session.
4. **Isolated Call Stacks**: Built with Node.js native `AsyncLocalStorage`, ensuring concurrent HTTP requests never cross-contaminate tenant context.

## Custom Adapters

You can implement `DatabaseAdapter` for any custom ORM, client, or database driver:

```typescript
import { createTenantGuard, type DatabaseAdapter } from '@silviosln/tenant-guard'

const myAdapter: DatabaseAdapter = {
  async query(sql, params) {
    const res = await myClient.raw(sql, params)
    return { rows: res.rows, rowCount: res.rowCount }
  },
  async beginTransaction() {
    const trx = await myClient.beginTransaction()
    return {
      async query(sql, params) {
        const res = await trx.raw(sql, params)
        return { rows: res.rows, rowCount: res.rowCount }
      },
      async commit() { await trx.commit() },
      async rollback() { await trx.rollback() },
    }
  },
}

const guard = createTenantGuard(myAdapter, {
  paramStyle: 'numbered',
  defaultColumn: 'tenant_id',
})
```

## License

MIT © [silviosln](https://github.com/silviosln)
