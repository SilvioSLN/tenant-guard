/**
 * Typed event emitter for tenant-guard observability.
 *
 * Emits events for query interception, tenant lifecycle, and errors.
 * Uses Node.js native EventEmitter with type-safe event signatures.
 */

import { EventEmitter } from 'node:events'

/**
 * Event map for all tenant-guard events.
 */
export interface TenantGuardEventMap {
  /** Fired when a query is successfully scoped to a tenant. */
  'query:scoped': {
    sql: string
    originalSql: string
    tenantId: string
    table: string | null
  }

  /** Fired when a query explicitly bypasses tenant scoping via unscoped(). */
  'query:bypassed': {
    sql: string
    reason: 'unscoped' | 'shared_table'
  }

  /** Fired when a query targets a shared table (no scoping applied). */
  'query:shared': {
    sql: string
    table: string
  }

  /** Fired when a tenant context is set via run(). */
  'tenant:set': {
    tenantId: string
  }

  /** Fired when a query is attempted without a tenant context (before the error is thrown). */
  'tenant:missing': {
    sql: string
  }

  /** Fired on any error within the tenant guard. */
  'error': {
    error: Error
    sql?: string
  }
}

/**
 * Type-safe event emitter for tenant guard.
 *
 * @example
 * ```typescript
 * const emitter = new TenantGuardEmitter()
 *
 * emitter.on('query:scoped', ({ sql, tenantId }) => {
 *   logger.info(`[tenant:${tenantId}] ${sql}`)
 * })
 *
 * emitter.on('tenant:missing', ({ sql }) => {
 *   alerting.warn(`Query without tenant: ${sql}`)
 * })
 * ```
 */
export class TenantGuardEmitter {
  private readonly emitter = new EventEmitter()

  constructor() {
    // Prevent unhandled error events from crashing the process
    this.emitter.on('error', () => {})
  }

  /**
   * Subscribe to an event.
   */
  on<K extends keyof TenantGuardEventMap>(
    event: K,
    listener: (payload: TenantGuardEventMap[K]) => void,
  ): this {
    this.emitter.on(event, listener as (...args: unknown[]) => void)
    return this
  }

  /**
   * Subscribe to an event for a single emission.
   */
  once<K extends keyof TenantGuardEventMap>(
    event: K,
    listener: (payload: TenantGuardEventMap[K]) => void,
  ): this {
    this.emitter.once(event, listener as (...args: unknown[]) => void)
    return this
  }

  /**
   * Unsubscribe from an event.
   */
  off<K extends keyof TenantGuardEventMap>(
    event: K,
    listener: (payload: TenantGuardEventMap[K]) => void,
  ): this {
    this.emitter.off(event, listener as (...args: unknown[]) => void)
    return this
  }

  /**
   * Emit an event with a typed payload.
   */
  emit<K extends keyof TenantGuardEventMap>(
    event: K,
    payload: TenantGuardEventMap[K],
  ): boolean {
    return this.emitter.emit(event, payload)
  }

  /**
   * Remove all listeners for a specific event, or all events if no event is specified.
   */
  removeAllListeners(event?: keyof TenantGuardEventMap): this {
    if (event) {
      this.emitter.removeAllListeners(event)
    } else {
      this.emitter.removeAllListeners()
      this.emitter.on('error', () => {})
    }
    return this
  }
}
