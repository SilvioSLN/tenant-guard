import { describe, it, expect, vi } from 'vitest'
import { TenantGuardEmitter } from '../../src/events.js'

describe('TenantGuardEmitter', () => {
  it('should register and trigger listeners with on()', () => {
    const emitter = new TenantGuardEmitter()
    const listener = vi.fn()

    emitter.on('tenant:set', listener)
    emitter.emit('tenant:set', { tenantId: 'tenant-1' })
    emitter.emit('tenant:set', { tenantId: 'tenant-2' })

    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener).toHaveBeenNthCalledWith(1, { tenantId: 'tenant-1' })
    expect(listener).toHaveBeenNthCalledWith(2, { tenantId: 'tenant-2' })
  })

  it('should trigger listeners only once with once()', () => {
    const emitter = new TenantGuardEmitter()
    const listener = vi.fn()

    emitter.once('tenant:set', listener)
    emitter.emit('tenant:set', { tenantId: 'tenant-1' })
    emitter.emit('tenant:set', { tenantId: 'tenant-2' })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({ tenantId: 'tenant-1' })
  })

  it('should unsubscribe listeners with off()', () => {
    const emitter = new TenantGuardEmitter()
    const listener = vi.fn()

    emitter.on('tenant:set', listener)
    emitter.emit('tenant:set', { tenantId: 'tenant-1' })

    emitter.off('tenant:set', listener)
    emitter.emit('tenant:set', { tenantId: 'tenant-2' })

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('should remove all listeners with removeAllListeners()', () => {
    const emitter = new TenantGuardEmitter()
    const listener1 = vi.fn()
    const listener2 = vi.fn()

    emitter.on('tenant:set', listener1)
    emitter.on('query:bypassed', listener2)

    emitter.removeAllListeners('tenant:set')
    emitter.emit('tenant:set', { tenantId: 'tenant-1' })
    emitter.emit('query:bypassed', { sql: 'SELECT 1', reason: 'unscoped' })

    expect(listener1).not.toHaveBeenCalled()
    expect(listener2).toHaveBeenCalledTimes(1)

    emitter.removeAllListeners()
    emitter.emit('query:bypassed', { sql: 'SELECT 1', reason: 'unscoped' })
    expect(listener2).toHaveBeenCalledTimes(1)
  })

  it('should not throw unhandled error event', () => {
    const emitter = new TenantGuardEmitter()
    expect(() => {
      emitter.emit('error', { error: new Error('test error') })
    }).not.toThrow()
  })
})
