/**
 * TenantContext — manages the current tenant using AsyncLocalStorage.
 *
 * Uses Node.js native AsyncLocalStorage (available since Node 16) to propagate
 * the tenant ID through the entire async call stack without explicit parameter passing.
 *
 * Thread-safe by design — each async context is isolated.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { TenantRequiredError } from './errors.js'

interface TenantStore {
  tenantId: string
}

export class TenantContext {
  private readonly storage = new AsyncLocalStorage<TenantStore>()

  /**
   * Execute a function within the context of a specific tenant.
   * All async operations inside `fn` will have access to the tenant ID.
   *
   * @param tenantId - The tenant identifier to set for this context
   * @param fn - The function to execute within the tenant context
   * @returns The return value of `fn`
   *
   * @example
   * ```typescript
   * await context.run('tenant-abc', async () => {
   *   const id = context.get() // 'tenant-abc'
   *   await someDbQuery()       // tenant available here too
   * })
   * ```
   */
  run<T>(tenantId: string, fn: () => T): T {
    return this.storage.run({ tenantId }, fn)
  }

  /**
   * Get the current tenant ID. Throws TenantRequiredError if no tenant is set.
   *
   * This is the **fail-safe** method — use it in code paths that MUST have a tenant.
   *
   * @throws {TenantRequiredError} if no tenant context is active
   */
  get(): string {
    const store = this.storage.getStore()
    if (!store?.tenantId) {
      throw new TenantRequiredError()
    }
    return store.tenantId
  }

  /**
   * Get the current tenant ID, or undefined if not set.
   *
   * Use this for optional tenant checks (e.g., logging, metrics).
   */
  getOptional(): string | undefined {
    return this.storage.getStore()?.tenantId
  }

  /**
   * Check if a tenant context is currently active.
   */
  isActive(): boolean {
    return this.storage.getStore()?.tenantId !== undefined
  }
}
