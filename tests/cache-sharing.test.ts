import { describe, it, expect } from 'vitest'
import {
  buildCacheablePrefix,
  isForkBoilerplatePresent,
  injectForkBoilerplate,
  FORK_BOILERPLATE_MARKER,
} from '../src/patterns/cacheSharing.js'

describe('buildCacheablePrefix', () => {
  it('builds a prefix with system prompt and messages', () => {
    const prefix = buildCacheablePrefix({
      systemPrompt: 'You are a researcher.',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hello! How can I help?' },
      ],
    })
    expect(prefix.systemPrompt).toBe('You are a researcher.')
    expect(prefix.messages).toHaveLength(2)
  })

  it('returns a deep clone (mutations do not affect the original)', () => {
    const opts = {
      systemPrompt: 'System.',
      messages: [{ role: 'user' as const, content: 'Prompt.' }],
    }
    const result = buildCacheablePrefix(opts)
    result.messages[0]!.content = 'MUTATED'
    expect(opts.messages[0]!.content).toBe('Prompt.')
  })

  it('produces identical output for identical inputs (cache key stability)', () => {
    const opts = {
      systemPrompt: 'System.',
      messages: [{ role: 'user' as const, content: 'Prompt.' }],
    }
    const a = JSON.stringify(buildCacheablePrefix(opts))
    const b = JSON.stringify(buildCacheablePrefix(opts))
    expect(a).toBe(b)
  })
})

describe('isForkBoilerplatePresent', () => {
  it('returns false for normal messages', () => {
    const msgs = [{ role: 'user' as const, content: 'Hello' }]
    expect(isForkBoilerplatePresent(msgs)).toBe(false)
  })

  it('returns true when marker is present', () => {
    const msgs = [{ role: 'user' as const, content: `${FORK_BOILERPLATE_MARKER} Do something` }]
    expect(isForkBoilerplatePresent(msgs)).toBe(true)
  })
})

describe('injectForkBoilerplate', () => {
  it('prepends marker to first user message', () => {
    const msgs = [{ role: 'user' as const, content: 'Original' }]
    const result = injectForkBoilerplate(msgs, 'Do X instead')
    expect(result[0]!.content).toContain(FORK_BOILERPLATE_MARKER)
    expect(result[0]!.content).toContain('Do X instead')
    expect(result[0]!.content).toContain('Original')
  })

  it('creates a new user message when messages is empty', () => {
    const result = injectForkBoilerplate([], 'directive')
    expect(result).toHaveLength(1)
    expect(result[0]!.role).toBe('user')
    expect(result[0]!.content).toContain('directive')
  })
})
