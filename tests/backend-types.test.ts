import { describe, it, expect } from 'vitest'
import { isTerminalStatus } from '../src/types/task.js'
import type { AgentRunner, AgentRunParams } from '../src/backends/types.js'

describe('AgentRunner interface contract', () => {
  it('accepts a valid AgentRunner implementation', () => {
    const runner: AgentRunner = async (_params: AgentRunParams) => ({
      output: 'done',
      toolUseCount: 0,
      tokenCount: 42,
      stopReason: 'complete',
    })
    expect(typeof runner).toBe('function')
  })

  it('terminal status checks work', () => {
    expect(isTerminalStatus('completed')).toBe(true)
    expect(isTerminalStatus('running')).toBe(false)
  })
})
