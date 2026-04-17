# Query Patterns for Context7

## Effective query strategies

### Be specific with topics

```
# Good — focused topic
get-library-docs({ ..., topic: "server actions", tokens: 5000 })

# Bad — too broad
get-library-docs({ ..., topic: "", tokens: 10000 })
```

### Version-specific queries

Some libraries have version-specific IDs. If `resolve-library-id` returns multiple results:
- Pick the one matching the project's version
- If no version match, pick the highest trust score

### Multi-topic research

Make separate calls per topic instead of one broad call:

```
# Call 1: authentication
get-library-docs({ ..., topic: "authentication middleware", tokens: 4000 })

# Call 2: database queries
get-library-docs({ ..., topic: "prisma client queries", tokens: 4000 })
```

## Common library name mappings

These alternate names help when `resolve-library-id` doesn't find a match on first try:

| What you mean | Try these names |
|---------------|----------------|
| React Router | `react-router`, `react-router-dom`, `remix-router` |
| Next.js | `next.js`, `nextjs`, `next` |
| Tailwind | `tailwindcss`, `tailwind-css` |
| Prisma | `prisma`, `prisma-client` |
| tRPC | `trpc`, `@trpc/server` |
| Zod | `zod` |
| Drizzle | `drizzle-orm`, `drizzle` |
| shadcn/ui | `shadcn-ui`, `shadcn` |
| Hono | `hono`, `honojs` |
| Express | `express`, `expressjs` |
| FastAPI | `fastapi` |
| Supabase | `supabase`, `supabase-js` |
| Firebase | `firebase`, `firebase-admin` |
| Stripe | `stripe`, `stripe-node` |
| Clerk | `clerk`, `@clerk/nextjs` |

## When Context7 returns nothing

1. Try alternate library names from the table above
2. Try without version qualifier
3. Fall back to `WebSearch` with query: `"[library] [version] [topic] documentation site:docs.[library].com"`
4. Use `WebFetch` on the library's official docs URL
