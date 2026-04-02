import type { TitwConfig } from '../config.js'
import { Mailbox } from '../messaging/Mailbox.js'
import { AgentMemory } from '../memory/AgentMemory.js'
import { InProcessBackend } from '../backends/InProcessBackend.js'
import type { AgentRunner, TeammateExecutor, TeammateSpawnResult } from '../backends/types.js'
import type { TeamConfig } from '../types/agent.js'
import { sanitizeName } from '../types/agent.js'
import type { TeammateMessage } from '../types/message.js'
import { AgentLoader } from './AgentLoader.js'

export interface TeamOrchestratorOptions {
  team: TeamConfig
  runner: AgentRunner
  config: TitwConfig
  cwd: string
  backend?: TeammateExecutor
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
  private _isRunning = false

  constructor(options: TeamOrchestratorOptions) {
    this.team = options.team
    this.runner = options.runner
    this.config = options.config
    this.cwd = options.cwd
    this.backend = options.backend ?? new InProcessBackend(options.config)
    this.loader = new AgentLoader(options.config)
    this.mailbox = new Mailbox({
      teamsDir: options.config.teamsDir,
      teamName: sanitizeName(options.team.name),
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
    await this.mailbox.broadcast(this.memberNames, message)
  }

  private async _spawnMember(agentConfig: TeamConfig['members'][number]): Promise<void> {
    const model = this.loader.resolveModel(agentConfig, this.team)
    const memoryInjection = agentConfig.memory
      ? await new AgentMemory({ agentType: agentConfig.name, cwd: this.cwd, memoryBaseDir: this.config.memoryBaseDir })
          .buildSystemPromptInjection(agentConfig.memory)
      : ''
    const systemPrompt = agentConfig.systemPrompt + memoryInjection

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
    })

    if (result.success) {
      this.spawned.set(result.agentId, result)
    } else {
      console.error(`[TeamOrchestrator] Failed to spawn ${agentConfig.name}: ${result.error ?? 'unknown error'}`)
    }
  }
}
