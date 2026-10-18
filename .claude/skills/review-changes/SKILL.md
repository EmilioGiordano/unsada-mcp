---
name: review-changes
description: Review the current branch or uncommitted/untracked changes against UNSAdA-MCP's quality and security standards, using the reviewer subagents.
---

# Review Changes

Run the project's reviewers against whatever is sitting in the repo: uncommitted and
untracked changes if there are any, otherwise the current branch against `main`. Report a
combined verdict.

This is the automated quality and security pass before the user decides on the merge. It
is a proportionate check, not an exhaustive audit: one pass, no fan-out beyond the agents
listed here.

**This skill does not fix anything. It only reports.**

## Arguments

An optional path, for work living in a git worktree other than the current directory, for
example `/review-changes ../unsada-mcp-wt-downloads`. Pass it through to every agent. With
no argument, they review the current directory.

## Steps

1. Resolve the target directory: the argument if given, otherwise the current directory.
   Do not compute the diff yourself; each agent determines its own target and reports
   which one it used.

2. Launch the agents in a single message so they run in parallel. The prompt carries only
   the target directory: no implementer justification.
   - `Agent({ subagent_type: 'quality-reviewer', description: 'Quality review', prompt: 'Review <target directory> per your instructions and return the required report.' })`
   - `Agent({ subagent_type: 'security-reviewer', description: 'Security review', prompt: 'Review <target directory> per your instructions and return the required report.' })`
   - Only if the change touches `src/moodle/`, `src/session/`, `src/features/downloads.ts`,
     `src/lib/paths.ts`, `src/documents/` or adds a dependency: a second opinion from a
     model family other than the implementer's, run read-only from the target directory,
     for example `codex exec "<prompt>"` or `gemini -p "<prompt>"`. The prompt asks for a
     review of the diff against `AGENTS.md`, reporting concrete defects with file and line,
     and contains nothing else. It sends the diff to that provider, so run it only where
     the user has agreed to that.

3. Wait for all of them. Do not summarize or act on one while another is still running,
   and never predict what a pending agent will say.

4. Present every report, then a combined verdict:
   - Overall **PASS** only if every agent comes back PASS (or PASS / ACCEPTED-RISK).
   - Otherwise **FAIL**, with every blocker and every Critical/High finding pulled into a
     single flat list ordered by severity.
   - Keep each finding's `CONFIRMED` / `PLAUSIBLE` mark visible. A `PLAUSIBLE` finding is a
     lead to check, not a defect to fix on sight.

5. Sanity-check the findings before relaying them. The agents run without reasons, so they
   can flag a deliberate decision as a defect. If a finding contradicts a rule in
   `AGENTS.md`, mark it "conflicts with AGENTS.md: <rule>" and decide it, instead of
   dropping it silently.

6. Do not commit, push, merge or open anything as part of this skill.
