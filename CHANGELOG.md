# TWOverflow Changelog

## Unreleased — 2026-10-08 (userscript 2.1.500.18)

- **Start/Stop controls:** Remove the Farmer and Recruiter Preview only settings, UI switches and execution branches. Start performs the configured actions; Stop/Pause cancels further work. Retain existing resource, troop, target and pending-order protections.
- **Previews:** Show manual and automatic farming candidates, selected packets, capacity, travel and hourly estimates without starting Farmer. Refresh saved-setting previews every five seconds while its panel is open, keeping preview targets and packets separate from active cycles. Retain plan details in live attack logs. Recruiter previews targets, queues, reserves, building costs and batches while stopped, on settings changes and while its panel is open; retain plans while running. Close panels to cancel preview polling. Builder and Deposit Planner retain their existing previews.
- **Migration:** Delete obsolete saved flags from defaults and village profiles. Pause previously running preview sessions on upgrade, preserve saved live runs and explicit pauses, and retain settings and pending guards.
- **Agent rules:** Add standing authorization to track changes, complete documentation/build/validation, commit scoped changes and push to GitHub at task completion. Update the project publication skill to follow that authorization and preserve unrelated local changes.
- **Validation:** All 262 offline tests pass against the synced userscript, including stopped previews, Start/Stop behavior, panel polling cleanup, active-cycle isolation, migration and pending-order guards. Combined build/source lint, both userscript syntax checks, bundled startup dependencies, generated/tracked artifact comparison and diff checks pass. No live game orders submitted; browser installation and live rendering remain unverified.

## Unreleased — 2026-10-08 (userscript 2.1.500.17)

- **Daily Popups:** Add a separate module with its own menu, Start/Pause control, saved world/character settings and session status/counters. Start automatically on first use; restore an explicit pause independently of AutoQuest. Watch every two seconds and after window changes, including popups present at startup or appearing after daily rollover.
- **Daily login:** Select today's reward when another day is selected and invoke the native free claim control. Skip claimed, malformed, hidden and disabled controls. Defer clicks during Angular updates and retain ambiguous claim guards across pause/resume instead of retrying; the claim counter records requests rather than confirmed rewards.
- **Advertisements:** Close native promotional interstitials and submit only the new matching Dismiss confirmation created by that advert. Leave purchases, ordinary shop screens, pre-existing confirmations and other game windows alone. Handle stacked adverts one at a time; pause or disabling adverts prevents a scheduled dismissal submission.
- **Validation:** All 256 offline tests pass, including 23 Daily Popups regressions for rollover, current-day selection, pending guards, stacked windows, confirmation ownership, manual cancellation, saved flags, independent startup and panel controls. Source lint, userscript syntax, bundled dependencies, generated/tracked artifact comparison and diff checks pass. Inspected the current public game controllers/templates; the open Chrome session had no matching popup. Installation and live reward/ad dismissal remain unverified; no game actions were submitted.

## Unreleased — 2026-10-08 (userscript 2.1.500.16)

- **Private storage:** Route all Lockr persistence through Tampermonkey's synchronous storage APIs and retain character/world namespaces. Keep the privileged storage helper out of the game's module registry and request the JavaScript sandbox needed for page integration.
- **Migration:** Copy and verify owned localStorage entries across saved worlds/characters before removing them. Preserve conflicting legacy values as private backups; retain original data and stop startup on storage failures. Never fall back to page storage or remove unrelated game entries. Preserve settings, logs, running states, command queues and pending-order guards.
- **Privacy limits:** Added UI, game integration, runtime settings and automation remain observable. Tampermonkey's JavaScript sandbox can fall back to page context in Chrome and does not guarantee isolated execution. Installation and live migration remain unverified.
- **Validation:** All 233 offline tests pass, including 20 private-storage regressions for reloads, namespace isolation, migration, conflicts, copy/removal failures, pending-guard preservation and fail-closed bundled startup. Source lint, userscript syntax, generated/tracked artifact comparison and diff checks pass. No live game orders were submitted.

## Unreleased — 2026-10-07 (userscript 2.1.500.15)

- **Builder sequences:** Extend automatic name matching to every saved building sequence. Add **Save as new sequence** for current edited steps while preserving the original. Trim names, reject case/space-equivalent duplicates and reserved object keys, and preserve the shared sequence library across reloads. Creating a sequence opens its editor without saving unrelated village drafts or changing the active village sequence.
- **Label confirmation:** Reuse the existing confirmation modal when renamed or additional village labels suggest a different matching sequence. Show the village, label, proposed sequence and current sequence. **Use sequence** saves a manual choice for that village; **Keep current** and closing the dialog retain the existing sequence. Prevent automatic switching while confirmation is pending. Keep initial mapping/role/name priority, but offer a new matching label even when an existing label has higher priority. Queue affected villages, remember declined changes, preserve pending prompts across reloads, and discard stale offers after label removal, proposed-sequence deletion or explicit choice changes. Confirmations also work with the Builder window closed.
- **Validation:** All 213 offline tests, source lint, userscript syntax, startup dependencies, generated/tracked artifact comparison and diff checks pass. Regressions cover named sequence creation/editing, persistence, duplicates, rename/addition prompts, acceptance/cancellation/close, manual choices, village isolation, multiple and stale prompts, unrelated label edits, sequence deletion and execution before confirmation. No live building orders were submitted; browser installation and live modal rendering remain unverified.

## Unreleased — 2026-10-07 (userscript 2.1.500.14)

- **Deposit Planner:** Default to a configurable fixed forecast of 850 resources per reroll. Skip history collection, simulations and percentage gates in fixed mode, so a historical 0% result cannot block a supported resource plan. Show the forecast total across usable items, next milestone, target coverage and rerolls needed. Collect useful visible errands first, reroll one board at a time and recalculate actual rewards. Keep item reserves, cycle limits, pending guards, early-reroll capability checks and actual errand deadlines. Retain history mode as an option and preserve the configured target during lower-milestone fallback.
- **Validation:** All 203 offline tests, source lint, userscript syntax, startup dependencies, artifact comparison and diff checks pass. Regressions verify bypassing history and percentage checks, resource arithmetic, lower milestones, visible rewards, reserves, limits, reset buffers, running-job capability, one pending inventory request and recalculation from confirmed board/inventory changes. Browser installation and live fixed-mode rerolls remain unverified.

## Unreleased — 2026-10-07 (userscript 2.1.500.13)

- **Deposit Planner:** Add a persistent information or warning box when the current plan advises keeping reroll items. Explain target coverage, collection, free resets, timing, pending confirmations, inventory reserves, cycle limits, learning and forecast confidence, improvement or item-value checks. Update the notice with current saved settings; hide it when rerolling is recommended.
- **Validation:** All 197 offline tests, source lint, userscript syntax, startup dependencies, generated/tracked artifact comparison and diff checks pass. Notice regressions cover exact target coverage, inventory and cycle constraints, learning, confidence, improvement, item value, pending guards, reset timing, running errands, lower milestones and live window updates without game actions. Ship 2.1.500.13 with the merged deposit controls and independent Second Village module. Browser installation and live actions with this version remain unverified. Preserve the pre-existing local userscript in dist/tw2overflow-before-2.1.500.13.user.js before syncing the tracked distributable.

## Unreleased — 2026-10-07 (userscript 2.1.500.12)

- **Deposit Planner:** Merge the Collector deposit helper into one Start/Pause control for planning, starting, collecting and optional inventory rerolls. Remove the Preview only switch; forecasts keep refreshing while paused. Preserve unresolved pending guards across Start and reload, and allow confirmed game updates to reconcile them while paused.
- **Second Village:** Give Second Village its own menu and Start/Pause control for starting jobs and collecting rewards. Its saved state remains independent of Deposit Planner.
- **Migration:** Preserve explicit pauses and Second Village preferences. Resume old automatic planner sessions, pause old preview sessions, and transfer Collector-only deposit sessions with item rerolls off. Apply migration once.
- **Validation:** All 190 offline tests pass against the freshly generated userscript, including module startup dependencies, settings migration, pending guards, paused forecasts, and independent Second Village starts and reward collection. Source lint, userscript syntax and diff checks pass. Preserve existing local edits to the tracked userscript; the ready-to-install build is available in dist/tw2overflow.user.js. Installation and live actions with this merged version remain unverified.

## Unreleased — 2026-10-07 (userscript 2.1.500.11)

- **Deposit Planner:** Repair Collector handover by listening on the game's EventQueue for module control events. Keep Angular listeners for server deposit events. Avoid a false Start error when saving settings has already resumed the planner.
- **Validation:** Add independent event-channel regression coverage for preview, pause, restart with preview and automatic rerolls disabled, confirmed handover, errand startup and Collector takeover. Add UI regressions for disabled flags and avoiding duplicate starts. Live installation and game orders remain unverified. Preserve existing local edits to the tracked userscript; the new build is available in dist/tw2overflow.user.js.

## Unreleased — 2026-10-07 (userscript 2.1.500.10)

- **Recruiter:** Fill available queue slots during one interval, splitting troop deficits into capped batches in configured unit priority. Confirm each preceding order and fresh resources before the next send. Share one interval spending budget across all batches, recheck current protections and deficits, and cancel continuation on pause, settings changes or rejection. Keep village resource budgets independent. Preview shows every planned batch.
- **Validation:** All 179 offline tests, source lint, userscript syntax, startup dependencies, artifact comparison and diff checks pass. New regressions cover multiple confirmed batches before the configured interval, aggregate spending with replenished stock, queue limits and freed slots, external spending and population changes, shared Builder spending, preview priorities, village isolation, pause and rejection. Installation and live recruitment remain unverified.

## Unreleased — 2026-10-07 (userscript 2.1.500.9)

- **Recruiter:** Replace the non-rendering pending-order recovery modal with an inline confirmation. Clear only the checked village while paused, cancel safely, and remove stale plans after recovery. Keep ambiguous order guards until the game has been checked.
- **Validation:** All 169 offline tests, source lint, userscript syntax, startup dependency, generated/tracked artifact and diff checks pass. Controller regressions cover confirmation, cancellation, village isolation, duplicate confirmation, and guards changing during recovery. Live inspection found an old pending one-spearman order blocking actual mode, with an empty native barracks queue. Browser policy blocked the extension editor, so installation and actual recruitment remain unverified.

## Unreleased — 2026-10-07 (userscript 2.1.500.8)

- **Village profiles:** Save Recruiter targets, resource budgets, protections, spending limits and enablement per village. Save Builder sequence choice, reserves, farm priority and enablement per village. Keep existing settings as shared defaults; remove a profile to inherit them again.
- **Builder roles:** Add editable Offensive, Defensive and Resource sequences, automatic village-label selection, ordered custom label mappings and manual overrides. Preserve saved sequence edits and migrate role presets once.
- **Dynamic Builder:** Add optional capacity/population priorities and affordable later-sequence detours during long waits, with a main-step delay budget, resource level/cycle limits and draft preview. Read live game fields for production, duration, population and storage.
- **Builder:** Preserve per-village reserves on fallback farm upgrades and apply village/group selection to building-change callbacks. Persist shared sequence-library edits through copied settings.
- **Deposit Planner:** Add approximate chance bands from whole-board history resampling and simulation uncertainty, cautious automatic reroll thresholds, incremental expected progress per item and a configurable item-value minimum. Learn confirmed automatic start/collection overhead without reducing the configured floor. Add advance lower-milestone projections while the last errand runs, with per-milestone ETA and item cost, plus an opt-in highest supported attainable milestone fallback that preserves the saved target and target holding. Show collected-plus-running totals and permit a guarded early item reroll only for Nothing-to-do with the last errand running; retain the pending guard if the running job disappears. Verify the native enabled button and official client reroll capability without submitting orders. Cache exact subset totals to keep larger reroll budgets responsive. Exclude running errands that cannot be collected before either reset buffer from forecasts.
- **Validation:** All 167 offline tests, source lint, userscript syntax, startup dependency and generated/tracked artifact checks pass. Controller harnesses verify profile switching, save/reopen, label changes, manual overrides and dynamic draft previews without orders. Live read-only inspection confirms production rates, upgrade durations, storage and population fields; no live recruitment, building or deposit orders submitted.

## Unreleased — 2026-10-07 (userscript 2.1.500.7)

- **Deposit Planner:** Replace generic settings errors with the specific invalid setting and its permitted range, show inline errors, and clear them when edited. Expand Desired forecast success to 10–100% while retaining its 95% default. Reject invalid settings in both preview and automatic modes without saving or starting.
- **Validation:** Add UI-controller regression coverage for preview Start, boundary values, invalid numeric models and recovery after correcting a field. All 105 offline tests, source lint, userscript syntax and artifact checks pass. Verify 20% and the 10% boundary start successfully, and 9% reports the allowed range in an offline Angular UI harness. No live game orders were submitted.

## Unreleased — 2026-10-07 (userscript 2.1.500.6)

- **Deposit Planner:** Add a separate configurable module with reset countdowns, exact visible-board scheduling, empirical item-reroll/waiting forecasts, completion estimates, target holding, item reserves and Collector coordination. Preview is enabled and item rerolls disabled by default; automatic rerolls use inventory items only.
- **Persistence:** Restore Deposit Planner, AutoMinter, AutoSpyRecruiter and Commander running/paused state. Split Collector and Second Village persistence while preserving legacy preferences. Guard duplicate initialization and rejected restored starts.
- **Recruiter:** Fix actual recruitment immediately pausing on confirmed orders: accept authoritative queue events or matching new queue jobs when callbacks omit the job, and accept fresh server resource snapshots when production replaces a debit. Recover matching dated legacy guards; preserve ambiguous pending orders. Old order timeouts cannot stop preview runs.
- **Project workflow:** Add the reusable tw2-publish-changes skill for documentation, artifact verification, scoped commits and confirmed pushes, with project discovery instructions.
- **Validation:** Add exact-selection oracle, forecasting, deadline, reroll-budget, guard, reload, migration and Recruiter transition tests. All 101 offline tests, source lint, userscript syntax and dependency checks pass. Verify the planner template and controls in an offline Angular UI harness. Build and ship the combined userscript as 2.1.500.6. No live automation orders were submitted during these checks.

## Unreleased — 2026-10-07 (userscript 2.1.500.5)

- **Running state:** Farmer, Recruiter, and custom-build BuilderQueue restore their saved running/stopped state after page refresh, after initialization and UI setup. Rejected restored starts clear stale active flags.
- **Build:** Include BuilderQueue and retained upstream modules in the standard build, matching the expanded local build configuration, while excluding the legacy usage-report module. Rebuild the distributable userscript as version 2.1.500.5.
- **Settings:** Saving changed settings restarts running Farmer, Recruiter, BuilderQueue, AutoQuest, AutoMinter, and AutoSpyRecruiter with their new configuration. Stopped modules stay stopped; recruitment pending-order guards survive restarts. BuilderQueue refreshes its active sequence limits and invalidates callbacks from previous runs.

- **Startup:** Remove unconditional optional-module initialization so Farmer, Recruiter, and AutoQuest builds start without BuilderQueue.

- **Farmer:** Added configurable automatic local presets based on nearby barbarians, available troops, reserves, packet limits, and carrying capacity, with packet previews.
- **Recruiter:** Added per-village barracks troop targets, queued-soldier accounting, protected resource savings, building budgets, population and spending limits, and preview mode.
- **Spending:** Added a shared in-flight resource guard for Recruiter and custom builds containing BuilderQueue, plus persisted recruitment guards for uncertain server responses.
- **AutoQuest:** Included the existing quest module and fixed the reward flow to open unread quest lines, select completed tasks marked with the exclamation icon, and then claim their rewards.
- **Build:** Updated the userscript to include Farmer, Recruiter, and AutoQuest; fixed template output directory creation for modules without stylesheets.
- **Documentation:** Consolidated feature descriptions, configuration, limitations, build instructions, and upstream references into README.md while retaining this changelog.
- **Validation:** Added offline regression coverage for automatic presets, recruitment budgets and lifecycle guards, shared building spending, and quest task selection. Live previews verified automatic packet generation, farming plans, resource savings, and next-upgrade reserves; actual sends and a fresh quest reward claim remain unverified.

## 2.0.0

*soon*

 - **FarmOverflow:** Added setting to allow targets to receive attacks only from one village.
 - **FarmOverflow:** Added setting to allow targets to receive only one attack per village.
 - **FarmOverflow:** Added minimum interval between commands on the same target.
 - **FarmOverflow:** Added tab to show farmers, ignore/included targets.
 - **FarmOverflow:** Now you can select multiple presets to use as farm.
 - **FarmOverflow:** Added setting to limit the amount of targets for each farm village.
 - **FarmOverflow:** Now a timer for the next cycle is shown.
 - **FarmOverflow:** Fixed "Not units enough" notification errors.
 - **FarmOverflow:** Abandoned targets that gets conquered by some noob is now properly detected.
 - **FarmOverflow:** Fixed step cycle mode showing "attacking" status when waiting the next cycle.
 - **FarmOverflow:** Fixed farm gettings stuck on "Full storage" even after use resources.
 - **FarmOverflow:** Fixed village last status showing "Attacking" after stopping the farmer.
 - **FarmOverflow:** Fixed bug where some commands were being sent with less units than specified on presets.
 - **FarmOverflow:** Fixed bug where opening the window before the preset list load causing the preset input list to never show up.
 - **Minimap:** The entire minimap is now loaded at once.
 - **Minimap:** Show a rect with the current map view instead of a simple cross.
 - **Minimap:** Only draw province demarcations where villages are available.
 - **Minimap:** Minimap can only be dragged where villages are available.
 - **Minimap:** Minimap gets centered to the current view when opening it.
 - **Minimap:** Added setting to change minimap village's size.
 - **Minimap:** Current minimap mouse position is highlighted on map.
 - **Minimap:** Province and continent borders can now be disabled/enabled separately.
 - **Minimap:** Massive performace improvement.
 - **BuilderQueue:** Added setting to preserve resources.
 - **BuilderQueue:** Added setting to priorize the building farm if it's full.
 - **BuilderQueue:** Added pagination to building sequence lists.
 - **BuilderQueue:** Added preview of the sequence with building levels/costs on bottom of the window.
 - **BuilderQueue:** Added capability to add/remove/move buildings in sequences.
 - **BuilderQueue:** Added capability to create/delete entire building sequences.
 - **BuilderQueue:** Added logs view.
 - **BuilderQueue:** Added instant build job finish.
 - **BuilderQueue:** Initial building sequence "Essential" is shuffled for every new user to avoid bot detection by use pattern.
 - **BuilderQueue:** Village names on logs aren't hard coded anymore.
 - **CommandQueue:** Fixed travel times with effects being calculated the same as no effect.
 - **CommandQueue:** Fixed some units on travel time calculator not showing as valid time travel even though the time travel was valid.
 - **CommandQueue:** Fixed commands diplaying the wrong send date.
 - **CommandQueue:** Remember last selected date type. #
 - **CommandQueue:** The last date type selected is now remembered next time the window is open.
 - **AttackView:** Added pagination.
 - **AttackView:** Added sorting and filtering to commands.
 - **AutoCollector:** Fixed second village not being finished after all jobs were completed.
 - **AutoCollector:** Fixed collector trying to build second village before it's spawned.
 - **Misc:** Interface now uses the game's native system.
 - **Misc:** Changed disable button color from green to orange.
 - **Misc:** Module buttons are now a sub-menu inside a central menu.
 - **Misc:** Notifications now are replaced instead of queued.

## 1.0.7

*26/06/2018*

 - **BuilderQueue:** [Added] Highlight reached building levels for the selected villages on build order list.
 - **BuilderQueue:** [Added] Highlight queued buildings for the selected village on build order list.
 - **BuilderQueue:** [Added] Persistent logs.
 - **BuilderQueue:** [Added] Show build duration/price for each building level on building order list.
 - **BuilderQueue:** [Added] Make villages name on logs a link to the village profile.
 - **BuilderQueue:** [Updated] Remove stripped table colors.
 - **BuilderQueue:** [Fixed] Build log showing queue start date instead of creation date.
 - **BuilderQueue:** [Fixed] Interface bottom buttons showing only under the settings tab.
 - **BuilderQueue:** [Fixed] PT_br typos
 - **BuilderQueue:** [Fixed] Already reached levels are not updated when changing the building order preset.
 - **AttackView:** [Added] Improve filters interface, separate by category.
 - **AttackView:** [Added] Add slowest unit filter.
 - **AttackView:** [Added] Add local filter system.
 - **AttackView:** [Added] Add sort system.
 - **AttackView:** [Fixed] Arrival time showing a different format when the window is opened.
 - **Minimap:** [Added] Allow edition of existing highlights.
 - **Minimap:** [Added] Easy add highligh by right clicking the hover village.
 - **Minimap:** [Added] Make the highlights name/icon a hotlink to the item profile.
 - **Minimap:** [Fixed] Make the highlights name/icon a hotlink to the item profile.
 - **AutoCollector:** [Fixed] Collector trying to finish job when the initial villages is not ready yet.
 - **CommandQueue:** [Added] Button to clear unit/officer inputs.
 - **CommandQueue:** [Added] Option to choose and insert army preset to the unit/officer inputs.
 - **CommandQueue:** [Fixed] Travel times table not showing stripped td colors.
 - **CommandQueue:** [Fixed] Tooltip not hiding when removing waiting commands.

## 1.0.6

*10/06/2018*

 - **BuilderQueue:** [Added] Automatic build system (BuilderQueue).
 - **AttackView:** [Fixed] Backtime copy command.
 - **Minimap:** [Fixed] Working for players without tribe.
 - **Minimap:** [Updated] Increased load map area when moving by clicking the minimap.
 - **AutoCollector:** [Fixed] Second Village collector refactor, no more error notifications.
 - **CommandQueue:** [Fixed] Sent/not sent command notifications working as expected.
 - **CommandQueue:** [Fixed] Commands using * as unit amounts no longer try to send when there are no units avaiable.
 - **CommandQueue:** [Removed] Quick view when hovering the opener button.
 - **FarmOverflow:** [Updated] Forced minimum interval between attacks.
 - **FarmOverflow:** [Fixed] Sending two attacks at the same time on continuous mode.
 - **FarmOverflow:** [Fixed] Some translation keys.
 - **FarmOverflow:** [Removed] Quick view when hovering the opener button.

## 1.0.5

*05/06/2018*

 - **AttackView:** [Added] Incoming commands overview system (AttackView).
 - **Minimap:** [Added] Cache to draw villages from previously loaded maps.
 - **Minimap:** [Fixed] Tooltip not hiding when mouse leave the minimap container.
 - **Minimap:** [Fixed] Minimap size on different monitor sizes.
 - **Minimap:** [Fixed] Minimap don't keep draggin after mouse leave the minimap container.
 - **Minimap:** [Updated] Color picker palette colors changed.
 - **Minimap:** [Added] Color indicator of the current selected color.
 - **Minimap:** [Fixed] Hovering villages on minimap are more precise with the mouse cursor.
 - **Minimap:** [Updated] Removed overlay cache.
 - **CommandQueue:** [Fixed] Units input background base64 image.
 - **CommandQueue:** [Fixed] Attack commands with catapults being added without a building target (via headless CommandQueue).

## 1.0.4

*31/05/2018*

 - **Minimap:** [Added] Minimap system.
 - **AutoCollector:** [Updated] Renamed to AutoCollector.
 - **AutoCollector:** [Fixed] No more error notifications while active.
 - **AutoCollector:** [Added] Persistent mode, will keep activated after reloading the page.
 - **CommandQueue:** [Updated] Open Button text changed to "Commander"
 - **CommandQueue:** [Added] Origin/target villages can be selected via search by name.
 - **CommandQueue:** [Fixed] Command icons size on Firefox.
 - **CommandQueue:** [Fixed] Officers not being used when calculating travel times.
 - **CommandQueue:** [Fixed] Relocate commands on Waiting Commands tab showing the support icon.
 - **CommandQueue:** [Updated] Add Commands tab redesigned, more compact.
 - **CommandQueue:** [Updated] Keept only analytics about commands.
 - **FarmOverflow:** [Updated] Open Button text changed to "Farmer"
 - **FarmOverflow:** [Removed] Info Tab, infomations are now available only via wiki.
 - **FarmOverflow:** [Fixed] Ignore Full Storage setting now works as expected.
 - **FarmOverflow:** [Fixed] Incoming attacks are not counted as own commands anymore.
 - **FarmOverflow:** [Fixed] Recruited or added troops via items are now detected.
 - **FarmOverflow:** [Fixed] Creating new presets already selected by the farm (while running) are now properly detected.
 - **FarmOverflow:** [Fixed] Group selecting options display "Disabled" properly after manually disabling it.
 - **FarmOverflow:** [Fixed] Setting Commands Limit are now detected when changed while the farm is running.
 - **FarmOverflow:** [Fixed] Step Cycle running twice in some cases.

## 1.0.3

*30/04/2018*

 - **CommandQueue:** [Fixed] Waiting commands shows the corrct send/arrival datetime.
 - **CommandQueue:** [Fixed] Scrollbar no longer start in the tabs area.
 - **CommandQueue:** [Fixed] Translation texts.
 - **FarmOverflow:** [Added] Periodically reload targets information to check conquered villages.
 - **FarmOverflow:** [Fixed] Scrollbar no longer start in the tabs area.
 - **FarmOverflow:** [Fixed] Icons size on Firefox.
 - **FarmOverflow:** [Fixed] Translation texts.

## 1.0.2

*02/02/2018*

 - **CommandQueue:** [Fixed] Catapults not hiting the selected building.

## 1.0.0

*09/10/2017*

 - Initial release
