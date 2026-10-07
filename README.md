# TW2Overflow Automation

Automate farming, maintain troop targets without spending protected resources, and collect completed quest rewards in Tribal Wars 2. This customized userscript provides five primary automation modules:

| Module | Features |
| --- | --- |
| **Farmer / FarmOverflow** | Barbarian farming, automatic local troop presets, travel and target filters, troop reserves, cooldowns, attack limits, and preview logs. |
| **Deposit Planner** | Deposit countdowns, exact visible-errand selection, waiting/item-reroll forecasts, target ETAs, item reserves and configurable automation. |
| **Recruiter** | Barracks troop targets, queued-soldier accounting, savings, building budgets, population limits, spending caps, and recruitment previews. |
| **Builder / BuilderQueue** | Building sequences, resource reserves, automatic upgrades, and build logs. |
| **Quest / AutoQuest** | Open marked quest lines, select completed tasks to reveal rewards, collect them, and close the quest panel. |

This README is the feature and setup guide. [CHANGELOG.md](CHANGELOG.md) tracks change history.

## Installation and first use

1. Download [tw2overflow-farming.user.js](userscript/tw2overflow-farming.user.js) using GitHub's **Raw** or download button, then install it in your userscript manager.
2. Disable other TW2Overflow copies and old `tw2tools` auto-start wrappers to avoid running multiple versions together.
3. Open Tribal Wars 2 and use the TW2Overflow menu to configure each module.
4. Keep **Preview only** enabled in Farmer, Recruiter and Deposit Planner while reviewing their plans. Start each module separately when ready.
5. For live farming or recruitment, pause, disable **Preview only**, save, and start again. Quest collects rewards directly after you press Start.

The checked-in userscript includes Farmer, Recruiter, BuilderQueue, AutoQuest, Deposit Planner, shared infrastructure, and the retained modules listed below. It excludes the upstream usage-report module, does not contact the old tracking endpoints, and disables upstream automatic updates. Its namespace remains `local/tw2overflow-farming` so installing a new version updates the same custom script.

Farmer, Recruiter and Deposit Planner default to preview mode. Farmer, Recruiter, Builder, AutoQuest, Deposit Planner, AutoMinter and AutoSpyRecruiter start stopped on first use and restore their saved running or stopped state after reload. Collector and Second Village save their states independently; existing Collector users inherit the previous shared state once. Commander restores an explicit pause even when commands are queued; a legacy queue without a saved flag retains its previous automatic start behavior. Saving changed settings while a module is running restarts it with the new settings; saving while stopped leaves it stopped. AutoMinter and AutoSpyRecruiter also restart on settings changes when running. Other scripts, forks, and upstream downloads can have different behavior.

## Deposit Planner

Open **Deposit Planner** to inspect progress, the free errand reset, the milestone reset, current completion time, planned collection times and target reward. The default target of **0** selects the final milestone, including Bountiful Harvest when offered by the game. Keep preview enabled initially; it does not start, collect or reroll errands.

The planner examines every subset of the visible errands. It chooses the greatest reward that can be collected before both resets, with the shortest completion time breaking ties. When the visible board reaches the target, the displayed ETA follows this exact selection. Durations and rewards come directly from the game, including active bonuses.

Future boards are unknown. The planner learns complete six-errand boards and runs repeatable empirical simulations to compare continuing, waiting for a free reset and using inventory reroll items. It prefers fewer items when the desired modeled success rate is reached, and requires a configurable improvement before rerolling immediately. These forecasts are approximate; median and 90th-percentile ETAs describe successful simulated runs, not guarantees or a globally optimal future strategy. Until enough matching boards are observed, it collects useful visible errands and waits rather than spending reroll items.

| Setting | Default |
| --- | --- |
| Preview only / automatic item rerolls | On / off |
| Target progress | 0 (final milestone) |
| Maximum item rerolls per milestone cycle / items to preserve | 3 / 1 |
| Prefer free reset within | 10 minutes |
| Buffer before each reset / estimated overhead per errand | 60 seconds / 2 seconds |
| Desired modeled success / minimum gain to reroll now | 95% / 5 percentage points |
| Complete matching boards required / refresh interval | 5 / 30 seconds |
| Hold completed errands after reaching the target | On |

Invalid settings are named in the notification and beside the field. For example, **Desired forecast success (%)** accepts whole numbers from **10 to 100** (default **95**); 20 is valid, while a value of 9 prevents Save and Start in both preview and automatic modes. Correcting a value clears its field error. Preview mode uses the same settings validation as automatic mode.

Enable **Allow automatic item rerolls** while keeping preview on to review forecasts. Pause, turn preview off, save and start to execute the plan. Rerolls use the inventory item route; the planner never purchases rerolls with Crowns. Samples are retained for up to 30 days, matched to village and bonuses, and capped at 60 boards. Repeated polling of one board does not add samples.

Automatic deposit control pauses Collector's deposit helper; Second Village continues independently. Starting Collector pauses an active automatic planner. The planner persists settings, running state, observed boards, used/reserved reroll budget and pending requests. An uncertain response pauses automation and blocks retries across reloads. Use **Resolve after checking game** only after checking the errand, progress and inventory; clearing a guard keeps its reroll budget charged. After reaching the target, the planner waits for the next milestone cycle, holding completed rewards when configured.

## Builder

Open **Builder**, choose an active building sequence and village group, configure resource reserves, then press Start. Builder follows the sequence while respecting available queue slots and the shared recruitment spending guard. It restores its running state after refresh. Saving changed settings cancels its old timers, refreshes the active sequence limits, and starts a new run if it was running. An unavailable active sequence leaves it stopped.

## Farmer

Farmer checks each village's available troops and eligible targets, selects an affordable preset, and plans or sends an attack. Manual game presets and automatic Farmer-local presets can be used together.

### Configure and preview

1. Select manual farming presets, enable automatic presets, or use both.
2. Choose the farmer village groups, ignored and included target groups, distance and points ranges, target-count limit, and maximum travel time.
3. Configure troop reserves, preserved command slots, storage checks, same-target arrival spacing, attack caps, and report cooldowns.
4. Keep **Preview only** enabled, start Farmer, and review planned targets, selected presets, capacity, travel time, and hourly rate estimates in its logs.
5. Adjust settings, then disable preview and restart when ready to send attacks. Saving changed settings restarts Farmer if it is running.

Preview reads game data and records planned attacks, but sends no attacks and assigns no game presets.

### Automatic farming presets

Enable **Create automatic farming presets**, select the allowed unit types, and set minimum/maximum soldiers per packet and desired carrying capacity. Use **Save and preview packets** to see each village's nearby barbarian count, packet composition, and capacity.

At the start of each village cycle, Farmer divides troops in town after reserves across nearby barbarian targets, bounded by command slots and the cycle attack limit. It proposes small, larger, and capacity-sized packets for each allowed unit kind. Each packet contains one unit kind to keep its travel speed predictable.

Packet sizes cannot exceed available troops or the configured maximum. If a packet cannot reach the configured minimum, it is skipped. Desired capacity is rounded to a whole soldier. Existing distance, points, target-count, and travel-time filters still apply.

| Automatic preset setting | Default |
| --- | --- |
| Enabled | Off |
| Allowed unit kinds | Spearmen, axemen, light cavalry |
| Minimum soldiers per packet | 5 |
| Maximum soldiers per packet | 100 |
| Desired carrying capacity | 1,000 |

These presets belong to Farmer and refresh each village cycle; they are not saved in the game's native preset list. Generated packets apply only to barbarian targets and use the custom-army route. You can start Farmer with no manual presets selected when automatic presets are enabled. Selected manual presets remain candidates, so deselect them to use only generated packets.

Carrying capacity describes loot space, not defenders. Automatic packet sizing does not estimate battle losses or guarantee a safe attack.

### Target selection and scoring

Farmer examines every affordable preset. By default, it ranks them using:

```text
score = expected haul / round-trip travel time
expected haul = carrying capacity
             or min(carrying capacity, configured target loot estimate)
```

Set **Estimated loot per target** to a positive amount when you want to avoid preferring oversized armies solely for their capacity. A value of `0` means unknown loot. Disabling capacity optimization prefers shorter travel times.

The game calculates travel time using the barbarian, officer, and effect flags. The travel limit compares milliseconds with milliseconds. Capacity or estimated loot per hour is an estimate, not measured loot or a guarantee of globally optimal farming. Target regeneration and defender strength are not modeled by this scoring rule.

### Reserves, filters, and cooldowns

- **Barbarians only** rejects player-owned and unknown-owner villages even when an include group contains them.
- **Troop reserves** retain a configured percentage of each unit kind in town. Preset affordability is checked again before sending.
- **Preserved command slots** leave room for other commands. Farmer also limits attacks per village per cycle.
- **Storage checks** can pause a village whose storage is full.
- **Ownership, points, protection, cooldown, and command checks** run before sending. Cached map data can be stale; the server remains authoritative.
- **Arrival spacing** uses local and server-loaded incoming attacks. Unknown arrival timestamps prevent another attack while spacing is enabled. Same-farmer and other-farmer restrictions are both considered.
- **Report cooldowns** rest a target after an empty haul or casualties/defeat. They persist separately per world and character and expire automatically. Only reports observed while the script is loaded are recorded; old reports are not imported. Ignore groups can still permanently exclude targets.

Shared map entries are not modified when calculating distances. Duplicate targets are removed, and removing one target does not skip its successor.

### Timing and stopping

| Setting | Default |
| --- | --- |
| Attack interval | 2 seconds |
| Maximum extra attack delay | 1 second |
| Cycle interval | 5 minutes |
| Maximum extra cycle delay | 30 seconds |
| Same-target arrival spacing | 5 minutes |
| Target score variation | 5% |
| Empty-haul cooldown | 20 minutes |
| Loss cooldown | 24 hours |
| Maximum attacks per village per cycle | 50 |
| Preserved command slots | 5 |

Delays equal the base interval plus a random amount from zero to the configured extra delay. Variation never subtracts from the base interval, and both base intervals have a minimum of one second. Set extra delay to `0 seconds` to disable it.

Target score variation shuffles targets only within bands bounded by that percentage of the band's best score. For example, 5% allows similarly ranked targets to vary while keeping substantially lower-ranked targets behind them. Set it to 0 for deterministic ranking.

Stopping, restarting, or expiring a step invalidates its old callbacks. An unacknowledged attack stops the whole farmer after 30 seconds without an automatic retry; the watchdog also stops rather than restarting. A timeout does not prove rejection. Check outgoing commands before restarting.

UI updates use AngularJS `$evalAsync`, and the cycle countdown uses the actual sampled cycle deadline.

## Recruiter

Recruiter maintains a target army independently of Farmer. Targets apply separately to each selected village. Owned totals include your troops away from home; foreign support is not added. For each unit kind, it deducts the untrained portion of queued jobs from the deficit:

```text
queued soldiers = sum(job amount - soldiers already recruited)
deficit = max(0, target - owned troops - queued soldiers)
```

### Configure and preview

1. Open **Recruiter** and select village groups. Empty selection means all owned villages.
2. Set target counts for the barracks unit kinds shown. A zero target disables that kind. Kinds are considered in the order shown.
3. Set **Wood/Clay/Iron savings** for resources to preserve and reserve free population if needed.
4. Select buildings whose next upgrade you want to fund. Add additional building budgets to save for further upgrades or other spending.
5. Choose the spending share, batch-size cap, queue job cap, and check interval.
6. Keep **Preview only** enabled and start. Review owned and queued troops, deficits, protected resources, building costs, cycle budgets, and proposed batches for each village.
7. Pause, disable preview, save, and start to recruit. Saving changed settings restarts recruitment if it is running, retaining pending-order guards. Each village submits at most one batch per cycle and replans before the next batch.

The first proposed batch is the one a live cycle would submit. Later proposals show the remaining priority order under the same budget.

| Recruiter setting | Default |
| --- | --- |
| Preview only | On |
| Troop targets | All disabled |
| Wood, clay, and iron savings | 5,000 each |
| Free population reserve | 0 |
| Additional building budgets | 0 |
| Spending share | 25% |
| Maximum soldiers per batch | 50 |
| Maximum barracks queue jobs | 5 |
| Check interval | 1 minute; configurable from 10 seconds to 24 hours |

### Resource and building budgets

For each resource:

```text
protected = savings + additional building budget + selected next-upgrade costs
spendable = max(0, current stock - protected)
cycle budget = floor(spendable × spend percentage / 100)
```

Free population uses all remaining unreserved population without the resource spending percentage. Batch size is limited by the deficit, batch cap, wood/clay/iron budgets, free population, barracks level, and queue job cap.

For example, with 20,000 wood, 5,000 savings, a 2,000 additional building budget, and 1,000 wood for selected upgrades, spendable wood is 12,000. A 25% spending limit permits 3,000 wood this cycle. A troop costing 50 wood permits at most 60 soldiers from wood alone. A batch cap of 50 lowers the order to 50; clay, iron, population, or the deficit can lower it further.

Selected upgrades use their computed next-level wood, clay, iron, and population costs from the game model. Already queued buildings and soldiers have been paid for, so their costs are not deducted from current stock again. A selected building with an upgrade in the queue is skipped until that job finishes; after completion, Recruiter reserves the following level. A building at maximum level adds no reserve. Use additional building budgets to save beyond the current queue.

BuilderQueue shares an in-flight spending guard with Recruiter. A pending building or troop spend blocks another spend in that village until acknowledgement and the resource debit are visible. Separate scripts and manual spending are outside the shared guard.

### Pending orders and limits

Recruiter records pending orders separately per world and character, preserving the guard on pause, restart, and reload. It waits for a matching server job plus resource debit before permitting another batch. After 30 seconds without confirmation, it pauses without retrying.

Inspect the game's queue, troop totals, and resources before using **Resolve guard after checking game**. Slow data updates, production overtaking the expected resource debit, or a job finishing before observation can require this manual check.

Recruiter supports barracks recruitment. Academy, statue, and preceptory recruitment, premium spending, building upgrades, and cost modifiers absent from world unit data are outside this module. Missing resources, population, troop totals, costs, or queue data prevent recruitment. Protected budgets govern Recruiter's decisions; they do not prevent other spending.

## Quest / AutoQuest

Open **Quest**, save its settings, and press Start. The module follows the quest UI in this order:

1. Open an unread or finishable quest line from the toolbar.
2. Click a completed task marked with the exclamation/ready-to-finish icon. Selecting the task reveals its reward.
3. Click **Finish Quest** when the selected task is claimable.
4. Select further ready tasks, collect their rewards, and close the game's quest panel when none remain.

AutoQuest skips unfinished, closed, hidden, disabled, and unrelated controls. It waits for task selection to render before continuing and suppresses repeated claims while a claim is pending. Clicks are deferred while Angular is applying updates so they do not nest another digest cycle. Stopping cancels scheduled checks.

The check interval defaults to 30 seconds and supports 5 seconds to 5 minutes. Saved settings and the last running/stopped state persist after reload. Quest collects rewards directly; it has no preview mode and does not perform unfinished quest goals or buy premium actions. Its settings panel and unrelated game windows are left open.

## Compatibility and account considerations

The source has offline tests with mocked game services. Live Chrome preview checks on 2026-10-06 verified module startup, six automatic packet options from 25 nearby barbarians, five planned farming attacks without sending them, and Recruiter troop deficits and protected budgets. With 2,285 of each resource, 1,000 savings, 500 additional building budget, and a 25% spending share, Recruiter proposed three spearmen; reserving the timber camp next upgrade reduced the batch to two. Test settings were restored afterward.

AutoQuest loaded and restored its running state. Its task selector and completion icon were inspected earlier in a live quest panel, but no ready reward was available during the latest check. Actual attack/recruitment submissions and the updated AutoQuest reward sequence remain unverified end to end against the live game. Current game services, AngularJS rendering, costs, and server responses can differ from the assumptions tested offline.

Recruitment integrations follow the repository's game-model conventions, historic [game-message examples](https://gist.github.com/rampadc/d719d60a2e359670808f862712bcb9ae), and the queue model used in [TW2Tools source](https://gist.github.com/wellbritto98/936e5e7ad1e345716baea4932dfd0221).

Game automation can lead to an account ban. Scheduling variation does not establish resistance to detection. Farmer uses game services for preset/custom-army sends; AutoQuest invokes the game's rendered controls. Ordinary JavaScript cannot make `.click()` or `dispatchEvent()` produce `isTrusted=true`. This project does not modify the browser or spoof that flag.

## Build and verification

Use Node.js 22 or later:

```sh
git clone https://github.com/mikerustia416/tw2overflow-automation.git
cd tw2overflow-automation
npm ci --ignore-scripts
npm test
npm run make
node --check dist/tw2overflow.user.js
cp dist/tw2overflow.user.js userscript/tw2overflow-farming.user.js
```

The build writes `dist/tw2overflow.user.js`. The default build runs lint and includes all source modules except the legacy usage-report module, including BuilderQueue. If your npm cache is not writable, configure a writable cache directory when installing dependencies.

Tests load the actual AMD modules and settings class in a mocked environment. Coverage includes travel boundaries, preset scoring and generation, reserves, ownership changes, target deduplication, arrival spacing, cooldowns, cycle caps, recruitment deficits and budgets, protected upgrades, population, queue limits, persisted pending orders, reload restoration, settings-save restarts, timer replacement, stale callback guards, and the quest open → select task → claim → close sequence. These tests do not establish live-game compatibility or detection resistance.

### Project commit and push workflow

Use the project skill [tw2-publish-changes](.agents/skills/tw2-publish-changes/SKILL.md), or invoke `$tw2-publish-changes`, when asking Codex to finish documentation, verify and sync the userscript, commit scoped changes and push them. It follows the existing commit style, preserves unrelated work, and confirms the remote commit. Implementing a change alone does not trigger publication.

### Custom build flags

| Flag | Purpose |
| --- | --- |
| `--only=id1,id2` | Include only the specified module IDs. |
| `--ignore=id1,id2` | Exclude specified module IDs. |
| `--lint` | Check JavaScript source with ESLint. |
| `--minify` | Minify generated JavaScript. |
| `--userscript` | Generate a userscript. |
| `--extension` | Generate a WebExtension package. |

For a smaller build containing only Farmer, Recruiter, Quest, and Builder:

```sh
node make.js --only=farm_overflow,recruiter,auto_quest,builder_queue --userscript --lint
```

For development, modules live in `src/modules/<id>` and declare their ID in `module.json`. Reuse a simple existing module as a starting point. English translation strings live in `src/i18n/en_us/<id>.json`; other locales use the same structure. The retained [developer API reference](share/docs/functions-and-classes.md) documents shared helpers.

## Other bundled modules

The standard userscript also includes these upstream modules:

| Module | Purpose |
| --- | --- |
| CommandQueue | Schedule commands by departure or arrival time. |
| AutoCollector | Collect resource-deposit jobs and automate initial second-village jobs. |
| Minimap | Improve world-map visibility, village colors, and navigation. |
| AttackView | Show and organize incoming commands. |
| AutoMinter | Mint coins periodically. |
| AutoSpyRecruiter | Recruit spies periodically while preserving resources. |

The running-state audit covers all bundled automation controls; passive About, Minimap and AttackView views have no automation run state. Retained upstream modules have their own behavior and have not been fully revalidated for this variant. Use an explicit `--only` list for a smaller build, or keep `--ignore=usage_report` when building all other modules.

## Upstream attribution and history

This source snapshot is based on [relaxeaza/twoverflow](https://gitlab.com/relaxeaza/twoverflow) version 2.1.500, commit `ba49338011f5a6429f07290115dd6a1365540bdb`. Original authorship and the [WTFPL license](LICENCE) are preserved.

The [original upstream README](https://gitlab.com/relaxeaza/twoverflow/-/blob/ba49338011f5a6429f07290115dd6a1365540bdb/README.md) records the upstream installation, contribution, translation, and donation information. Those upstream distributions are separate from this customized userscript. The initial farming implementation is retained as a historical [upstream patch](patches/farming-improvements.patch); it does not include every later change. Subsequent changes are recorded in [CHANGELOG.md](CHANGELOG.md).
