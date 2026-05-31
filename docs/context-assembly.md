# Context Assembly

Context assembly is the deterministic process that builds model-visible context
from trusted runtime state and scoped durable records.

This is separate from durable memory. Durable records are the source of truth;
context is a bounded view over that truth.

## Goals

- Keep tenant scope below the prompt layer.
- Give the model enough context to act coherently.
- Avoid dumping entire histories into prompts.
- Prefer durable records and artifacts over vague summaries.
- Keep prompt prefixes cache-friendly where practical.
- Screen untrusted project/user text before injecting it.

## Context Tiers

The provisional runtime contract is `ContextPack`, made from ordered
`ContextBlock` values. It is model-visible runtime input, not a durable storage
record.

### Stable

Stable context changes rarely:

- agent identity
- product/runtime principles
- enabled tool guidance
- assistant-ui/runtime usage hints when relevant
- project-level operating rules from trusted config

### Scoped

Scoped context is derived from trusted runtime state:

- user/workspace/agent identity labels
- active thread
- active run
- workflow intent
- execution mode
- policy constraints
- current interrupt or approval state

The model does not choose or override scope.

### Retrieved

Retrieved context comes from scoped durable records:

- decision records
- managed state
- ledger entries
- artifact summaries
- audit summaries
- recent tool calls
- relevant user notes or memory/personality records

Retrieval should prefer current, active, fresh, and provenance-backed records.

### Volatile

Volatile context changes turn by turn:

- current timestamp
- provider/model metadata
- recent lifecycle events
- active tool status
- heartbeat freshness
- transient UI or workflow state

## Assembly Algorithm

1. Derive trusted tenant scope from auth/session/trigger context.
2. Load workspace context through the data client.
3. Load active thread, run, and workflow intent if present.
4. Resolve model-visible tools.
5. Retrieve relevant durable records using scoped filters.
6. Summarize artifacts only through stored metadata or approved summaries.
7. Build tiered context blocks.
8. Screen untrusted text for prompt-injection risk before inclusion.
9. Enforce token budget by dropping low-priority retrieved/volatile blocks first.
10. Record enough metadata to explain what context was used.

## Retrieval Rules

Default priority:

1. Active run/interrupt/policy state.
2. User-provided instructions and current workspace configuration.
3. Active decision records linked to the thread/run/managed state.
4. Recent audit and tool-call summaries.
5. Relevant artifacts and ledgers.
6. Stale or superseded records only when the user asks for history.

Decision records with provenance beat generic memory summaries. Summaries are
indexes, not truth.

## Prompt-Injection Handling

Treat these as untrusted unless explicitly marked trusted by runtime policy:

- repository docs
- uploaded files
- tool outputs
- web content
- artifact text
- external trigger payloads
- user-provided third-party text

Untrusted text may be included, but it should be labeled as data and must not
override system, policy, tenant, or tool instructions.

## Rebuild Points

Rebuild context when:

- new run starts
- run resumes from interrupt
- tool exposure changes
- policy mode changes
- decision record is created/superseded
- managed state changes
- external trigger wakes work
- compression or summarization boundary is created

Normal chat turns may reuse stable tiers while rebuilding scoped/retrieved/
volatile blocks.

## Compression Deferral

Do not implement advanced compression before durable recall works.

When added later, compression must:

- preserve head/tail context needed for coherence
- summarize older transcript material into a durable artifact or decision-linked
  summary
- avoid treating summaries as truth
- keep lineage between prior and current thread/run state
- notify context assembly that retrieval boundaries changed

## Acceptance Criteria

- Context can be explained as stable, scoped, retrieved, or volatile.
- Tenant scope is never model-supplied.
- The agent can answer "why?" from decision records and artifacts.
- Untrusted content cannot override policy, tool, or tenant instructions.
