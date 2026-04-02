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
  tempDir = mkdtempSync(join(tmpdir(), 'conducco-test-'))
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
      conductoCfg: createConfig({ teamsDir: join(tempDir, 'teams') }),
    }
    const result = await backend.spawn(config)
    expect(result.success).toBe(true)
    expect(result.agentId).toBe('researcher@test-team')
    expect(result.taskId).toBeTruthy()
    expect(result.abortController).toBeTruthy()
  })

  it('reports as inactive after quick task completes', async () => {
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
      conductoCfg: createConfig({ teamsDir: join(tempDir, 'teams') }),
    }
    await backend.spawn(config)
    // Give the echo runner time to complete
    await new Promise(r => setTimeout(r, 100))
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
      conductoCfg: createConfig({ teamsDir: join(tempDir, 'teams') }),
    }
    const result = await backend.spawn(config)
    expect(result.success).toBe(true)
    const killed = await backend.kill(result.agentId)
    expect(killed).toBe(true)
  })
})
