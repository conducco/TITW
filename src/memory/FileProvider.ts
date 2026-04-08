import { appendFile, mkdir } from 'fs/promises'
import { dirname } from 'path'
import type { AgentMemoryScope } from '../types/agent.js'
import type { IMemoryProvider, Triple } from '../types/provider.js'
import { AgentMemory } from './AgentMemory.js'

export interface FileProviderOptions {
  cwd: string
  memoryBaseDir: string
}

export class FileProvider implements IMemoryProvider {
  constructor(private options: FileProviderOptions) {}

  async buildSystemPromptInjection(agentType: string, scope: AgentMemoryScope): Promise<string> {
    return new AgentMemory({ agentType, cwd: this.options.cwd, memoryBaseDir: this.options.memoryBaseDir })
      .buildSystemPromptInjection(scope)
  }

  async write(agentType: string, scope: AgentMemoryScope, triples: Triple[]): Promise<void> {
    if (triples.length === 0) return
    const mem = new AgentMemory({ agentType, cwd: this.options.cwd, memoryBaseDir: this.options.memoryBaseDir })
    const filePath = mem.getMemoryPath(scope)
    const lines = triples.map(t =>
      t.weight !== undefined
        ? `- ${t.subject} ${t.predicate} ${t.object} (weight: ${t.weight})`
        : `- ${t.subject} ${t.predicate} ${t.object}`
    )
    await mkdir(dirname(filePath), { recursive: true })
    await appendFile(filePath, '\n' + lines.join('\n'), 'utf-8')
  }
}
