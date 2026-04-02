# titw

**LLM-provider-agnostic TypeScript framework for multi-agent team orchestration.**

Build declarative agent teams with file-based messaging, 3-tier memory, and in-process isolation — wired to any LLM via a single injectable function.

---

## Features

- **Provider-agnostic** — inject Anthropic, OpenAI, or any LLM via the `AgentRunner` interface
- **Declarative teams** — define your team as a plain `TeamConfig` object with Zod validation
- **File-based mailbox** — persistent JSON inboxes per agent; survives restarts
- **3-tier memory** — `user` (~/.titw), `project` (cwd/.titw), `local` (ephemeral) scopes
- **In-process isolation** — each teammate runs in its own `AsyncLocalStorage` context
- **Permission bridging** — workers surface permission requests to the lead via `PermissionBridge`
- **Graceful shutdown** — mailbox-based request/response handshake before termination
- **Prompt cache sharing** — byte-identical prefix construction for LLM cache hits across fork children

---

## Requirements

- Node.js >= 20
- TypeScript >= 5.5 with `"module": "NodeNext"` (or equivalent ESM config)

---

## Installation

```bash
npm install titw
```

The framework has a single runtime dependency: `zod` for config validation.

---

## Quick Start

```ts
import { TeamOrchestrator, createConfig } from 'titw'
import type { AgentRunner, TeamConfig } from 'titw'

// 1. Define your team
const team: TeamConfig = {
  name: 'my-team',
  leadAgentName: 'lead',
  members: [
    {
      name: 'lead',
      systemPrompt: 'You are the team coordinator. Delegate tasks to workers.',
      tools: ['*'],
    },
    {
      name: 'worker',
      systemPrompt: 'You are a worker. Execute the tasks the lead assigns you.',
      model: 'claude-haiku-4-5-20251001',
      maxTurns: 10,
    },
  ],
}

// 2. Implement an AgentRunner with your LLM provider
const runner: AgentRunner = async (params) => {
  // Call your LLM here — params gives you systemPrompt, prompt, model,
  // readMailbox(), sendMessage(), abortSignal, and onProgress
  const messages = await params.readMailbox()
  // ... run your LLM loop ...
  return { output: '...', toolUseCount: 0, tokenCount: 0, stopReason: 'complete' }
}

// 3. Start the team
const config = createConfig()
const orch = new TeamOrchestrator({ team, runner, config, cwd: process.cwd() })
await orch.start()

// 4. Send the initial task
await orch.sendMessage('lead', { from: 'user', text: 'Research TypeScript generics.' })

// 5. Stop when done
await orch.stop()
```

---

## Core Concepts

### TeamConfig

Teams are defined declaratively as plain objects and validated at startup with Zod:

```ts
const team: TeamConfig = {
  name: 'research-team',
  leadAgentName: 'lead',           // Must match one member's name
  defaultModel: 'claude-opus-4-6',
  members: [
    {
      name: 'lead',
      systemPrompt: '...',
      tools: ['*'],
      memory: 'project',           // Persists memory across runs
    },
    {
      name: 'researcher',
      systemPrompt: '...',
      model: 'claude-haiku-4-5-20251001',   // Override per-agent
      permissionMode: 'bubble',    // Surface permission prompts to lead
      maxTurns: 15,
    },
  ],
}
```

### AgentRunner

The single seam between the framework and your LLM. Implement it once, use it for all agents:

```ts
const runner: AgentRunner = async ({
  agentId,       // e.g. "researcher@research-team"
  systemPrompt,
  prompt,
  model,
  maxTurns,
  abortSignal,
  readMailbox,   // () => Promise<TeammateMessage[]> — poll for incoming messages
  sendMessage,   // (to, msg) => Promise<void> — send to a teammate
  onProgress,    // optional progress callback
}) => {
  // Your LLM loop here
  return { output, toolUseCount, tokenCount, stopReason }
}
```

### Mailbox

File-based persistent messaging between agents. Each agent has its own inbox under `.titw/teams/<team-name>/<agent-name>/inbox.json`.

```ts
import { Mailbox } from 'titw'

const mailbox = new Mailbox({ teamsDir: config.teamsDir, teamName: 'my-team' })

// Write a message to an agent's inbox
await mailbox.write('researcher', { from: 'lead', text: 'Look into X.' })

// Read all messages (marks as read)
const messages = await mailbox.readAll('researcher')

// Read only new (unread) messages
const newMessages = await mailbox.readUnread('researcher')

// Broadcast to all known members
await mailbox.broadcast(['lead', 'researcher', 'coder'], { from: 'system', text: '...' })
```

### AgentMemory

Three-tier persistent memory injected into agent system prompts:

| Scope     | Location                        | Use case                          |
|-----------|----------------------------------|-----------------------------------|
| `user`    | `~/.titw/memory/<agent>`    | Preferences shared across projects |
| `project` | `{cwd}/.titw/agent-memory/<agent>` | Project-specific knowledge  |
| `local`   | `{cwd}/.titw/agent-memory-local/<agent>` | Ephemeral, gitignored  |

```ts
import { AgentMemory } from 'titw'

const memory = new AgentMemory({
  agentType: 'researcher',
  memoryBaseDir: config.memoryBaseDir,
  cwd: process.cwd(),
})

await memory.write('project', 'Preferred libraries: zod, vitest, tsx.')
const injection = await memory.buildSystemPromptInjection('project')
// Returns: <agent-memory>Preferred libraries: ...</agent-memory>
```

### PermissionBridge

Workers escalate permission requests to the lead agent:

```ts
import { PermissionBridge } from 'titw'

const bridge = new PermissionBridge()

// Register the lead's handler
bridge.registerLeaderHandler(async (request) => {
  // Inspect request.agentId, request.toolName, request.path
  return { approved: true }
})

// Grant a specific path for a tool
bridge.grantPath({ path: '/project/src', toolName: 'Write', addedBy: 'lead', addedAt: Date.now() })

// Check if a path is permitted
const ok = bridge.isPathPermitted('/project/src/index.ts', 'Write') // true
```

### ShutdownNegotiator

Graceful shutdown with a mailbox-based handshake:

```ts
import { ShutdownNegotiator } from 'titw'

const negotiator = new ShutdownNegotiator({ mailbox, pollIntervalMs: 200, timeoutMs: 5000 })

// Requester side (e.g., orchestrator)
const result = await negotiator.requestShutdown('worker-agent')
// { approved: true } or { approved: false, timedOut: true }

// Responder side (inside the agent loop)
await negotiator.respondToShutdown('worker-agent', { approved: true, reason: 'task complete' })
```

---

## Configuration

```ts
import { createConfig } from 'titw'

const config = createConfig({
  teamsDir: `${process.cwd()}/.titw/teams`,   // default
  memoryBaseDir: `${process.cwd()}/.titw/memory`,
  defaultModel: 'claude-opus-4-6',
  defaultMaxTurns: 50,
  mailboxPollIntervalMs: 500,
  maxMessageHistory: 100,
})
```

All fields are optional — `createConfig()` with no arguments uses sensible defaults.

---

## Project Structure

```
src/
  config.ts                  # createConfig, TitwConfig
  types/
    agent.ts                 # AgentConfig, TeamConfig + Zod schemas
    message.ts               # TeammateMessage, StructuredMessage union
    task.ts                  # TaskStatus, AgentRunResult
  messaging/
    Mailbox.ts               # File-based per-agent inbox
  memory/
    AgentMemory.ts           # 3-tier memory read/write/inject
  backends/
    types.ts                 # AgentRunner, TeammateExecutor interfaces
    InProcessBackend.ts      # AsyncLocalStorage-isolated in-process runner
  orchestrator/
    AgentLoader.ts           # Config validation, model/tool resolution
    TeamOrchestrator.ts      # Team lifecycle (start/stop/sendMessage)
    PermissionBridge.ts      # Worker → lead permission escalation
  patterns/
    cacheSharing.ts          # Prompt cache prefix utilities
    shutdown.ts              # Graceful shutdown negotiation
  index.ts                   # Public API
```

---

## Examples

See [`examples/three-agent-team.ts`](./examples/three-agent-team.ts) for a complete Lead + Researcher + Coder team wired to the Anthropic SDK.

For a step-by-step walkthrough, see the **[Tutorial](./docs/tutorial.md)**.

---

## License

[MIT](./LICENSE) — Copyright (c) 2026 Conducco
