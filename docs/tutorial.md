# titw Tutorial

Build a multi-agent research team from scratch — step by step.

By the end you'll have a working team with a **Lead**, a **Researcher**, and a **Writer** agent, wired to the Anthropic SDK, with persistent memory and graceful shutdown.

---

## Prerequisites

- Node.js >= 20
- TypeScript >= 5.5
- An Anthropic API key (`ANTHROPIC_API_KEY` env var)

---

## Step 1 — Create a project

```bash
mkdir agent-tutorial && cd agent-tutorial
npm init -y
npm install titw @anthropic-ai/sdk
npm install -D typescript tsx @types/node
```

Add a `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
```

> **Why NodeNext?** It enforces ESM discipline. Imports need `.js` extensions (even for `.ts` source files). `titw` ships as ESM.

---

## Step 2 — Understand the AgentRunner interface

`titw` never calls an LLM directly. You provide an `AgentRunner` — a single async function — and the framework calls it for every agent in your team.

```ts
import type { AgentRunner } from 'titw'

const runner: AgentRunner = async (params) => {
  // params.agentId        — "researcher@my-team"
  // params.systemPrompt   — injected system prompt (with memory if configured)
  // params.prompt         — the initial task message
  // params.model          — resolved model string
  // params.maxTurns       — iteration cap
  // params.abortSignal    — fires when stop() is called
  // params.readMailbox()  — returns unread messages from other agents
  // params.sendMessage()  — sends a message to another agent's mailbox
  // params.onProgress?()  — optional progress callback

  return {
    output: 'Done.',
    toolUseCount: 0,
    tokenCount: 0,
    stopReason: 'complete',
  }
}
```

This is the only place your LLM SDK appears. One runner, all agents.

---

## Step 3 — Implement the runner with Anthropic

Create `src/runner.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk'
import type { AgentRunner } from 'titw'

const client = new Anthropic()

export const runner: AgentRunner = async (params) => {
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: params.prompt },
  ]

  let tokenCount = 0
  let lastOutput = ''
  let turns = 0

  while (turns < params.maxTurns && !params.abortSignal.aborted) {
    turns++

    // Check mailbox and inject messages as additional user turns
    const inbox = await params.readMailbox()
    for (const msg of inbox) {
      messages.push({ role: 'user', content: `[From ${msg.from}]: ${msg.text}` })
    }

    const response = await client.messages.create({
      model: params.model,
      max_tokens: 4096,
      system: params.systemPrompt,
      messages,
    })

    tokenCount += response.usage.input_tokens + response.usage.output_tokens

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('\n')

    messages.push({ role: 'assistant', content: text })
    lastOutput = text

    params.onProgress?.({ toolUseCount: 0, tokenCount, lastActivity: `Turn ${turns}` })

    // Check if the agent wants to send a message
    // (In production you'd parse tool_use blocks here)
    const sendMatch = text.match(/SEND TO (\w+): (.+)/s)
    if (sendMatch) {
      const [, to, content] = sendMatch
      if (to && content) {
        await params.sendMessage(to, { from: params.agentId, text: content.trim() })
      }
    }

    if (response.stop_reason === 'end_turn') break
  }

  return {
    output: lastOutput,
    toolUseCount: 0,
    tokenCount,
    stopReason: params.abortSignal.aborted ? 'aborted' : 'complete',
  }
}
```

> **Note:** Real production runners parse `tool_use` blocks and execute tools. This simplified version uses a text convention (`SEND TO <agent>: <message>`) so the tutorial stays focused on orchestration.

---

## Step 4 — Define the team

Create `src/team.ts`:

```ts
import type { TeamConfig } from 'titw'

export const team: TeamConfig = {
  name: 'research-team',
  description: 'Researches a topic and produces a written summary',
  leadAgentName: 'lead',
  defaultModel: 'claude-opus-4-6',

  members: [
    {
      name: 'lead',
      systemPrompt: `You are the team lead for a research operation.

Your job:
1. Break the incoming task into subtasks
2. Delegate research to the 'researcher' agent using: SEND TO researcher: <task>
3. Delegate writing to the 'writer' agent using: SEND TO writer: <findings>
4. Collect results and report back to the user

Do NOT do research or writing yourself.`,
      tools: ['*'],
      memory: 'project',     // Lead persists knowledge across runs
    },

    {
      name: 'researcher',
      systemPrompt: `You are a research specialist.

Receive tasks from the lead. Research thoroughly and report back:
SEND TO lead: <your findings>

Be concise — the writer will expand on your notes.`,
      model: 'claude-haiku-4-5-20251001',  // Faster, cheaper for research
      permissionMode: 'bubble',             // Permission prompts bubble up to lead
      maxTurns: 20,
    },

    {
      name: 'writer',
      systemPrompt: `You are a technical writer.

Receive research findings from the lead and write a polished summary.
Send the completed draft back:
SEND TO lead: <your draft>

Write in clear, concise prose. Avoid bullet-point overload.`,
      model: 'claude-haiku-4-5-20251001',
      maxTurns: 10,
    },
  ],
}
```

### Key things to notice

- `leadAgentName: 'lead'` must exactly match one member's `name`
- Each member gets its own `model`, `maxTurns`, and `permissionMode`
- `memory: 'project'` on the lead means it accumulates knowledge in `{cwd}/.titw/agent-memory/lead/`

---

## Step 5 — Wire it together

Create `src/main.ts`:

```ts
import { TeamOrchestrator, createConfig, Mailbox } from 'titw'
import { team } from './team.js'
import { runner } from './runner.js'

async function main() {
  // Config — all paths default to {cwd}/.titw/
  const config = createConfig()

  // Create the orchestrator
  const orch = new TeamOrchestrator({ team, runner, config, cwd: process.cwd() })

  // Start spawns all team members and opens their mailboxes
  await orch.start()
  console.log(`Team "${orch.teamName}" started`)
  console.log(`Members: ${orch.memberNames.join(', ')}`)
  console.log(`Lead: ${orch.leadAgentName}\n`)

  // Send the initial task to the lead
  const task = `
Research the history and key concepts of the Actor Model in distributed systems.
Produce a concise summary (500–800 words) covering:
- Origins and key contributors
- Core concepts (actors, messages, isolation)
- Modern implementations (Erlang/OTP, Akka, Orleans)
`

  console.log('Sending task to lead...')
  await orch.sendMessage('lead', {
    from: 'user',
    text: task,
    summary: 'research Actor Model',
  })

  // Give the team time to work
  // In production, you'd poll the lead's mailbox or use a completion signal
  await new Promise(resolve => setTimeout(resolve, 60_000))

  // Read what the lead produced
  const mailbox = new Mailbox({ teamsDir: config.teamsDir, teamName: team.name })
  const leadInbox = await mailbox.readAll('lead')

  if (leadInbox.length > 0) {
    console.log('\n=== Lead received ===')
    for (const msg of leadInbox) {
      console.log(`\n[From ${msg.from}]`)
      console.log(msg.text)
    }
  }

  // Graceful shutdown
  await orch.stop()
  console.log('\nTeam stopped.')
}

main().catch(console.error)
```

Run it:

```bash
ANTHROPIC_API_KEY=sk-... npx tsx src/main.ts
```

---

## Step 6 — Add persistent memory

Right now the lead starts fresh every run. Let's add persistent project memory so it accumulates knowledge over time.

The `memory: 'project'` field on the lead's config already enables this. The `TeamOrchestrator` automatically injects stored memory into the system prompt before each run.

Write something to the lead's memory manually:

```ts
import { AgentMemory } from 'titw'

const memory = new AgentMemory({
  agentType: 'lead',
  memoryBaseDir: config.memoryBaseDir,
  cwd: process.cwd(),
})

await memory.write('project', `
User preferences:
- Summaries should be 500-800 words
- Prefer prose over bullet points
- Always include primary sources when available
`)
```

On the next run the lead's system prompt will include:

```
<agent-memory>
User preferences:
- Summaries should be 500-800 words
...
</agent-memory>
```

The framework prepends this automatically — no changes to your runner needed.

---

## Step 7 — Graceful shutdown

Instead of a fixed `setTimeout`, use `ShutdownNegotiator` to let agents finish their current task before stopping.

```ts
import { ShutdownNegotiator, Mailbox } from 'titw'

const mailbox = new Mailbox({ teamsDir: config.teamsDir, teamName: team.name })
const negotiator = new ShutdownNegotiator({ mailbox, timeoutMs: 10_000 })

// Ask the lead to shut down gracefully
const result = await negotiator.requestShutdown('lead')

if (result.approved) {
  console.log('Lead acknowledged shutdown')
} else if (result.timedOut) {
  console.log('Lead timed out — forcing stop')
}

await orch.stop()
```

Inside the agent loop (your runner), check for a shutdown request:

```ts
const inbox = await params.readMailbox()
const shutdown = inbox.find(m => m.type === 'shutdown_request')
if (shutdown) {
  // Finish current work, then respond
  await params.sendMessage(shutdown.from, {
    from: params.agentId,
    type: 'shutdown_response',
    requestId: shutdown.requestId,
    approved: true,
    reason: 'task complete',
  })
  break  // Exit the loop
}
```

---

## Step 8 — Permission escalation

The `researcher` agent has `permissionMode: 'bubble'`, meaning permission prompts surface to the lead. Wire this with `PermissionBridge`:

```ts
import { PermissionBridge } from 'titw'

const bridge = new PermissionBridge()

// Register a handler on the lead — decides whether to grant the request
bridge.registerLeaderHandler(async (request) => {
  console.log(`[lead] Permission request from ${request.agentId}: ${request.toolName} on ${request.path}`)
  // Auto-approve read operations, deny writes
  return { approved: request.toolName === 'Read' }
})

// Grant blanket access to a safe directory
bridge.grantPath({
  path: `${process.cwd()}/data`,
  toolName: 'Read',
  addedBy: 'lead',
  addedAt: Date.now(),
})
```

Pass the bridge to `TeamOrchestrator` (optional — the orchestrator creates one internally if not provided):

```ts
const orch = new TeamOrchestrator({ team, runner, config, cwd: process.cwd(), bridge })
```

---

## Step 9 — Structured messages

Use the built-in structured message factories instead of raw text for protocol-level coordination:

```ts
import {
  createShutdownRequest,
  createPlanApprovalRequest,
  createPermissionRequest,
  isStructuredMessage,
  parseStructuredMessage,
} from 'titw'

// Send a typed shutdown request
const shutdownMsg = createShutdownRequest({ from: 'lead', to: 'researcher' })
await mailbox.write('researcher', shutdownMsg)

// On the receiving end
const messages = await mailbox.readUnread('researcher')
for (const msg of messages) {
  if (isStructuredMessage(msg)) {
    const parsed = parseStructuredMessage(msg)
    if (parsed?.type === 'shutdown_request') {
      // Handle shutdown
    }
  }
}
```

---

## What's next

- **Add tool use** to the runner — parse `tool_use` blocks and call Bash, Read, Write, etc.
- **Custom backend** — implement `TeammateExecutor` to run agents in containers or remote processes
- **Prompt cache sharing** — use `buildCacheablePrefix` to construct byte-identical prefixes across fork children for LLM cache hits
- **Multiple teams** — `TeamOrchestrator` is lightweight; run several teams in the same process, each with their own mailbox namespace

---

## Full API reference

See the [README](../README.md) for a complete API overview and the [source index](../src/index.ts) for all exported types and functions.
