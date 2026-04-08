import { mkdir, readFile, writeFile, unlink } from 'fs/promises'
import { join } from 'path'
import type { TeammateMessage } from '../types/message.js'

export interface MailboxOptions {
  teamsDir: string
  teamName: string
  observerAgent?: string
}

export type IncomingMessage = Omit<TeammateMessage, 'timestamp' | 'read'>

/**
 * File-based mailbox for inter-agent communication.
 *
 * Each agent has an inbox at: `{teamsDir}/{teamName}/inboxes/{agentName}.json`
 *
 * Messages persist across process restarts. The `read` flag lets agents
 * track which messages have been processed. Extracted from cc_code's
 * `utils/teammateMailbox.ts` pattern.
 */
export class Mailbox {
  private readonly teamsDir: string
  private readonly teamName: string
  private readonly observerAgent: string | undefined

  constructor(options: MailboxOptions) {
    this.teamsDir = options.teamsDir
    this.teamName = options.teamName
    this.observerAgent = options.observerAgent
  }

  getInboxPath(agentName: string): string {
    return join(this.teamsDir, this.teamName, 'inboxes', `${agentName}.json`)
  }

  private async ensureInboxDir(): Promise<void> {
    await mkdir(join(this.teamsDir, this.teamName, 'inboxes'), { recursive: true })
  }

  async readAll(agentName: string): Promise<TeammateMessage[]> {
    const path = this.getInboxPath(agentName)
    try {
      const content = await readFile(path, 'utf-8')
      return JSON.parse(content) as TeammateMessage[]
    } catch (err: unknown) {
      if (isEnoent(err)) return []
      throw err
    }
  }

  async readUnread(agentName: string): Promise<TeammateMessage[]> {
    return (await this.readAll(agentName)).filter(m => !m.read)
  }

  async write(agentName: string, message: IncomingMessage): Promise<void> {
    await this.ensureInboxDir()
    await this._writeToInbox(agentName, message)
    if (this.observerAgent && agentName !== this.observerAgent) {
      await this._writeToInbox(this.observerAgent, message)
    }
  }

  private async _writeToInbox(agentName: string, message: IncomingMessage): Promise<void> {
    const path = this.getInboxPath(agentName)
    const all = await this.readAll(agentName)
    all.push({ ...message, timestamp: new Date().toISOString(), read: false })
    await writeFile(path, JSON.stringify(all, null, 2), 'utf-8')
  }

  async markAllRead(agentName: string): Promise<void> {
    const all = await this.readAll(agentName)
    if (all.length === 0) return
    await writeFile(this.getInboxPath(agentName), JSON.stringify(all.map(m => ({ ...m, read: true })), null, 2), 'utf-8')
  }

  async broadcast(recipients: string[], message: IncomingMessage): Promise<void> {
    await Promise.all(recipients.map(name => this.write(name, message)))
  }

  async clear(agentName: string): Promise<void> {
    try {
      await unlink(this.getInboxPath(agentName))
    } catch (err: unknown) {
      if (!isEnoent(err)) throw err
    }
  }
}

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT'
}
