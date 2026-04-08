# Memory Gateway

The memory gateway makes agent memory pluggable. Instead of being locked to the built-in markdown file system, you can swap in an Obsidian vault, a graph database, or any backend that implements a two-method interface.

You can also wire a **Knowledge Graph Constructor (KGC)** — an observer agent that silently receives a copy of every team message and extracts structured knowledge into the active provider.

---

## How it works

Three moving parts:

**`IMemoryProvider`** — the interface all providers implement:

```ts
interface IMemoryProvider {
  buildSystemPromptInjection(agentType: string, scope: AgentMemoryScope): Promise<string>
  write(agentType: string, scope: AgentMemoryScope, triples: Triple[]): Promise<void>
  connect?(): Promise<void>
  disconnect?(): Promise<void>
}
```

- `buildSystemPromptInjection` is called at spawn time and injects memory content into the agent's system prompt.
- `write` is called by the KGC runner after it extracts knowledge triples from observed messages.

**`observerAgent`** — a field on `TeamConfig`. When set, every message delivered to any team member is also silently copied to the observer's inbox via `Mailbox.write()`. The observer is not visible to other agents as a peer.

**`writeMemory`** — an optional field on `AgentRunParams`. The framework sets it only for the observer agent. The KGC runner calls it with the triples it extracts; the framework passes them to `provider.write()`.

---

## Default behavior — nothing to change

If you don't set `memoryProvider` on `TeamOrchestratorOptions`, the orchestrator falls back to the existing `AgentMemory` behavior. Your existing agent configs with `memory: 'project'` etc. continue to work exactly as before.

```ts
// No change needed — this already works
const orch = new TeamOrchestrator({
  team,
  runner,
  config,
  cwd: process.cwd(),
})
```

---

## FileProvider — same storage, adds write path

`FileProvider` wraps `AgentMemory`. It reads and injects memory identically to the default, but also accepts `write()` calls from the KGC — storing extracted triples as markdown bullets in the same files your agents already use.

```ts
import { TeamOrchestrator, FileProvider } from '@conducco/titw'

const orch = new TeamOrchestrator({
  team,
  runner,
  config,
  cwd: process.cwd(),
  memoryProvider: new FileProvider({
    cwd: process.cwd(),
    memoryBaseDir: config.memoryBaseDir,
  }),
})
```

Triples are appended as:

```markdown
- Alice manages ProjectAlpha
- Bob reports-to Alice (weight: 0.9)
```

They land in the same `MEMORY.md` files read at the next spawn.

---

## ObsidianProvider — vault-native format

`ObsidianProvider` writes one note per subject entity, using wikilinks for relationships. This makes the Obsidian graph view work natively — each note links to the entities it references.

```ts
import { TeamOrchestrator, ObsidianProvider } from '@conducco/titw'

const orch = new TeamOrchestrator({
  team,
  runner,
  config,
  cwd: process.cwd(),
  memoryProvider: new ObsidianProvider('/Users/you/vault'),
})
```

Triples are stored as:

```markdown
<!-- /Users/you/vault/project/Alice.md -->
- manages: [[ProjectAlpha]]
- reports-to: [[CEO]] <!-- weight: 0.9 -->
```

Scope (`user` / `project` / `local`) maps to a subdirectory inside the vault. `buildSystemPromptInjection` reads all `.md` files in the scope directory and injects them wrapped in `<agent-memory>` tags.

**Vault layout:**

```
/Users/you/vault/
  user/
    Alice.md
    ProjectAlpha.md
  project/
    auth-service.md
```

---

## FalkorProvider — graph database with decay scoring

`FalkorProvider` stores triples as graph edges in [FalkorDB](https://falkordb.com) and retrieves them with a time-decay ranking. Older, lower-weight knowledge is ranked lower in injection without ever being deleted.

Install `falkordb` separately (it is an optional peer dependency):

```bash
npm install falkordb
```

Import from the sub-path export:

```ts
import { TeamOrchestrator } from '@conducco/titw'
import { FalkorProvider } from '@conducco/titw/falkor'

const provider = new FalkorProvider({
  url: 'redis://localhost:6379',
  graphName: 'my-team',
  lambda: 0.95,    // decay factor — optional, default 0.95 (~14-day half-life)
})

const orch = new TeamOrchestrator({
  team,
  runner,
  config,
  cwd: process.cwd(),
  memoryProvider: provider,
})
```

Because `FalkorProvider` manages a connection, call `connect()` before starting the orchestrator and `disconnect()` after stopping it:

```ts
await provider.connect()
await orch.start()

// ... run your team ...

await orch.stop()
await provider.disconnect()
```

**Decay formula:** `score = weight × λ^(age_in_days)`

- A triple written today with `weight: 1.0` and `λ = 0.95` scores `0.95` after 1 day, `0.77` after 5 days, `0.60` after 10 days.
- The top 50 results by score are injected at spawn time.
- No data is ever deleted — decay affects ranking only.

---

## The KGC pattern — writing knowledge at runtime

The Knowledge Graph Constructor (KGC) is a regular agent that observes all team messages and extracts typed triples. It is declared as `observerAgent` on the team config.

### 1. Declare the team

```ts
import { TeamOrchestrator, FileProvider } from '@conducco/titw'

const kgcAgent: AgentConfig = {
  name: 'kgc',
  systemPrompt: `
You observe all messages in this team. Extract factual triples as JSON.
Output ONLY a JSON array — no other text:
[{"subject":"...","predicate":"...","object":"...","weight":0.8}]
Never send messages to other agents.
  `.trim(),
}

const team: TeamConfig = {
  name: 'research',
  leadAgentName: 'lead',
  members: [leadAgent, researcherAgent, kgcAgent],
  observerAgent: 'kgc',    // KGC receives a CC of every message
}

const orch = new TeamOrchestrator({
  team,
  runner,   // see step 2
  config,
  cwd: process.cwd(),
  memoryProvider: new FileProvider({ cwd: process.cwd(), memoryBaseDir: config.memoryBaseDir }),
})
```

### 2. Write a KGC runner

The framework sets `params.writeMemory` only for the observer agent. Your runner detects JSON output and calls it:

```ts
import type { AgentRunner } from '@conducco/titw'

function tryParseTriples(text: string) {
  try {
    const parsed = JSON.parse(text.trim())
    if (Array.isArray(parsed)) return parsed
  } catch { /* not JSON */ }
  return null
}

// Route to different runner implementations by agent name
export const runner: AgentRunner = async (params) => {
  if (params.agentId.startsWith('kgc@')) {
    return kgcRunner(params)
  }
  return mainRunner(params)
}

const kgcRunner: AgentRunner = async (params) => {
  const inbox = await params.readMailbox()
  if (inbox.length === 0) return { output: '', toolUseCount: 0, tokenCount: 0, stopReason: 'complete' }

  // Combine all observed messages into one prompt
  const observed = inbox.map(m => `[${m.from}]: ${m.text}`).join('\n\n')

  const response = await callLLM({
    system: params.systemPrompt,
    prompt: observed,
    model: params.model,
  })

  const triples = tryParseTriples(response.text)
  if (triples && params.writeMemory) {
    await params.writeMemory(triples)
  }

  return { output: response.text, toolUseCount: 0, tokenCount: response.tokens, stopReason: 'complete' }
}
```

### 3. Optionally add an Ontology skill

Create a skill file to give the KGC a consistent vocabulary for entity types and relationships. Add it to the KGC agent config:

```ts
const kgcAgent: AgentConfig = {
  name: 'kgc',
  skills: ['./skills/ontology.md'],   // loaded at spawn, injected into systemPrompt
  systemPrompt: `...`,
}
```

`skills/ontology.md`:

```markdown
---
name: ontology
---

# Entity Types
- Person: individuals by full name (resolve "Alice" → "Alice Johnson" when context allows)
- Project: named initiatives
- Decision: choices with rationale

# Relationship Vocabulary
- manages, reports-to, owns, depends-on, decided, blocked-by

# Resolution Rules
- Prefer full names over pronouns
- "the project" → resolve to the last named project in context
```

The same skill can be loaded by other agents that need to reason about memory content.

---

## Scopes

All providers respect the same three scopes defined by `AgentMemoryScope`:

| Scope | Intent |
|-------|--------|
| `user` | Persistent across all projects — agent's personal long-term memory |
| `project` | Shared within a codebase — tracked by VCS |
| `local` | Machine-local — not committed |

When `writeMemory` is called by the KGC runner, the scope used is the observer agent's `memory` field (e.g. `memory: 'project'`). If the agent has no `memory` field, it defaults to `'project'`.

---

## Common mistakes

**1. Not calling `connect()` / `disconnect()` for FalkorProvider**

`FalkorProvider` manages a Redis connection. If you skip `connect()`, `write()` and `buildSystemPromptInjection()` will throw. Always call `connect()` before `orch.start()` and `disconnect()` after `orch.stop()`.

**2. KGC runner always calls `writeMemory` without checking for triples**

If the LLM returns text that isn't valid JSON (a preamble, an explanation, an empty response), `tryParseTriples` returns null. Guard before calling `writeMemory`:

```ts
const triples = tryParseTriples(response.text)
if (triples && params.writeMemory) {   // both guards required
  await params.writeMemory(triples)
}
```

**3. Passing `memoryProvider` without `observerAgent`**

A provider without an observer agent is valid — the provider's `buildSystemPromptInjection` is used at spawn time, but `write()` is never called (no KGC to call it). This is fine if you only want to read from an existing knowledge store without updating it at runtime.

**4. Setting `observerAgent` to an agent not in `members`**

The observer needs to be spawned to receive messages. If `observerAgent` names an agent that isn't in `members`, its inbox accumulates messages but no runner processes them — `writeMemory` is never called. Always include the observer in `members`.

**5. Using `FileProvider` with a wrong `memoryBaseDir`**

`FileProvider` must be constructed with the same `memoryBaseDir` that your `TitwConfig` uses. If they differ, the provider will inject from one location and agents will read from another, and triple appends will land in the wrong directory.
