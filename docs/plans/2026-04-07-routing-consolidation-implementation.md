# Routing Consolidation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove text-pattern routing from all docs, consolidate to one production-level tutorial, and add a standalone routing reference.

**Architecture:** Docs-only — no code, no API changes, no tests. Four sequential file operations: delete old tutorial, rename+edit production tutorial, create routing guide, update README.

**Tech Stack:** Markdown, Git

---

## Pre-flight

```bash
cd /Users/cmedeiros/code/conducco/conducco-agents
git status   # should be clean
```

---

### Task 1: Delete old `docs/tutorial.md`

**Files:**
- Delete: `docs/tutorial.md`

**Step 1: Delete the file**

```bash
git rm docs/tutorial.md
```

**Step 2: Verify**

```bash
ls docs/tutorial*.md
```
Expected: only `docs/tutorial-production.md` remains.

**Step 3: Commit**

```bash
git commit -m "docs: remove text-pattern routing tutorial"
```

---

### Task 2: Rename and clean `docs/tutorial-production.md` → `docs/tutorial.md`

**Files:**
- Rename: `docs/tutorial-production.md` → `docs/tutorial.md`

**Step 1: Rename with git**

```bash
git mv docs/tutorial-production.md docs/tutorial.md
```

**Step 2: Edit the file header**

Open `docs/tutorial.md`. Replace the opening block (lines 1–20) with:

```markdown
# titw Tutorial

A production-grade multi-agent team — built correctly from the start.

By the end you'll have a runner you can drop into a real product: tool-use-based routing, error handling with retries, graceful shutdown, and explicit completion signaling.

---
```

That means removing:
- The subtitle line: `"This tutorial covers what the [basic tutorial](./tutorial.md) deliberately skips: ..."`
- The `## What makes this different from the basic tutorial` section and its table (4 rows + separator lines)

**Step 3: Renumber steps**

There are currently Steps 1–4, 4b, 5, 6. Rename:
- `## Step 4b — Adding MCP tools and skills` → `## Step 5 — Adding MCP tools and skills`
- `## Step 5 — Handle shutdown inside the runner` → `## Step 6 — Handle shutdown inside the runner`
- `## Step 6 — Run it` → `## Step 7 — Run it`

Also update the expected output block inside "Run it" — it still references correct step numbers in comments, which is fine.

**Step 4: Verify no broken links**

```bash
grep -n "basic tutorial\|tutorial-production\|tutorial\.md" docs/tutorial.md
```
Expected: no matches (all references removed).

**Step 5: Commit**

```bash
git add docs/tutorial.md
git commit -m "docs: promote production tutorial as the single tutorial"
```

---

### Task 3: Create `docs/routing.md`

**Files:**
- Create: `docs/routing.md`

**Step 1: Create the file**

Create `docs/routing.md` with the following content:

````markdown
# Routing in titw

Agents communicate by routing messages to each other using the `send_message` tool. This document explains why tool-use routing is the right approach, how to implement it, and common patterns.

---

## Why tool-use routing

The naive approach is to ask the model to embed a routing marker in its response text:

```ts
// ❌ Fragile — models drop the marker in long or structured responses
const match = text.match(/SEND TO (\w+): (.+)/s)
```

This fails silently. When the model produces a markdown report, a long analysis, or a code block, it often omits the plain-text instruction. The pipeline stalls with no error.

**Tool-use is reliable.** Modern LLMs are heavily fine-tuned to invoke tools correctly. When `send_message` is in the tool list, the model calls it as a structured action — not embedded in prose — and the routing destination is a required parameter, not something the model can accidentally omit.

---

## The `send_message` tool

Define this tool in every runner:

```ts
// Anthropic
const TOOLS: Anthropic.Tool[] = [
  {
    name: 'send_message',
    description:
      'Send a message to another agent or back to the user. ' +
      'Call this when you have results to deliver or need to delegate work.',
    input_schema: {
      type: 'object' as const,
      properties: {
        to: {
          type: 'string',
          description: 'Recipient name — another agent (e.g. "researcher") or "user" when the task is complete.',
        },
        content: {
          type: 'string',
          description: 'The full message content to deliver.',
        },
      },
      required: ['to', 'content'],
    },
  },
]
```

```ts
// OpenAI
const TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'send_message',
      description: 'Send a message to another agent or back to the user.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient name — another agent or "user".' },
          content: { type: 'string', description: 'The message content.' },
        },
        required: ['to', 'content'],
      },
    },
  },
]
```

**The `"user"` recipient** is the convention for signalling task completion. The orchestrator polls the `user` inbox to detect when the lead has finished.

---

## Full dispatch loop

### Anthropic

```ts
import Anthropic from '@anthropic-ai/sdk'
import type { AgentRunner } from '@conducco/titw'

const client = new Anthropic()

const TOOLS: Anthropic.Tool[] = [/* definition above */]

export const runner: AgentRunner = async (params) => {
  const messages: Anthropic.MessageParam[] = []
  if (params.prompt) messages.push({ role: 'user', content: params.prompt })

  let turns = 0
  let tokenCount = 0
  let lastOutput = ''

  while (!params.abortSignal.aborted) {
    const inbox = await params.readMailbox()
    for (const msg of inbox) {
      messages.push({ role: 'user', content: `[From ${msg.from}]: ${msg.text}` })
    }

    const last = messages.at(-1)
    if (!last || last.role !== 'user') { await new Promise(r => setTimeout(r, 500)); continue }
    if (turns++ >= params.maxTurns) break

    const res = await client.messages.create({
      model: params.model,
      max_tokens: 4096,
      system: params.systemPrompt,
      tools: TOOLS,
      messages,
      signal: params.abortSignal,
    })

    messages.push({ role: 'assistant', content: res.content })
    tokenCount += res.usage.input_tokens + res.usage.output_tokens

    const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
    if (text) lastOutput = text

    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const block of res.content) {
      if (block.type === 'tool_use' && block.name === 'send_message') {
        const { to, content } = block.input as { to: string; content: string }
        await params.sendMessage(to, { from: params.agentId, text: content })
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Message delivered to ${to}.` })
      }
    }
    if (toolResults.length > 0) messages.push({ role: 'user', content: toolResults })
  }

  return { output: lastOutput, toolUseCount: 0, tokenCount, stopReason: params.abortSignal.aborted ? 'aborted' : 'complete' }
}
```

### OpenAI

```ts
import OpenAI from 'openai'
import type { AgentRunner } from '@conducco/titw'

const client = new OpenAI()

const TOOLS: OpenAI.ChatCompletionTool[] = [/* definition above */]

export const runner: AgentRunner = async (params) => {
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: params.systemPrompt },
  ]
  if (params.prompt) messages.push({ role: 'user', content: params.prompt })

  let turns = 0
  let tokenCount = 0
  let lastOutput = ''

  while (!params.abortSignal.aborted) {
    const inbox = await params.readMailbox()
    for (const msg of inbox) {
      messages.push({ role: 'user', content: `[From ${msg.from}]: ${msg.text}` })
    }

    const last = messages.at(-1)
    if (!last || last.role !== 'user') { await new Promise(r => setTimeout(r, 500)); continue }
    if (turns++ >= params.maxTurns) break

    const res = await client.chat.completions.create({
      model: params.model,
      messages,
      tools: TOOLS,
    })

    const msg = res.choices[0]!.message
    messages.push(msg)
    tokenCount += res.usage?.total_tokens ?? 0
    if (msg.content) lastOutput = msg.content

    for (const call of msg.tool_calls ?? []) {
      if (call.function.name === 'send_message') {
        const { to, content } = JSON.parse(call.function.arguments) as { to: string; content: string }
        await params.sendMessage(to, { from: params.agentId, text: content })
        messages.push({ role: 'tool', tool_call_id: call.id, content: `Message delivered to ${to}.` })
      }
    }
  }

  return { output: lastOutput, toolUseCount: 0, tokenCount, stopReason: params.abortSignal.aborted ? 'aborted' : 'complete' }
}
```

**Always return tool results to the model** (the `toolResults.push` / `messages.push` step). If you skip this, the model stalls waiting for a response that never arrives.

---

## Routing patterns

### Linear pipeline

The most common pattern. Each agent has exactly one downstream destination.

```
user → lead → researcher → lead → writer → lead → user
```

System prompt for `researcher`:
```
When your research is complete, deliver it by calling:
send_message(to="lead", content=<your findings>)
```

### Fan-out

The lead delegates to multiple workers in parallel, then collects results.

```
lead → researcher
lead → coder
researcher → lead  (results)
coder → lead       (results)
lead → user
```

System prompt for `lead`:
```
1. Send the research task: send_message(to="researcher", content=...)
2. Send the coding task: send_message(to="coder", content=...)
3. When both have replied, synthesize and send_message(to="user", content=...)
```

Because routing is explicit (`to` is a required parameter), fan-out works correctly — there is no ambiguity about where each response goes.

### Fan-in (workers reply to lead)

Workers always reply to the agent that assigned them work. The lead's system prompt tracks pending responses:

```
You have delegated to researcher and coder. Wait for both replies before proceeding.
When both have responded, synthesize the results and send_message(to="user", content=...).
```

---

## Common mistakes

**1. Forgetting to return tool results to the model**

After calling `send_message`, push a `tool_result` back into the message array. If you don't, the model is left in a state where it called a tool but never received confirmation — it will stall or repeat itself.

**2. Routing to `"user"` too early**

Only call `send_message(to="user", ...)` when the full task is complete. The orchestrator treats a message in the `user` inbox as the terminal signal. Sending an intermediate result there will cause the orchestrator to stop the team prematurely.

**3. Not passing `signal` to the SDK**

Pass `params.abortSignal` to your SDK call (`signal` in Anthropic, not supported in all OpenAI versions). Without it, in-flight API requests are not cancelled when `orch.stop()` fires, causing the process to hang until they complete.

**4. Infinite loops from missing tool calls**

If the model produces text without calling `send_message`, and your runner loops back to wait for more input, it will call the model again with the same prompt — potentially forever. Guard with `maxTurns` and log a warning when the limit is reached.
````

**Step 2: Verify the file was created**

```bash
wc -l docs/routing.md
```
Expected: 150+ lines.

**Step 3: Commit**

```bash
git add docs/routing.md
git commit -m "docs: add routing reference guide"
```

---

### Task 4: Update `README.md` runner examples

**Files:**
- Modify: `README.md`

The Anthropic runner example currently spans roughly lines 142–190 and the OpenAI example lines 192–241. Both use `SEND TO` regex and `lastSender` auto-reply. Replace both with tool-use versions.

**Step 1: Replace the Anthropic runner example**

Find the `**Anthropic**` section and replace the entire code block with:

```ts
import Anthropic from '@anthropic-ai/sdk'
import type { AgentRunner } from '@conducco/titw'

const client = new Anthropic()

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'send_message',
    description: 'Send a message to another agent or back to the user.',
    input_schema: {
      type: 'object' as const,
      properties: {
        to: { type: 'string', description: 'Recipient name — another agent or "user".' },
        content: { type: 'string', description: 'The message content.' },
      },
      required: ['to', 'content'],
    },
  },
]

export const runner: AgentRunner = async (params) => {
  const messages: Anthropic.MessageParam[] = []
  if (params.prompt) messages.push({ role: 'user', content: params.prompt })

  let turns = 0
  let tokenCount = 0
  let lastOutput = ''

  while (!params.abortSignal.aborted) {
    const inbox = await params.readMailbox()
    for (const msg of inbox) {
      messages.push({ role: 'user', content: `[From ${msg.from}]: ${msg.text}` })
    }

    const last = messages.at(-1)
    if (!last || last.role !== 'user') { await new Promise(r => setTimeout(r, 500)); continue }
    if (turns++ >= params.maxTurns) break

    const res = await client.messages.create({
      model: params.model,
      max_tokens: 4096,
      system: params.systemPrompt,
      tools: TOOLS,
      messages,
      signal: params.abortSignal,
    })

    messages.push({ role: 'assistant', content: res.content })
    tokenCount += res.usage.input_tokens + res.usage.output_tokens
    const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
    if (text) lastOutput = text

    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const block of res.content) {
      if (block.type === 'tool_use' && block.name === 'send_message') {
        const { to, content } = block.input as { to: string; content: string }
        await params.sendMessage(to, { from: params.agentId, text: content })
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Message delivered to ${to}.` })
      }
    }
    if (toolResults.length > 0) messages.push({ role: 'user', content: toolResults })
  }

  return { output: lastOutput, toolUseCount: 0, tokenCount, stopReason: params.abortSignal.aborted ? 'aborted' : 'complete' }
}
```

**Step 2: Replace the OpenAI runner example**

Find the `**OpenAI**` section and replace the entire code block with:

```ts
import OpenAI from 'openai'
import type { AgentRunner } from '@conducco/titw'

const client = new OpenAI()

const TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'send_message',
      description: 'Send a message to another agent or back to the user.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient name — another agent or "user".' },
          content: { type: 'string', description: 'The message content.' },
        },
        required: ['to', 'content'],
      },
    },
  },
]

export const runner: AgentRunner = async (params) => {
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: params.systemPrompt },
  ]
  if (params.prompt) messages.push({ role: 'user', content: params.prompt })

  let turns = 0
  let tokenCount = 0
  let lastOutput = ''

  while (!params.abortSignal.aborted) {
    const inbox = await params.readMailbox()
    for (const msg of inbox) {
      messages.push({ role: 'user', content: `[From ${msg.from}]: ${msg.text}` })
    }

    const last = messages.at(-1)
    if (!last || last.role !== 'user') { await new Promise(r => setTimeout(r, 500)); continue }
    if (turns++ >= params.maxTurns) break

    const res = await client.chat.completions.create({
      model: params.model,
      messages,
      tools: TOOLS,
    })

    const msg = res.choices[0]!.message
    messages.push(msg)
    tokenCount += res.usage?.total_tokens ?? 0
    if (msg.content) lastOutput = msg.content

    for (const call of msg.tool_calls ?? []) {
      if (call.function.name === 'send_message') {
        const { to, content } = JSON.parse(call.function.arguments) as { to: string; content: string }
        await params.sendMessage(to, { from: params.agentId, text: content })
        messages.push({ role: 'tool', tool_call_id: call.id, content: `Message delivered to ${to}.` })
      }
    }
  }

  return { output: lastOutput, toolUseCount: 0, tokenCount, stopReason: params.abortSignal.aborted ? 'aborted' : 'complete' }
}
```

**Step 3: Add routing guide link**

After both runner examples, find the paragraph:

```
The `params.model` string comes from your `TeamConfig` ...
```

Add a line after it:

```markdown
For a deep-dive on routing patterns, fan-out, and common mistakes, see the **[Routing Guide](./docs/routing.md)**.
```

**Step 4: Verify no SEND TO references remain**

```bash
grep -n "SEND TO\|lastSender\|match\[1\]" README.md
```
Expected: no matches.

**Step 5: Commit**

```bash
git add README.md
git commit -m "docs: upgrade README runner examples to tool-use routing"
```

---

## Post-flight

```bash
grep -rn "SEND TO\|tutorial-production\|basic tutorial" docs/ README.md
```
Expected: no matches (clean removal of all text-pattern routing references).
