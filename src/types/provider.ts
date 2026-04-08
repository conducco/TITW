import type { AgentMemoryScope } from './agent.js'

export interface Triple {
  subject: string
  predicate: string
  object: string
  weight?: number
}

export interface IMemoryProvider {
  buildSystemPromptInjection(agentType: string, scope: AgentMemoryScope): Promise<string>
  write(agentType: string, scope: AgentMemoryScope, triples: Triple[]): Promise<void>
  connect?(): Promise<void>
  disconnect?(): Promise<void>
}
