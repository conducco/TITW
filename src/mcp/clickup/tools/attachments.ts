import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ClickUpClient } from '../client.js'

export async function createAttachment(
  client: ClickUpClient,
  task_id: string,
  filename: string,
  contentBase64: string,
  contentType: string,
): Promise<unknown> {
  const bytes = Buffer.from(contentBase64, 'base64')
  const blob = new Blob([bytes], { type: contentType })
  const formData = new FormData()
  formData.append('attachment', blob, filename)
  return client.postFormData(`/task/${task_id}/attachment`, formData)
}

function text(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

export function registerAttachmentTools(server: McpServer, client: ClickUpClient): void {
  server.registerTool('create_attachment', {
    description: 'Attach a file to a ClickUp task. The file content must be base64-encoded.',
    inputSchema: z.object({
      task_id: z.string().describe('Task ID to attach the file to'),
      filename: z.string().describe('Filename including extension (e.g. "report.pdf")'),
      content: z.string().describe('Base64-encoded file content'),
      content_type: z.string().describe('MIME type (e.g. "application/pdf", "image/png")'),
    }),
  }, async ({ task_id, filename, content, content_type }) =>
    text(await createAttachment(client, task_id, filename, content, content_type)))
}
