import { describe, it, expect, vi } from 'vitest'
import type { ClickUpClient } from '../../../../src/mcp/clickup/client.js'
import {
  listWorkspaces,
  listSpaces,
  listFolders,
  listLists,
} from '../../../../src/mcp/clickup/tools/workspace.js'

function mockClient(result: unknown): ClickUpClient {
  return { get: vi.fn().mockResolvedValue(result) } as unknown as ClickUpClient
}

describe('workspace tools', () => {
  it('listWorkspaces calls GET /team', async () => {
    const client = mockClient({ teams: [{ id: '1', name: 'Conducco' }] })
    const result = await listWorkspaces(client)
    expect(client.get).toHaveBeenCalledWith('/team')
    expect(result).toEqual({ teams: [{ id: '1', name: 'Conducco' }] })
  })

  it('listSpaces calls GET /team/:id/space', async () => {
    const client = mockClient({ spaces: [] })
    const result = await listSpaces(client, 'team1', false)
    expect(client.get).toHaveBeenCalledWith('/team/team1/space', { archived: 'false' })
    expect(result).toEqual({ spaces: [] })
  })

  it('listFolders calls GET /space/:id/folder', async () => {
    const client = mockClient({ folders: [] })
    const result = await listFolders(client, 'space1', false)
    expect(client.get).toHaveBeenCalledWith('/space/space1/folder', { archived: 'false' })
    expect(result).toEqual({ folders: [] })
  })

  it('listLists with folder_id calls GET /folder/:id/list', async () => {
    const client = mockClient({ lists: [] })
    const result = await listLists(client, { folder_id: 'folder1', archived: false })
    expect(client.get).toHaveBeenCalledWith('/folder/folder1/list', { archived: 'false' })
    expect(result).toEqual({ lists: [] })
  })

  it('listLists with space_id calls GET /space/:id/list (folderless)', async () => {
    const client = mockClient({ lists: [] })
    const result = await listLists(client, { space_id: 'space1', archived: false })
    expect(client.get).toHaveBeenCalledWith('/space/space1/list', { archived: 'false' })
    expect(result).toEqual({ lists: [] })
  })

  it('listLists throws when neither folder_id nor space_id is provided', async () => {
    const client = mockClient({})
    await expect(listLists(client, { archived: false })).rejects.toThrow(
      'Either folder_id or space_id is required',
    )
  })
})
