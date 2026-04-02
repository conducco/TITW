import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { TeamOrchestrator } from '../src/orchestrator/TeamOrchestrator.js'
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
})
