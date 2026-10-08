# Core Agent Rules

- Track project changes and finish implementation tasks by updating documentation, building and validating the userscript, committing the scoped changes and pushing to the configured GitHub upstream. Treat this as standing user authorization unless the current request overrides it. Preserve unrelated changes and verify the remote commit.

# Project workspace

- Before responding or taking action, read and follow the shared rules in `~/Library/Mobile Documents/com~apple~CloudDocs/AI/AGENTS.md`.
- For this project, work directly in `/Users/mikerustia/IdeaProjects/tw2overflow-automation`.
- Do not create or use a separate worktree unless the user explicitly requests one. If a chat starts in a worktree, use the preferred checkout for project reads, edits, builds, and tests.
- Preserve existing local changes when transferring work between checkouts.

## Project skills

- For user-requested documentation, build, commit and push handoffs, use [tw2-publish-changes](.agents/skills/tw2-publish-changes/SKILL.md). The core rules provide standing authorization for its commit and push stages at the end of implementation tasks; follow any explicit override in the current request.
- For debugging, you may control or integrate with the chrome browser and access my tw2 tab.
