---
name: tw2-publish-changes
description: Finish a TW2Overflow change with README and changelog updates, a verified userscript build, a scoped Git commit and a confirmed push when the user requests committing or publishing project changes.
---

# Publish TW2Overflow changes

Use this workflow for changes in this repository. A request to implement or review code alone does not authorize a commit or push; carry out only the stages the user requested. Existing authorization to commit and push covers those stages without another confirmation.

## Checkout and scope

- Follow the project AGENTS.md and shared rules. Work in /Users/mikerustia/IdeaProjects/tw2overflow-automation unless the user explicitly chooses another checkout. A chat's worktree is not the installation checkout.
- Inspect Git status, staged changes, branch, upstream, remotes and recent commit messages. Preserve unrelated local or staged work. Stage an explicit list of task files; do not use blanket staging or discard changes.
- Keep the current branch when the user has not requested a different one. Use the project branch convention if creating a requested branch. Verify the destination from Git configuration rather than assuming a remote or branch.

## Documentation and artifact

- Update README.md around the final behavior: configuration, defaults, usage, persistence and meaningful limitations. Remove claims made obsolete by the change.
- Add or update the current CHANGELOG.md entry with concrete changes and validation. Separate offline tests, UI previews and confirmed game actions. Do not describe previews as successful orders.
- When shipping changed userscript behavior, advance the custom suffix in share/userscript/meta.js while retaining the package version unless a broader version change was requested. Preserve the local/tw2overflow-farming namespace so installation updates the existing script.
- Use the configured package.json build. The standard combined command is npm run make; it includes retained modules and excludes usage_report. Each optional module must own its startup in its module-local init.js; shared startup must not require an excluded module.
- After a successful build, copy dist/tw2overflow.user.js to userscript/tw2overflow-farming.user.js when the task includes updating the distributable. dist is ignored; the userscript copy is tracked.

## Verification

Run from the same checkout, with the final source and artifact:

1. npm run make (includes source lint).
2. Sync the tracked userscript as described above.
3. npm test. Startup tests inspect the tracked userscript, so sync it first.
4. node --check dist/tw2overflow.user.js and node --check userscript/tw2overflow-farming.user.js.
5. git diff --check and git diff --cached --check.
6. Compare the generated and tracked userscripts byte for byte and verify the expected metadata version.

Resolve failures before committing. After a code change, repeat affected checks and rebuild if generated output changed. A documentation-only change need not bump or rebuild an unchanged userscript. Do not submit live game actions merely to finish this workflow.

## Commit and push

- Review both staged and unstaged diffs; confirm the index contains exactly the requested changes, including necessary new modules, tests, documentation and the distributable. Never quietly include unrelated pre-staged files.
- Follow the existing history's concise imperative subject style, for example Add automatic farming presets and resource-aware Recruiter. Use an explanatory body when the change spans modules, and include the shipped version and relevant validation when useful.
- Prefer a commit message file for a multiline body. Commit the reviewed index, then inspect the resulting commit and working status.
- Push to the verified upstream, or an explicit destination the user provided. Do not force-push, amend published history or change upstream configuration unless requested.
- If Git transport lacks authentication, check an available connected GitHub app before asking the user to configure credentials. With verified repository write access and existing publication authorization, create the same blobs/tree through the Git API, verify the tree matches the local commit, and advance the branch without force using the expected old SHA. Server-created commit metadata can produce a different commit ID. Fetch it and align the local branch only if the working tree/index are clean, the tree is identical and the replaced local commit was created by this task; preserve unrelated commits and changes.
- For a non-fast-forward rejection, fetch and inspect divergence. Never overwrite remote commits. Integrate compatible upstream changes when within the user's scope; stop for actual conflicting decisions or missing access. Preserve the local commit if publishing is blocked.
- Confirm the remote branch tip equals the local commit, using git ls-remote or another authoritative Git read. A created commit is not proof that the push succeeded.

## Report

State the shipped version, verified test count, commit hash, pushed branch/destination and any actual remaining limitation. Link the tracked userscript and relevant documentation or skill. Distinguish a ready-to-install artifact from a confirmed installation in the user's browser.
