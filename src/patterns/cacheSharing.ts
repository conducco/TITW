export const FORK_BOILERPLATE_MARKER = '<conducco-fork-child>'

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface CacheablePrefix {
  systemPrompt: string
  messages: ConversationMessage[]
}

/**
 * Builds a cacheable conversation prefix for fork children.
 *
 * When spawning multiple agents from the same parent conversation,
 * making the prefix byte-identical across all forks allows them to share
 * the same LLM cache entry — the cost is paid once and amortized across N agents.
 *
 * Extracted from cc_code's forkSubagent.ts cache-sharing approach.
 */
export function buildCacheablePrefix(opts: {
  systemPrompt: string
  messages: ConversationMessage[]
}): CacheablePrefix {
  return {
    systemPrompt: opts.systemPrompt,
    messages: opts.messages.map(m => ({ role: m.role, content: m.content })),
  }
}

/**
 * Returns true if the fork boilerplate marker is present in the message history.
 * Use as a guard to prevent recursive forking.
 */
export function isForkBoilerplatePresent(messages: ConversationMessage[]): boolean {
  return messages.some(m => m.content.includes(FORK_BOILERPLATE_MARKER))
}

/**
 * Injects the fork boilerplate marker into a message array.
 * Call this when constructing a fork child's messages to mark it as a fork,
 * preventing accidental recursive forking.
 */
export function injectForkBoilerplate(
  messages: ConversationMessage[],
  directive: string,
): ConversationMessage[] {
  const [first, ...rest] = messages
  if (!first) {
    return [{ role: 'user', content: `${FORK_BOILERPLATE_MARKER}\n\n${directive}` }]
  }
  return [
    { ...first, content: `${FORK_BOILERPLATE_MARKER}\n\n${directive}\n\n${first.content}` },
    ...rest,
  ]
}
