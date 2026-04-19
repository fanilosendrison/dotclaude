# PROJECT_INDEX.md Format Reference

Generate `PROJECT_INDEX.md` at the project root following this structure. Adapt sections to the project — omit empty sections, add relevant ones.

## Template

```markdown
# Project Index
> Git ref: [first 7 chars of tree hash] | Generated: [YYYY-MM-DD]

## Architecture Overview
[1-3 sentences: stack, main pattern, directory structure]

## Module Map
### [module_dir/]
- **Purpose**: [1 line]
- **Key files**: [list of important files]
- **Spec**: [SPEC-ID if linked, or omit]

### [another_module/]
...

## Entry Points
- [file] — [role/purpose]

## Configuration
- [config files and what they control]

## Test Overview
- Framework: [detected framework]
- Coverage: [X specs out of Y have tests]

## Quick Start
[Copy-paste commands from package.json scripts or Makefile]

## Coverage Gaps
[From validation: orphanCodeFiles, specsWithoutTests, specsWithoutCode]
```

## Section Guidelines

### Architecture Overview
- Identify the stack (language, framework, runtime)
- Name the main architectural pattern (MVC, monorepo, microservices, etc.)
- Describe top-level directory organization in 1-2 sentences

### Module Map
- Group by top-level directories (e.g., `src/auth/`, `src/models/`)
- 1 entry per module, not per file
- Link to SPEC-ID from SPEC_MANIFEST.md when a cross-reference exists
- For monorepos: 1 entry per package

### Entry Points
- CLI entry points, main functions, API routers
- Max 5 entries — most important only

### Configuration
- Only non-obvious config files
- Skip `package.json` if the project has a Quick Start section
- Include env vars if documented in `.env.example`

### Test Overview
- Framework name (jest, vitest, bun:test, pytest, etc.)
- Spec coverage ratio from validation data
- Test run command

### Quick Start
- Extract from `package.json` scripts, `Makefile`, `Justfile`, or `README.md`
- Must be copy-paste ready
- Include: install, dev, test, build (when available)

### Coverage Gaps
- List orphan code files (code without any spec reference)
- List specs without test coverage
- List specs without implementation files
- Omit section entirely if no gaps

## Constraints

- Total output < 10K tokens
- If `tokenWarning=true`: shorter descriptions, fewer files listed per module
- Never list files individually when > 50 files — always group by module
- Use relative paths from project root
- No emojis unless project conventions include them
