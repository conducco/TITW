import { homedir } from 'os'
import { join } from 'path'

/**
 * Global configuration for the TITW framework.
 *
 * All file-based persistence paths are configurable so the framework
 * can run in CI, Docker, or alongside other tools without collision.
 * Defaults place state under `.titw/` in the home directory.
 */
export interface TitwConfig {
  /**
   * Root directory for team state files.
   * Each team gets a subdirectory: `{teamsDir}/{teamName}/`
   * Default: `~/.titw/teams`
   */
  teamsDir: string

  /**
   * Root directory for agent memory files.
   * Default: `~/.titw/memory`
   */
  memoryBaseDir: string

  /**
   * Default LLM model identifier passed to the AgentRunner.
   * Default: `claude-opus-4-6`
   */
  defaultModel: string

  /**
   * Default maximum conversation turns for agents.
   * Default: 50
   */
  defaultMaxTurns: number

  /**
   * How often in-process teammates poll their mailbox (ms).
   * Default: 500ms
   */
  mailboxPollIntervalMs: number

  /**
   * Maximum messages to keep in UI transcript per teammate.
   * Default: 50
   */
  maxMessageHistory: number
}

export const DEFAULT_CONFIG: TitwConfig = {
  teamsDir: join(homedir(), '.titw', 'teams'),
  memoryBaseDir: join(homedir(), '.titw', 'memory'),
  defaultModel: 'claude-opus-4-6',
  defaultMaxTurns: 50,
  mailboxPollIntervalMs: 500,
  maxMessageHistory: 50,
}

/**
 * Creates a `TitwConfig` by merging provided overrides with defaults.
 *
 * @example
 * ```ts
 * const config = createConfig({ defaultModel: 'claude-haiku-4-5-20251001' })
 * ```
 */
export function createConfig(overrides: Partial<TitwConfig> = {}): TitwConfig {
  return { ...DEFAULT_CONFIG, ...overrides }
}
