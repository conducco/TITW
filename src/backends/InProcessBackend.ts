import { AsyncLocalStorage } from 'async_hooks'
import type { TitwConfig } from '../config.js'
import { Mailbox } from '../messaging/Mailbox.js'
import type { TeammateMessage } from '../types/message.js'
import { formatAgentId } from '../types/agent.js'
import { generateTaskId } from '../types/task.js'
import type {
  TeammateExecutor,
  TeammateSpawnConfig,
  TeammateSpawnResult,
} from './types.js'

interface TeammateContext {
  agentId: string
  agentName: string
  teamName: string
  mailbox: Mailbox
}

interface RunningTeammate {
  agentId: string
  taskId: string
  abortController: AbortController
  context: TeammateContext
}

const defaultCallMcp = async (name: string): Promise<never> => {
  throw new Error(
    `callMcpTool("${name}") was called but no mcpServers are configured for this agent. ` +
    `Add mcpServers to AgentConfig.`
  )
}

/**
 * In-process execution backend.
 *
 * Runs agent tasks as async functions in the same Node.js process.
 * Each teammate gets AsyncLocalStorage context isolation and a dedicated
 * AbortController for clean cancellation.
 *
 * Extracted from cc_code's `utils/swarm/inProcessRunner.ts`.
 */
export class InProcessBackend implements TeammateExecutor {
  readonly type = 'in-process'
  private readonly config: TitwConfig
  private readonly storage = new AsyncLocalStorage<TeammateContext>()
  private readonly running = new Map<string, RunningTeammate>()

  constructor(config: TitwConfig) {
    this.config = config
  }

  async isAvailable(): Promise<boolean> {
    return true
  }

  async spawn(spawnCfg: TeammateSpawnConfig): Promise<TeammateSpawnResult> {
    const agentId = formatAgentId(spawnCfg.agentName, spawnCfg.teamName)
    const taskId = generateTaskId('teammate')
    const abortController = new AbortController()
    const mailbox = new Mailbox({
      teamsDir: spawnCfg.titwCfg.teamsDir,
      teamName: spawnCfg.teamName,
    })

    const context: TeammateContext = {
      agentId,
      agentName: spawnCfg.agentName,
      teamName: spawnCfg.teamName,
      mailbox,
    }

    this.running.set(agentId, { agentId, taskId, abortController, context })

    void this.storage.run(context, async () => {
      try {
        await spawnCfg.runner({
          agentId,
          systemPrompt: spawnCfg.systemPrompt,
          prompt: spawnCfg.prompt,
          model: spawnCfg.model,
          maxTurns: spawnCfg.agentConfig.maxTurns ?? this.config.defaultMaxTurns,
          abortSignal: abortController.signal,
          readMailbox: async () => {
            const msgs = await mailbox.readUnread(spawnCfg.agentName)
            await mailbox.markAllRead(spawnCfg.agentName)
            return msgs
          },
          sendMessage: async (to, message) => {
            if (to !== '*') {
              await mailbox.write(to, { ...message, from: spawnCfg.agentName })
            }
          },
          mcpTools: spawnCfg.mcpTools ?? [],
          callMcpTool: spawnCfg.callMcpTool ?? defaultCallMcp,
          ...(spawnCfg.onProgress !== undefined ? { onProgress: spawnCfg.onProgress } : {}),
        })
      } catch (err: unknown) {
        if (!abortController.signal.aborted) {
          console.error(`[InProcessBackend] ${agentId} errored:`, err)
        }
      } finally {
        this.running.delete(agentId)
        spawnCfg.onIdle?.()
      }
    })

    return { success: true, agentId, taskId, abortController }
  }

  async sendMessage(agentId: string, message: Omit<TeammateMessage, 'timestamp' | 'read'>): Promise<void> {
    const teammate = this.running.get(agentId)
    if (!teammate) throw new Error(`Teammate ${agentId} not found`)
    await teammate.context.mailbox.write(teammate.context.agentName, message)
  }

  async terminate(agentId: string): Promise<boolean> {
    return this.kill(agentId)
  }

  async kill(agentId: string): Promise<boolean> {
    const teammate = this.running.get(agentId)
    if (!teammate) return false
    teammate.abortController.abort()
    this.running.delete(agentId)
    return true
  }

  async isActive(agentId: string): Promise<boolean> {
    return this.running.has(agentId)
  }

  get activeCount(): number {
    return this.running.size
  }
}
