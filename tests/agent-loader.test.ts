import { describe, it, expect } from 'vitest'
import { AgentLoader } from '../src/orchestrator/AgentLoader.js'
import { createConfig } from '../src/config.js'
import type { TeamConfig } from '../src/types/agent.js'

const sampleTeam: TeamConfig = {
  name: 'my-team',
  leadAgentName: 'coordinator',
  defaultModel: 'claude-opus-4-6',
  members: [
    { name: 'coordinator', systemPrompt: 'You coordinate.', tools: ['*'] },
    { name: 'researcher', systemPrompt: 'You research.', model: 'claude-haiku-4-5-20251001', tools: ['WebSearch', 'Read'], memory: 'project' },
    { name: 'coder', systemPrompt: 'You write code.', permissionMode: 'plan', tools: ['Read', 'Edit', 'Write', 'Bash'], planModeRequired: true },
  ],
}

describe('AgentLoader', () => {
  const cfg = createConfig()
  const loader = new AgentLoader(cfg)

  it('validates a correct team config without throwing', () => {
    expect(() => loader.validateTeam(sampleTeam)).not.toThrow()
  })

  it('throws on invalid team config (lead not in members)', () => {
    const bad: TeamConfig = { ...sampleTeam, leadAgentName: 'nonexistent' }
    expect(() => loader.validateTeam(bad)).toThrow('leadAgentName')
  })

  it('resolves the lead agent', () => {
    const lead = loader.getLeadAgent(sampleTeam)
    expect(lead.name).toBe('coordinator')
    expect(lead.tools).toEqual(['*'])
  })

  it('resolves worker agents', () => {
    const workers = loader.getWorkers(sampleTeam)
    expect(workers).toHaveLength(2)
    expect(workers.map(w => w.name)).toEqual(['researcher', 'coder'])
  })

  it('resolves model with per-agent override', () => {
    const model = loader.resolveModel(sampleTeam.members[1]!, sampleTeam)
    expect(model).toBe('claude-haiku-4-5-20251001')
  })

  it('resolves model falling back to team default', () => {
    const model = loader.resolveModel(sampleTeam.members[2]!, sampleTeam)
    expect(model).toBe('claude-opus-4-6')
  })

  it('resolves model falling back to framework default', () => {
    const teamNoDefault: TeamConfig = { ...sampleTeam, defaultModel: undefined }
    const model = loader.resolveModel(sampleTeam.members[2]!, teamNoDefault)
    expect(model).toBe(cfg.defaultModel)
  })

  it('resolveMaxTurns falls back to config default', () => {
    const turns = loader.resolveMaxTurns({ name: 'a', systemPrompt: 'b' })
    expect(turns).toBe(cfg.defaultMaxTurns)
  })

  it('resolveMaxTurns uses agent override', () => {
    const turns = loader.resolveMaxTurns({ name: 'a', systemPrompt: 'b', maxTurns: 10 })
    expect(turns).toBe(10)
  })

  it('resolveTools returns all tools when none specified', () => {
    const tools = loader.resolveTools({ name: 'a', systemPrompt: 'b' })
    expect(tools).toEqual(['*'])
  })

  it('resolveTools filters disallowedTools', () => {
    const tools = loader.resolveTools({
      name: 'a',
      systemPrompt: 'b',
      tools: ['Read', 'Edit', 'Bash'],
      disallowedTools: ['Bash'],
    })
    expect(tools).toEqual(['Read', 'Edit'])
  })
})
