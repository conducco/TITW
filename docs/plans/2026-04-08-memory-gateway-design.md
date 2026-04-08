# Design: Memory Gateway

**Date:** 2026-04-08
**Status:** Approved

---

## Problem

`AgentMemory` is hard-coded to a 3-tier markdown file layout. There is no way to plug in a different storage backend (graph database, Obsidian vault, external service) without forking the class. Teams doing knowledge-intensive work have no path to structured, queryable memory.

Additionally, there is no mechanism for agents to write new knowledge back to memory at runtime — the current system is read-only from the agent's perspective.

---

## Decision

Introduce `IMemoryProvider` — a pluggable interface for reading and writing agent memory. Ship three implementations: `FileProvider` (backward-compatible), `ObsidianProvider` (vault-native), and `FalkorProvider` (graph database, optional package). Add a Knowledge Graph Constructor (KGC) agent pattern that observes all team messages and extracts typed triples into the active provider.

Zero breaking changes to the core API.

---

## Section 1: `IMemoryProvider` Interface

```ts
interface IMemoryProvider {
  buildSystemPromptInjection(agentType: string, scope: AgentMemoryScope): Promise<string>
  write(agentType: string, scope: AgentMemoryScope, triples: Triple[]): Promise<void>
  connect?(): Promise<void>
  disconnect?(): Promise<void>
}

interface Triple {
  subject: string
  predicate: string
  object: string
  weight?: number   // default 1.0; used for decay scoring in FalkorProvider
}
```

**Design decisions:**
- `buildSystemPromptInjection` is the read path: called at spawn, injects `<agent-memory>` tag into system prompt
- `write` is the write path: called by the KGC runner after extracting triples from observed messages
- `connect`/`disconnect` are optional lifecycle hooks for providers that manage connections (e.g. FalkorDB)
- The framework never parses triples — the KGC runner owns extraction and calls `writeMemory(triples)`
- Providers serialize triples in their own format (markdown bullets / wikilinks / graph edges)

---

## Section 2: Wiring — TeamConfig, Orchestrator, and Mailbox

**`TeamConfig`** gains one field:
```ts
interface TeamConfig {
  // ... existing fields
  observerAgent?: string  // agent name that receives CC of every inbound message
}
```

**`TeamOrchestratorOptions`** gains one field:
```ts
interface TeamOrchestratorOptions {
  // ... existing fields
  memoryProvider?: IMemoryProvider  // if absent, falls back to AgentMemory (today's behavior)
}
```

**`AgentRunParams`** gains one field:
```ts
interface AgentRunParams {
  // ... existing fields
  writeMemory?: (triples: Triple[]) => Promise<void>  // only set for the observer/KGC agent
}
```

**Mailbox CC logic:** `Mailbox.write(to, message)` checks if the team has an `observerAgent` and, if so, writes a copy to `{teamsDir}/{teamName}/inboxes/{observerAgent}.json` in the same atomic operation. The observer sees all messages but never appears in any agent's peers list.

**Orchestrator flow on spawn:**
1. If `memoryProvider` is set → call `provider.buildSystemPromptInjection()`, inject into system prompt
2. If the agent being spawned is the `observerAgent` → pass `writeMemory: (triples) => provider.write(agentType, scope, triples)` in its `AgentRunParams`
3. All other agents get `writeMemory: undefined`

---

## Section 3: FileProvider

Backward-compatible replacement for `AgentMemory`. Zero new dependencies.

```ts
class FileProvider implements IMemoryProvider {
  constructor(private config: TitwConfig) {}

  async buildSystemPromptInjection(agentType: string, scope: AgentMemoryScope): Promise<string> {
    // delegates to existing AgentMemory logic — identical output, no behavior change
    return new AgentMemory(this.config).buildSystemPromptInjection(scope)
  }

  async write(agentType: string, scope: AgentMemoryScope, triples: Triple[]): Promise<void> {
    // resolves the same tier path AgentMemory uses for `scope`
    const filePath = resolveMemoryPath(this.config, scope)
    const lines = triples.map(t =>
      `- ${t.subject} ${t.predicate} ${t.object}` +
      (t.weight !== undefined ? ` (weight: ${t.weight})` : '')
    )
    await fs.appendFile(filePath, '\n' + lines.join('\n'))
  }
}
```

**Backward compatibility guarantee:** If `memoryProvider` is not set in `TeamOrchestratorOptions`, the orchestrator falls back to `AgentMemory` directly — no `FileProvider` instantiated, nothing changes.

**Migration path:** Teams that want KGC-written triples in their existing memory files opt in by passing `new FileProvider(config)`.

`AgentMemory` is not deleted or deprecated — `FileProvider` wraps it.

---

## Section 4: ObsidianProvider

```ts
class ObsidianProvider implements IMemoryProvider {
  constructor(private vaultDir: string) {}

  async write(agentType: string, scope: AgentMemoryScope, triples: Triple[]): Promise<void> {
    // group by subject → one note per entity
    for (const [subject, group] of groupBy(triples, t => t.subject)) {
      const notePath = path.join(this.vaultDir, scope, `${subject}.md`)
      const lines = group.map(t =>
        `- ${t.predicate}: [[${t.object}]]` +
        (t.weight !== undefined ? ` <!-- weight: ${t.weight} -->` : '')
      )
      await fs.appendFile(notePath, '\n' + lines.join('\n'))
    }
  }

  async buildSystemPromptInjection(agentType: string, scope: AgentMemoryScope): Promise<string> {
    const dir = path.join(this.vaultDir, scope)
    const files = await fs.readdir(dir).catch(() => [])
    const contents = await Promise.all(
      files.filter(f => f.endsWith('.md')).map(f => fs.readFile(path.join(dir, f), 'utf8'))
    )
    return contents.length
      ? `<agent-memory scope="${scope}">\n${contents.join('\n')}\n</agent-memory>`
      : ''
  }
}
```

**Design decisions:**
- One note per subject entity → Obsidian graph view works natively with wikilinks
- Scope (`user`/`project`/`local`) maps to subdirectory → vault browsable by context level
- No `connect`/`disconnect` needed — pure file I/O

**Vault layout:**
```
{vaultDir}/
  user/
    "Alice Johnson".md    ← "- manages: [[Project Alpha]]"
    "Project Alpha".md    ← "- status: [[active]]"
  project/
    "auth-service".md
```

---

## Section 5: FalkorProvider

```ts
class FalkorProvider implements IMemoryProvider {
  private graph!: FalkorGraph

  constructor(private opts: { url: string; graphName: string; lambda?: number }) {}

  async connect(): Promise<void> {
    const client = await FalkorDB.connect(this.opts.url)
    this.graph = client.selectGraph(this.opts.graphName)
  }

  async disconnect(): Promise<void> { await this.graph.close() }

  async write(agentType: string, scope: AgentMemoryScope, triples: Triple[]): Promise<void> {
    for (const t of triples) {
      await this.graph.query(`
        MERGE (s:Entity {name: $subject})
        MERGE (o:Entity {name: $object})
        CREATE (s)-[:RELATES_TO {
          predicate: $predicate,
          weight: $weight,
          createdAt: timestamp(),
          agentType: $agentType,
          scope: $scope
        }]->(o)
      `, { subject: t.subject, object: t.object, predicate: t.predicate,
           weight: t.weight ?? 1.0, agentType, scope })
    }
  }

  async buildSystemPromptInjection(agentType: string, scope: AgentMemoryScope): Promise<string> {
    const lambda = this.opts.lambda ?? 0.95
    const results = await this.graph.query(`
      MATCH (s)-[r:RELATES_TO]->(o)
      WHERE r.scope = $scope
      RETURN s.name, r.predicate, o.name,
             r.weight * pow($lambda, (timestamp() - r.createdAt) / 86400000.0) AS score
      ORDER BY score DESC
      LIMIT 50
    `, { scope, lambda })

    if (!results.data.length) return ''
    const lines = results.data.map(r => `- ${r['s.name']} ${r['r.predicate']} ${r['o.name']}`)
    return `<agent-memory scope="${scope}">\n${lines.join('\n')}\n</agent-memory>`
  }
}
```

**Decay formula:** `score = weight × λ^(age_in_days)`
- `λ = 0.95` default (~14-day half-life)
- Configurable per-provider instance
- Affects read ranking only — no data is ever deleted

**Design decisions:**
- Generic `RELATES_TO` edge with `predicate` as property (dynamic predicates can't be edge labels)
- `timestamp()` is FalkorDB's millisecond epoch — age computed inline in the query
- No explicit locking: FalkorDB (Redis-backed) serializes writes natively; KGC is the only writer per team

---

## Section 6: KGC Agent Config and Ontology Skill

**KGC is a regular agent, declared as `observerAgent`:**

```ts
const team: TeamConfig = {
  name: 'research',
  leadAgentName: 'lead',
  members: [leadAgent, researcherAgent, kgcAgent],
  observerAgent: 'kgc',
  memoryProvider: new FalkorProvider({ url: 'redis://localhost:6379', graphName: 'research' })
}

const kgcAgent: AgentConfig = {
  name: 'kgc',
  skills: ['ontology'],
  systemPrompt: `
    You observe all messages in this team. Extract factual triples.
    Output ONLY a JSON array — no other text:
    [{"subject":"...","predicate":"...","object":"...","weight":0.8}]
    Never send messages to other agents.
  `
}
```

**The runner's responsibility** — the KGC's `AgentRunner` is user-provided. It detects JSON output and calls `params.writeMemory`:

```ts
const kgcRunner: AgentRunner = async (params) => {
  const response = await callLLM(params)
  const triples = tryParseTriples(response.text)
  if (triples && params.writeMemory) {
    await params.writeMemory(triples)
  }
  return { turnCount: 1 }
}
```

The framework never parses JSON — it just calls `writeMemory` when set. Runner owns extraction.

**Ontology skill** — a markdown file in the team's skills directory:

```markdown
<!-- skills/ontology.md -->
# Entity Types
- Person: individuals by full name (resolve "Alice" → "Alice Johnson" if context allows)
- Project: named initiatives
- Decision: choices made with rationale

# Relationship Vocabulary
- manages, reports-to, owns, depends-on, decided, blocked-by

# Resolution Rules
- Prefer full names over pronouns
- "the project" → resolve to the last named project in context
```

Loaded by KGC for writing consistency. Can also be loaded by agents that need to query or reason about memory content.

KGC is a pattern, not a library component. Ships as docs + example runner snippet only.

---

## Section 7: Package Structure

**`@conducco/titw` (core) — gains:**
- `IMemoryProvider` interface
- `Triple` type
- `FileProvider` — wraps `AgentMemory`, pure FS, zero new deps
- `ObsidianProvider` — pure FS, zero new deps

**`@conducco/titw-falkor` (new optional package):**
- `FalkorProvider` only
- Peer dep: `falkordb`
- `@conducco/titw` as peer dep

```
packages/
  titw/              ← gains IMemoryProvider + Triple + FileProvider + ObsidianProvider
  titw-falkor/       ← new, FalkorProvider only
```

**Exports from core:**
```ts
export type { IMemoryProvider, Triple }
export { FileProvider } from './memory/FileProvider.js'
export { ObsidianProvider } from './memory/ObsidianProvider.js'
```

**Exports from falkor package:**
```ts
export { FalkorProvider } from './FalkorProvider.js'
```

---

## Out of Scope

- No changes to `AgentRunner` interface contract (runner still owns LLM calls)
- No framework-level JSON parsing of triples
- No KGC package — pattern only
- No Ontology Maker package — markdown template only
- No changes to existing `AgentMemory` behavior when `memoryProvider` is absent
- No per-agent providers — provider is per-team
