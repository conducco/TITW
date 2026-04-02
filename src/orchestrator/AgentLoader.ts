import type { TitwConfig } from '../config.js'
import type { AgentConfig, TeamConfig } from '../types/agent.js'
import { teamConfigSchema } from '../types/agent.js'

/**
 * Loads, validates, and resolves agent configurations.
 * Pure utility — no side effects, no spawning.
 * Extracted from cc_code's `tools/AgentTool/loadAgentsDir.ts`.
 */
export class AgentLoader {
  private readonly config: TitwConfig

  constructor(config: TitwConfig) {
    this.config = config
  }

  validateTeam(team: TeamConfig): void {
    const result = teamConfigSchema.safeParse(team)
    if (!result.success) {
      const issues = result.error.issues.map(i => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
      throw new Error(`Invalid team configuration for "${team.name}":\n${issues}`)
    }
  }

  getLeadAgent(team: TeamConfig): AgentConfig {
    const lead = team.members.find(m => m.name === team.leadAgentName)
    if (!lead) throw new Error(`Lead agent "${team.leadAgentName}" not found in team "${team.name}"`)
    return lead
  }

  getWorkers(team: TeamConfig): AgentConfig[] {
    return team.members.filter(m => m.name !== team.leadAgentName)
  }

  /** Precedence: agent.model > team.defaultModel > config.defaultModel */
  resolveModel(agent: AgentConfig, team: TeamConfig): string {
    if (agent.model && agent.model !== 'inherit') return agent.model
    return team.defaultModel ?? this.config.defaultModel
  }

  resolveMaxTurns(agent: AgentConfig): number {
    return agent.maxTurns ?? this.config.defaultMaxTurns
  }

  resolveTools(agent: AgentConfig): string[] {
    const tools = agent.tools && agent.tools.length > 0 ? agent.tools : ['*']
    const denied = new Set(agent.disallowedTools ?? [])
    return tools.filter(t => !denied.has(t))
  }
}
