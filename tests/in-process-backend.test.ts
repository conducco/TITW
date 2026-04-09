import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { InProcessBackend } from '../src/backends/InProcessBackend.js'
import { createConfig } from '../src/config.js'
import type { AgentRunner, TeammateSpawnConfig } from '../src/backends/types.js'

let tempDir: string
let backend: InProcessBackend

const echoRunner: AgentRunner = async (params) => {
  await params.readMailbox()
  return { output: `Echo: ${params.prompt}`, toolUseCount: 0, tokenCount: 10, stopReason: 'complete' }
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'titw-test-'))
  backend = new InProcessBackend(createConfig({ teamsDir: join(tempDir, 'teams') }))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('InProcessBackend', () => {
  it('is always available', async () => {
    expect(await backend.isAvailable()).toBe(true)
  })

  it('spawns a teammate and returns a task ID', async () => {
    const config: TeammateSpawnConfig = {
      agentName: 'researcher',
      teamName: 'test-team',
      agentConfig: { name: 'researcher', systemPrompt: 'You research.' },
      prompt: 'Find the capital of France.',
      systemPrompt: 'You research.',
      model: 'claude-opus-4-6',
      cwd: tempDir,
      parentId: 'parent-123',
      runner: echoRunner,
      titwCfg: createConfig({ teamsDir: join(tempDir, 'teams') }),
    }
    const result = await backend.spawn(config)
    expect(result.success).toBe(true)
    expect(result.agentId).toBe('researcher@test-team')
    expect(result.taskId).toBeTruthy()
    expect(result.abortController).toBeTruthy()
  })

  it('reports as inactive after task completes (via onIdle)', async () => {
    let idleCalled = false
    const idlePromise = new Promise<void>(resolve => {
      const config: TeammateSpawnConfig = {
        agentName: 'quick',
        teamName: 'test-team',
        agentConfig: { name: 'quick', systemPrompt: 'Fast.' },
        prompt: 'Quick task.',
        systemPrompt: 'Fast.',
        model: 'claude-opus-4-6',
        cwd: tempDir,
        parentId: 'parent-123',
        runner: echoRunner,
        titwCfg: createConfig({ teamsDir: join(tempDir, 'teams') }),
        onIdle: () => {
          idleCalled = true
          resolve()
        },
      }
      void backend.spawn(config)
    })
    await idlePromise
    expect(idleCalled).toBe(true)
    expect(await backend.isActive('quick@test-team')).toBe(false)
  })

  it('can kill a running teammate', async () => {
    const config: TeammateSpawnConfig = {
      agentName: 'slow-worker',
      teamName: 'test-team',
      agentConfig: { name: 'slow-worker', systemPrompt: 'Slow.' },
      prompt: 'Slow task.',
      systemPrompt: 'Slow.',
      model: 'claude-opus-4-6',
      cwd: tempDir,
      parentId: 'parent-123',
      runner: async (params) => {
        await new Promise<void>((_, reject) => {
          params.abortSignal.addEventListener('abort', () => reject(new Error('aborted')))
          setTimeout(() => reject(new Error('timeout')), 10000)
        })
        return { output: '', toolUseCount: 0, tokenCount: 0, stopReason: 'aborted' }
      },
      titwCfg: createConfig({ teamsDir: join(tempDir, 'teams') }),
    }
    const result = await backend.spawn(config)
    expect(result.success).toBe(true)
    const killed = await backend.kill(result.agentId)
    expect(killed).toBe(true)
  })

  it('sendMessage delivers to running agent mailbox', async () => {
    let receivedMsg: string | undefined
    let resolveIdle!: () => void
    const idlePromise = new Promise<void>(resolve => { resolveIdle = resolve })

    // Runner polls until it receives a message — same pattern as a real agent.
    const listeningRunner: AgentRunner = async (params) => {
      let msgs = await params.readMailbox()
      while (msgs.length === 0) {
        await new Promise(r => setTimeout(r, 10))
        msgs = await params.readMailbox()
      }
      receivedMsg = msgs[0]?.text
      return { output: receivedMsg ?? '', toolUseCount: 0, tokenCount: 0, stopReason: 'complete' }
    }
    const config: TeammateSpawnConfig = {
      agentName: 'listener',
      teamName: 'test-team',
      agentConfig: { name: 'listener', systemPrompt: 'Listen.' },
      prompt: 'Listen for messages.',
      systemPrompt: 'Listen.',
      model: 'claude-opus-4-6',
      cwd: tempDir,
      parentId: 'parent-123',
      runner: listeningRunner,
      titwCfg: createConfig({ teamsDir: join(tempDir, 'teams') }),
      onIdle: () => resolveIdle(),
    }
    await backend.spawn(config)
    await backend.sendMessage('listener@test-team', { from: 'lead', text: 'Hello listener!' })
    await idlePromise  // wait for the runner to actually finish, not an arbitrary timeout
    expect(receivedMsg).toBe('Hello listener!')
  })

  it('sendMessage throws when agent not found', async () => {
    await expect(
      backend.sendMessage('nobody@test-team', { from: 'lead', text: 'Hello' })
    ).rejects.toThrow('Teammate nobody@test-team not found')
  })

  it('passes mcpTools and callMcpTool from SpawnConfig to runner params', async () => {
    let receivedTools: unknown[] = []
    let receivedCaller: unknown = null

    const mockCall = async (_name: string, _args: Record<string, unknown>) => ({ result: 'ok' })

    const idlePromise = new Promise<void>(resolve => {
      void backend.spawn({
        agentName: 'mcp-agent',
        teamName: 'test-team',
        agentConfig: { name: 'mcp-agent', systemPrompt: 'Test.' },
        prompt: 'Test.',
        systemPrompt: 'Test.',
        model: 'claude-opus-4-6',
        cwd: tempDir,
        parentId: 'parent',
        runner: async (params) => {
          receivedTools = params.mcpTools
          receivedCaller = params.callMcpTool
          return { output: '', toolUseCount: 0, tokenCount: 0, stopReason: 'complete' }
        },
        titwCfg: createConfig({ teamsDir: join(tempDir, 'teams') }),
        mcpTools: [{ name: 'my_tool', inputSchema: { type: 'object' } }],
        callMcpTool: mockCall,
        onIdle: resolve,
      })
    })

    await idlePromise
    expect(receivedTools).toEqual([{ name: 'my_tool', inputSchema: { type: 'object' } }])
    expect(receivedCaller).toBe(mockCall)
  })

  it('provides default empty mcpTools when not supplied', async () => {
    let receivedTools: unknown = 'not-set'

    const idlePromise = new Promise<void>(resolve => {
      void backend.spawn({
        agentName: 'no-mcp',
        teamName: 'test-team',
        agentConfig: { name: 'no-mcp', systemPrompt: 'Test.' },
        prompt: 'Test.',
        systemPrompt: 'Test.',
        model: 'claude-opus-4-6',
        cwd: tempDir,
        parentId: 'parent',
        runner: async (params) => {
          receivedTools = params.mcpTools
          return { output: '', toolUseCount: 0, tokenCount: 0, stopReason: 'complete' }
        },
        titwCfg: createConfig({ teamsDir: join(tempDir, 'teams') }),
        onIdle: resolve,
      })
    })

    await idlePromise
    expect(receivedTools).toEqual([])
  })
})
