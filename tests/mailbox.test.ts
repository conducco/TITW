import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Mailbox } from '../src/messaging/Mailbox.js'

let tempDir: string
let mailbox: Mailbox

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'conducco-test-'))
  mailbox = new Mailbox({ teamsDir: tempDir, teamName: 'test-team' })
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('Mailbox', () => {
  it('returns empty array for nonexistent inbox', async () => {
    const msgs = await mailbox.readAll('nobody')
    expect(msgs).toEqual([])
  })

  it('writes and reads a message', async () => {
    await mailbox.write('alice', {
      from: 'bob',
      text: 'Hello Alice!',
      summary: 'greeting',
    })
    const msgs = await mailbox.readAll('alice')
    expect(msgs).toHaveLength(1)
    expect(msgs[0]?.text).toBe('Hello Alice!')
    expect(msgs[0]?.from).toBe('bob')
    expect(msgs[0]?.read).toBe(false)
    expect(msgs[0]?.timestamp).toBeTruthy()
  })

  it('reads only unread messages', async () => {
    await mailbox.write('alice', { from: 'bob', text: 'First' })
    await mailbox.write('alice', { from: 'carol', text: 'Second' })
    await mailbox.markAllRead('alice')
    await mailbox.write('alice', { from: 'dave', text: 'Third' })

    const unread = await mailbox.readUnread('alice')
    expect(unread).toHaveLength(1)
    expect(unread[0]?.text).toBe('Third')
  })

  it('marks all messages as read', async () => {
    await mailbox.write('alice', { from: 'bob', text: 'Msg 1' })
    await mailbox.write('alice', { from: 'carol', text: 'Msg 2' })
    await mailbox.markAllRead('alice')
    const unread = await mailbox.readUnread('alice')
    expect(unread).toHaveLength(0)
  })

  it('broadcasts to multiple recipients', async () => {
    await mailbox.broadcast(['alice', 'bob', 'carol'], {
      from: 'leader',
      text: 'Team meeting at 9am',
    })
    for (const name of ['alice', 'bob', 'carol']) {
      const msgs = await mailbox.readAll(name)
      expect(msgs).toHaveLength(1)
      expect(msgs[0]?.from).toBe('leader')
    }
  })

  it('clears an inbox', async () => {
    await mailbox.write('alice', { from: 'bob', text: 'Hello' })
    await mailbox.clear('alice')
    const msgs = await mailbox.readAll('alice')
    expect(msgs).toEqual([])
  })
})
