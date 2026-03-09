---
name: Generate Tests
description: "Generate focused automated tests for selected code or a target file."
argument-hint: "Target + framework + constraints (e.g., src/lib/math.ts, vitest, edge cases first)"
agent: agent
---
Generate automated tests for the provided target.

Requirements:
- Treat the user argument as the source of truth for target, framework, and constraints.
- If the argument is incomplete, auto-detect from the repository (existing test framework, file naming conventions, helpers).
- Preserve current behavior; do not change production code unless required for testability, and explain any required change first.
- Prioritize a mixed strategy: mostly unit tests with targeted integration tests where interaction risk is high.
- Cover happy paths, edge cases, and failure modes.
- Prefer concise, readable test names and deterministic assertions.
- Reuse existing test utilities and patterns in the project.
- If expected behavior is ambiguous, ask for confirmation before writing implementation.

Output format:
1. "Assumptions" with any inferred choices.
2. "Test Plan" listing scenarios to cover.
3. "Proposed Files" with exact paths.
4. "Implementation" with complete test code.
5. "Run Instructions" with exact command(s).

Quality bar:
- Avoid placeholder tests.
- Avoid brittle timing-based assertions unless unavoidable.
- Keep tests minimal but meaningful.
