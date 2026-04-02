import { mkdir, readFile, writeFile, appendFile } from 'fs/promises'
import { join } from 'path'
import type { AgentMemoryScope } from '../types/agent.js'

export interface AgentMemoryOptions {
  agentType: string
  cwd: string
  memoryBaseDir: string
}

/**
 * 3-tier persistent memory for agents.
 *
 * Scopes:
 * - user:    {memoryBaseDir}/agent-memory/{type}/MEMORY.md
 * - project: {cwd}/.conducco/agent-memory/{type}/MEMORY.md      (VCS-tracked)
 * - local:   {cwd}/.conducco/agent-memory-local/{type}/MEMORY.md (not VCS-tracked)
 *
 * Extracted from cc_code's `tools/AgentTool/agentMemory.ts`.
 */
export class AgentMemory {
  private readonly agentType: string
  private readonly cwd: string
  private readonly memoryBaseDir: string

  constructor(options: AgentMemoryOptions) {
    this.agentType = options.agentType.replace(/:/g, '-')
    this.cwd = options.cwd
    this.memoryBaseDir = options.memoryBaseDir
  }

  getMemoryDir(scope: AgentMemoryScope): string {
    switch (scope) {
      case 'user':
        return join(this.memoryBaseDir, 'agent-memory', this.agentType)
      case 'project':
        return join(this.cwd, '.conducco', 'agent-memory', this.agentType)
      case 'local':
        return join(this.cwd, '.conducco', 'agent-memory-local', this.agentType)
    }
  }

  getMemoryPath(scope: AgentMemoryScope): string {
    return join(this.getMemoryDir(scope), 'MEMORY.md')
  }

  async ensureDir(scope: AgentMemoryScope): Promise<void> {
    await mkdir(this.getMemoryDir(scope), { recursive: true })
  }

  async read(scope: AgentMemoryScope): Promise<string> {
    try {
      return await readFile(this.getMemoryPath(scope), 'utf-8')
    } catch (err: unknown) {
      if (isEnoent(err)) return ''
      throw err
    }
  }

  async write(scope: AgentMemoryScope, content: string): Promise<void> {
    await this.ensureDir(scope)
    await writeFile(this.getMemoryPath(scope), content, 'utf-8')
  }

  async append(scope: AgentMemoryScope, content: string): Promise<void> {
    await this.ensureDir(scope)
    await appendFile(this.getMemoryPath(scope), content, 'utf-8')
  }

  async buildSystemPromptInjection(scope: AgentMemoryScope): Promise<string> {
    const content = await this.read(scope)
    if (!content.trim()) return ''
    return [
      `\n\n<agent-memory scope="${scope}">`,
      'The following is your persistent memory from previous sessions:',
      content.trim(),
      '</agent-memory>',
    ].join('\n')
  }
}

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT'
}
