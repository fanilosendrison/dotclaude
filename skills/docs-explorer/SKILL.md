---
name: docs-explorer
description: "Fetch up-to-date, version-specific library documentation using Context7 MCP. Injects live docs and code examples directly into context to avoid hallucinated APIs. Use when implementing features with external libraries (React, Next.js, Supabase, Express, etc.), when unsure about a library's current API, when the user asks 'docs de X', 'comment utiliser X', 'cherche la doc de X', 'explore docs', 'docs-explorer', 'documentation de X', or any variant requesting library documentation lookup. Also trigger proactively when about to write code using a library whose API may have changed since training data cutoff."
---

# docs-explorer

Fetch live, version-specific library documentation via Context7 MCP to avoid hallucinated APIs.

## Prerequisites

Context7 MCP must be configured. Verify tools are available:
- `mcp__context7__resolve-library-id`
- `mcp__context7__get-library-docs`

If tools are missing, instruct the user to restart Claude Code (the MCP server is configured in `~/.claude.json`).

## Workflow

### Step 1 — Resolve library ID

```
mcp__context7__resolve-library-id({ libraryName: "next.js" })
```

Returns a Context7-compatible ID (e.g., `/vercel/next.js`). Pick the result with the highest trust score.

### Step 2 — Query documentation

```
mcp__context7__get-library-docs({
  context7CompatibleLibraryID: "/vercel/next.js",
  topic: "middleware",
  tokens: 5000
})
```

Parameters:
- `context7CompatibleLibraryID`: From step 1 (required)
- `topic`: Specific feature/API to query (optional but strongly recommended)
- `tokens`: Max tokens to return — use 3000-5000 for focused queries, 8000-10000 for broad exploration

### Step 3 — Extract and apply

From the returned docs, extract:
1. **API signatures** relevant to the task
2. **Code examples** — copy relevant snippets verbatim
3. **Configuration** — required setup, env vars, dependencies
4. **Gotchas** — breaking changes, deprecations, version-specific behavior

## When to trigger

| Situation | Action |
|-----------|--------|
| User asks for library docs explicitly | Trigger immediately |
| About to implement with a library | Trigger proactively if API uncertainty exists |
| User says "use latest X" or specifies a version | Trigger with version-specific query |
| Debugging a library-related error | Trigger to verify correct API usage |
| User invokes `/docs-explorer` | Trigger |

## Token budget

Keep Context7 calls lean:
- **Focused query** (single API/feature): `tokens: 3000-5000`
- **Broad exploration** (overview of a lib): `tokens: 8000-10000`
- **Multiple features**: Make separate calls per topic rather than one large call

## Fallback

If Context7 doesn't have the library or returns insufficient results:
1. Try alternate library names (e.g., "react-router" vs "react-router-dom")
2. Fall back to `WebSearch` + `WebFetch` on the library's official docs
3. State clearly what was found vs. what's from general knowledge

## Integration with explore-docs agent

This skill runs in the **main context**. For background research or when context window budget is tight, delegate to the `explore-docs` agent via Task tool instead:

```
Task(subagent_type="explore-docs", prompt="Research [library] [topic]")
```

Use the agent when:
- Multiple libraries need research simultaneously
- The research is exploratory (not tied to immediate implementation)
- Context window is already heavy

Use this skill directly when:
- Implementing right now and need docs inline
- Single, focused lookup
- User explicitly invokes `/docs-explorer`

## Query patterns

See [references/query-patterns.md](references/query-patterns.md) for effective query examples and known library IDs.
