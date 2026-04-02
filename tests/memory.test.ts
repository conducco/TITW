import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AgentMemory } from '../src/memory/AgentMemory.js'

let tempDir: string
let memory: AgentMemory

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'titw-test-'))
  memory = new AgentMemory({
    agentType: 'researcher',
    cwd: tempDir,
    memoryBaseDir: join(tempDir, 'user-memory'),
  })
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('AgentMemory', () => {
  it('returns correct user-scope path', () => {
    const path = memory.getMemoryPath('user')
    expect(path).toBe(join(tempDir, 'user-memory', 'agent-memory', 'researcher', 'MEMORY.md'))
  })

  it('returns correct project-scope path', () => {
    const path = memory.getMemoryPath('project')
    expect(path).toBe(join(tempDir, '.titw', 'agent-memory', 'researcher', 'MEMORY.md'))
  })

  it('returns correct local-scope path', () => {
    const path = memory.getMemoryPath('local')
    expect(path).toBe(join(tempDir, '.titw', 'agent-memory-local', 'researcher', 'MEMORY.md'))
  })

  it('sanitizes colons in agent type names', () => {
    const pluginMemory = new AgentMemory({
      agentType: 'my-plugin:my-agent',
      cwd: tempDir,
      memoryBaseDir: join(tempDir, 'user-memory'),
    })
    const path = pluginMemory.getMemoryPath('project')
    expect(path).not.toContain(':')
    expect(path).toContain('my-plugin-my-agent')
  })

  it('ensures memory directory exists on ensureDir', async () => {
    await memory.ensureDir('project')
    const dir = join(tempDir, '.titw', 'agent-memory', 'researcher')
    expect(existsSync(dir)).toBe(true)
  })

  it('reads empty string when memory file does not exist', async () => {
    const content = await memory.read('user')
    expect(content).toBe('')
  })

  it('writes and reads back memory content', async () => {
    await memory.write('project', '# Memory\n- Learned that X is Y')
    const content = await memory.read('project')
    expect(content).toContain('Learned that X is Y')
  })

  it('appends to existing memory', async () => {
    await memory.write('project', '# Memory\n- Fact 1')
    await memory.append('project', '\n- Fact 2')
    const content = await memory.read('project')
    expect(content).toContain('Fact 1')
    expect(content).toContain('Fact 2')
  })

  it('buildSystemPromptInjection returns empty string when no memory', async () => {
    const injection = await memory.buildSystemPromptInjection('project')
    expect(injection).toBe('')
  })

  it('buildSystemPromptInjection wraps content in XML tag', async () => {
    await memory.write('project', '# Memory\n- Fact 1')
    const injection = await memory.buildSystemPromptInjection('project')
    expect(injection).toContain('<agent-memory scope="project">')
    expect(injection).toContain('Fact 1')
    expect(injection).toContain('</agent-memory>')
  })
})
