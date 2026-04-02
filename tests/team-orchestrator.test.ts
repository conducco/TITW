import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { TeamOrchestrator } from '../src/orchestrator/TeamOrchestrator.js'
import { Mailbox } from '../src/messaging/Mailbox.js'
import { createConfig } from '../src/config.js'
import type { TeamConfig } from '../src/types/agent.js'
import type { AgentRunner } from '../src/backends/types.js'

let tempDir: string

const echoRunner: AgentRunner = async (params) => ({
  output: `echo:${params.prompt}`,
  toolUseCount: 0,
  tokenCount: 5,
  stopReason: 'complete',
})

const sampleTeam: TeamConfig = {
  name: 'test-squad',
  leadAgentName: 'lead',
  members: [
    { name: 'lead', systemPrompt: 'You lead.', tools: ['*'] },
    { name: 'worker', systemPrompt: 'You work.' },
  ],
}

beforeEach(() => { tempDir = mkdtempSync(join(tmpdir(), 'conducco-test-')) })
afterEach(() => { rmSync(tempDir, { recursive: true, force: true }) })

describe('TeamOrchestrator', () => {
  it('exposes team metadata before starting', () => {
    const cfg = createConfig({ teamsDir: join(tempDir, 'teams') })
    const orch = new TeamOrchestrator({ team: sampleTeam, runner: echoRunner, config: cfg, cwd: tempDir })
    expect(orch.teamName).toBe('test-squad')
    expect(orch.leadAgentName).toBe('lead')
    expect(orch.memberNames).toEqual(['lead', 'worker'])
    expect(orch.isRunning).toBe(false)
  })

  it('starts the team and marks as running', async () => {
    const cfg = createConfig({ teamsDir: join(tempDir, 'teams') })
    const orch = new TeamOrchestrator({ team: sampleTeam, runner: echoRunner, config: cfg, cwd: tempDir })
    await orch.start()
    expect(orch.isRunning).toBe(true)
    await orch.stop()
  })

  it('sends a message to a specific member', async () => {
    const cfg = createConfig({ teamsDir: join(tempDir, 'teams') })
    const orch = new TeamOrchestrator({ team: sampleTeam, runner: echoRunner, config: cfg, cwd: tempDir })
    await orch.start()
    await expect(orch.sendMessage('worker', { from: 'lead', text: 'Hello worker!' })).resolves.not.toThrow()
    await orch.stop()
  })

  it('stops cleanly and marks as not running', async () => {
    const cfg = createConfig({ teamsDir: join(tempDir, 'teams') })
    const orch = new TeamOrchestrator({ team: sampleTeam, runner: echoRunner, config: cfg, cwd: tempDir })
    await orch.start()
    await orch.stop()
    expect(orch.isRunning).toBe(false)
  })

  it('throws on invalid team config', async () => {
    const cfg = createConfig({ teamsDir: join(tempDir, 'teams') })
    const badTeam: TeamConfig = { ...sampleTeam, leadAgentName: 'nobody' }
    const orch = new TeamOrchestrator({ team: badTeam, runner: echoRunner, config: cfg, cwd: tempDir })
    await expect(orch.start()).rejects.toThrow('leadAgentName')
  })

  it('broadcast writes to all member inboxes', async () => {
    const cfg = createConfig({ teamsDir: join(tempDir, 'teams') })
    const orch = new TeamOrchestrator({ team: sampleTeam, runner: echoRunner, config: cfg, cwd: tempDir })
    await orch.start()
    await orch.broadcast({ from: 'system', text: 'All hands meeting', summary: 'meeting' })

    const mailbox = new Mailbox({ teamsDir: join(tempDir, 'teams'), teamName: 'test-squad' })
    for (const name of sampleTeam.members.map(m => m.name)) {
      const msgs = await mailbox.readAll(name)
      expect(msgs.some(m => m.text === 'All hands meeting')).toBe(true)
    }
    await orch.stop()
  })

  it('spawns members with memory injection when agent has memory scope', async () => {
    const teamWithMemory: TeamConfig = {
      name: 'memory-team',
      leadAgentName: 'lead',
      members: [
        { name: 'lead', systemPrompt: 'You lead.' },
        { name: 'mem-worker', systemPrompt: 'You remember.', memory: 'project' },
      ],
    }
    // Write some existing memory for the agent
    const { AgentMemory } = await import('../src/memory/AgentMemory.js')
    const mem = new AgentMemory({ agentType: 'mem-worker', cwd: tempDir, memoryBaseDir: join(tempDir, 'memory') })
    await mem.write('project', '# Memory\n- Important fact')

    let capturedSystemPrompt = ''
    const capturingRunner: typeof echoRunner = async (params) => {
      capturedSystemPrompt = params.systemPrompt
      return { output: 'done', toolUseCount: 0, tokenCount: 0, stopReason: 'complete' }
    }

    const cfg = createConfig({ teamsDir: join(tempDir, 'teams'), memoryBaseDir: join(tempDir, 'memory') })
    const orch = new TeamOrchestrator({ team: teamWithMemory, runner: capturingRunner, config: cfg, cwd: tempDir })
    await orch.start()
    // Give spawn time to set capturedSystemPrompt
    await new Promise(r => setTimeout(r, 50))
    expect(capturedSystemPrompt).toContain('Important fact')
    expect(capturedSystemPrompt).toContain('<agent-memory')
    await orch.stop()
  })
})
