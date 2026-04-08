import type { TitwConfig } from '../config.js'
import { Mailbox } from '../messaging/Mailbox.js'
import { AgentMemory } from '../memory/AgentMemory.js'
import { InProcessBackend } from '../backends/InProcessBackend.js'
import type { AgentRunner, TeammateExecutor, TeammateSpawnResult } from '../backends/types.js'
import type { TeamConfig } from '../types/agent.js'
import { sanitizeName } from '../types/agent.js'
import type { TeammateMessage } from '../types/message.js'
import { AgentLoader } from './AgentLoader.js'
import { SkillRegistry } from '../skills/SkillRegistry.js'
import { MCPToolkit } from '../backends/MCPToolkit.js'
import type { IMemoryProvider, Triple } from '../types/provider.js'

export interface TeamOrchestratorOptions {
  team: TeamConfig
  runner: AgentRunner
  config: TitwConfig
  cwd: string
  backend?: TeammateExecutor
  memoryProvider?: IMemoryProvider
}

/**
 * Orchestrates a team of agents: spawning members, wiring inboxes,
 * and managing the team lifecycle.
 *
 * Extracted from cc_code's TeamCreateTool + inProcessRunner patterns.
 */
export class TeamOrchestrator {
  private readonly team: TeamConfig
  private readonly runner: AgentRunner
  private readonly config: TitwConfig
  private readonly cwd: string
  private readonly backend: TeammateExecutor
  private readonly loader: AgentLoader
  private readonly mailbox: Mailbox
  private readonly spawned = new Map<string, TeammateSpawnResult>()
  private readonly memoryProvider: IMemoryProvider | undefined
  private _isRunning = false

  constructor(options: TeamOrchestratorOptions) {
    this.team = options.team
    this.runner = options.runner
    this.config = options.config
    this.cwd = options.cwd
    this.backend = options.backend ?? new InProcessBackend(options.config)
    this.loader = new AgentLoader(options.config)
    this.memoryProvider = options.memoryProvider
    this.mailbox = new Mailbox({
      teamsDir: options.config.teamsDir,
      teamName: sanitizeName(options.team.name),
      ...(options.team.observerAgent !== undefined ? { observerAgent: options.team.observerAgent } : {}),
    })
  }

  get teamName(): string { return this.team.name }
  get leadAgentName(): string { return this.team.leadAgentName }
  get memberNames(): string[] { return this.team.members.map(m => m.name) }
  get isRunning(): boolean { return this._isRunning }
  get activeMemberCount(): number { return this.spawned.size }

  async start(): Promise<void> {
    this.loader.validateTeam(this.team)
    await Promise.all(this.team.members.map(agent => this._spawnMember(agent)))
    this._isRunning = true
  }

  async stop(): Promise<void> {
    await Promise.all(Array.from(this.spawned.keys()).map(id => this.backend.kill(id)))
    this.spawned.clear()
    this._isRunning = false
  }

  async sendMessage(toAgentName: string, message: Omit<TeammateMessage, 'timestamp' | 'read'>): Promise<void> {
    await this.mailbox.write(toAgentName, message)
  }

  async broadcast(message: Omit<TeammateMessage, 'timestamp' | 'read'>): Promise<void> {
    // Exclude the observer from direct recipients — it receives CCs via Mailbox.write()
    const recipients = this.team.observerAgent
      ? this.memberNames.filter(n => n !== this.team.observerAgent)
      : this.memberNames
    await this.mailbox.broadcast(recipients, message)
  }

  private async _spawnMember(agentConfig: TeamConfig['members'][number]): Promise<void> {
    const model = this.loader.resolveModel(agentConfig, this.team)

    // Memory injection: use provider if set, else fall back to AgentMemory
    let memoryInjection = ''
    if (agentConfig.memory) {
      if (this.memoryProvider) {
        memoryInjection = await this.memoryProvider.buildSystemPromptInjection(agentConfig.name, agentConfig.memory)
      } else {
        memoryInjection = await new AgentMemory({
          agentType: agentConfig.name,
          cwd: this.cwd,
          memoryBaseDir: this.config.memoryBaseDir,
        }).buildSystemPromptInjection(agentConfig.memory)
      }
    }

    const skillInjection = agentConfig.skills?.length
      ? await SkillRegistry.load(agentConfig.skills, this.cwd)
      : ''

    const toolkit = await MCPToolkit.connect(agentConfig.mcpServers ?? [])

    const systemPrompt = agentConfig.systemPrompt + skillInjection + memoryInjection

    // writeMemory: only wired for the observer agent when a provider is set
    const isObserver = agentConfig.name === this.team.observerAgent
    const writeMemory: ((triples: Triple[]) => Promise<void>) | undefined =
      isObserver && this.memoryProvider
        ? (triples) => this.memoryProvider!.write(agentConfig.name, agentConfig.memory ?? 'project', triples)
        : undefined

    const result = await this.backend.spawn({
      agentName: agentConfig.name,
      teamName: sanitizeName(this.team.name),
      agentConfig,
      prompt: '',
      systemPrompt,
      model,
      cwd: this.cwd,
      parentId: `team-${sanitizeName(this.team.name)}`,
      runner: this.runner,
      titwCfg: this.config,
      mcpTools: toolkit.tools,
      callMcpTool: (name, args) => toolkit.call(name, args),
      ...(writeMemory !== undefined ? { writeMemory } : {}),
      onIdle: () => {
        void toolkit.disconnect()
      },
    })

    if (result.success) {
      this.spawned.set(result.agentId, result)
    } else {
      console.error(`[TeamOrchestrator] Failed to spawn ${agentConfig.name}: ${result.error ?? 'unknown error'}`)
    }
  }
}
