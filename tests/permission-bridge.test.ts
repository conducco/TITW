import { describe, it, expect, vi } from 'vitest'
import { PermissionBridge } from '../src/orchestrator/PermissionBridge.js'

describe('PermissionBridge', () => {
  it('starts with no registered handler', () => {
    expect(new PermissionBridge().hasLeaderHandler).toBe(false)
  })

  it('registers and calls a leader approval handler', async () => {
    const bridge = new PermissionBridge()
    const handler = vi.fn().mockResolvedValue({ approved: true })
    bridge.registerLeaderHandler(handler)
    expect(bridge.hasLeaderHandler).toBe(true)
    const result = await bridge.requestApproval({ requestId: 'r1', tool: 'Edit', input: {} })
    expect(result.approved).toBe(true)
    expect(handler).toHaveBeenCalledOnce()
  })

  it('auto-denies when no handler is registered', async () => {
    const result = await new PermissionBridge().requestApproval({ requestId: 'r2', tool: 'Edit', input: {} })
    expect(result.approved).toBe(false)
    expect(result.reason).toContain('no handler')
  })

  it('unregisters a handler', () => {
    const bridge = new PermissionBridge()
    bridge.registerLeaderHandler(vi.fn())
    bridge.unregisterLeaderHandler()
    expect(bridge.hasLeaderHandler).toBe(false)
  })

  it('grants path permissions', () => {
    const bridge = new PermissionBridge()
    bridge.grantPath({ path: '/workspace', toolName: 'Edit', grantedBy: 'leader' })
    bridge.grantPath({ path: '/workspace', toolName: 'Write', grantedBy: 'leader' })
    expect(bridge.getAllowedPaths()).toHaveLength(2)
  })

  it('checks path permissions correctly', () => {
    const bridge = new PermissionBridge()
    bridge.grantPath({ path: '/workspace', toolName: 'Edit', grantedBy: 'leader' })
    expect(bridge.isPathPermitted('/workspace/src/foo.ts', 'Edit')).toBe(true)
    expect(bridge.isPathPermitted('/workspace/src/foo.ts', 'Write')).toBe(false)
    expect(bridge.isPathPermitted('/other/path', 'Edit')).toBe(false)
  })

  it('grantPath is idempotent (overwrites existing grant for same path+tool)', () => {
    const bridge = new PermissionBridge()
    bridge.grantPath({ path: '/workspace', toolName: 'Edit', grantedBy: 'leader' })
    bridge.grantPath({ path: '/workspace', toolName: 'Edit', grantedBy: 'leader' })
    expect(bridge.getAllowedPaths()).toHaveLength(1)
  })
})
