# TW2Overflow farming improvements

This local variant is based on upstream commit `ba49338011f5a6429f07290115dd6a1365540bdb` (version 2.1.500, June 25, 2021). It has been tested with mocked game services, not a live Tribal Wars 2 account. Current game compatibility is unverified.

## What changed

- Preset selection examines every affordable preset and uses the game's travel-time functions with barbarian, officer, and effect flags. The maximum travel limit now compares milliseconds with milliseconds.
- By default, presets are ranked by carrying capacity divided by round-trip travel time. If you supply an estimated loot amount, the numerator becomes the smaller of that estimate and the preset's carrying capacity. This is an estimate, not measured loot or a guarantee of globally optimal farming. It does not model target resource regeneration or defense strength.
- Barbarian-only mode rejects player-owned and unknown-owner villages, even when they belong to an include group. Target ownership, points, protection, cooldown, available troops, storage, and command slots are checked before sending using the available game models. Cached map data can still be stale; the server remains authoritative.
- Report-based cooldowns apply after empty hauls and casualties/defeats, independently of an ignore group. They persist separately for each player/world and expire automatically. Only reports observed while this script is loaded are recorded; old reports are not imported. The existing ignore-group feature still supports permanent exclusions.
- New controls expose unit reserves, a per-village cycle attack cap, timing jitter, an optional loot estimate, target-order variation, and preview mode. Saving settings pauses farming so a running step cannot mix old and new configuration.
- Target distances no longer modify shared map data. Duplicate targets are removed. Removing a target no longer skips its successor.
- Arrival spacing uses both locally known and server-loaded incoming attacks. Unknown arrival timestamps prevent another attack when spacing is enabled. Both same-farmer and other-farmer restrictions are applied.
- Steps are invalidated when stopped, expired, or replaced. An unacknowledged send stops the whole farmer after 30 seconds without retrying. The watchdog also stops instead of restarting automatically. A timeout does not prove that the server rejected the command; check outgoing commands before restarting.
- UI updates and countdowns use AngularJS `$evalAsync`; the cycle countdown uses the actual sampled cycle deadline.

## Timing and target order

The attack delay is the configured interval plus a random amount between zero and **Maximum extra delay between attacks**. The cycle delay works the same way. Both base intervals have a minimum of one second. Timing variation never subtracts from the configured interval. Set a jitter value to `0 seconds` to disable it.

**Target score variation** shuffles targets only within bands bounded by that percentage of the band's best score. A value of 5 allows variation among similarly ranked targets while keeping distant, substantially lower-ranked targets behind them. Set it to 0 for deterministic ranking. The existing distance, points, and target-count filters still apply.

These features vary scheduling. There is no evidence that they lower InnoGames' detection rate. Bots violate InnoGames' terms and can lead to account loss.

## AngularJS and clicks

The farmer uses the game's services and `SEND_PRESET` route, as upstream does. It does not simulate mouse input. `$evalAsync` integrates UI changes with AngularJS's digest cycle without forcing a nested `$apply`.

Ordinary JavaScript cannot make `.click()` or `dispatchEvent(new MouseEvent(...))` produce `isTrusted=true`. The browser owns that read-only event flag. Browser-level input tools can generate trusted events in some environments, but the flag is not evidence of a human user and does not prevent server-side detection. This variant does not spoof it.

## Review and use

1. Disable other TW2Overflow copies and the old `tw2tools` auto-start wrappers to avoid running multiple versions together.
2. Review the source and this document. The custom userscript uses a distinct namespace and disables upstream auto-updates so they cannot overwrite this local variant.
3. Open the supplied userscript in your userscript manager. Select your farming presets and keep **Preview only** enabled initially. Start the farmer and inspect planned targets, selected presets, and rate estimates in its logs. Preview performs game-data reads but sends no attacks and does not assign presets.
4. Adjust distance, points, travel limits, unit reserves, cooldowns, and intervals. For limited target loot, enter an estimate to avoid preferring oversized armies solely for their capacity.
5. To send attacks, disable **Preview only**, save, and start again. That changes account state and retains the normal bot-related account risk.

The distribution contains only FarmOverflow plus shared infrastructure. It excludes the usage-report module and other automation modules. It does not contact the old tracking endpoints. Other copies, forks, and upstream downloads are separate builds with potentially different behavior.

## Validation and rebuilding

Use Node.js 22 or later for the test command below. Install build dependencies with `npm ci --ignore-scripts` (configure an npm cache in a writable directory if needed).

```sh
node --test --test-isolation=none test/farming.test.cjs
node make.js --only=farm_overflow --userscript --lint
node --check dist/tw2overflow.user.js
```

The dependency-free tests load the actual AMD modules and settings class in a mocked game environment. They cover travel boundaries, preset scoring, loot estimates, reserves, malformed inputs, timing bounds, target-order bands, conquered targets, shared-distance isolation, duplicate targets, incoming attack spacing, cooldown persistence/expiry, cycle caps, stopping during initialization, stale callbacks after expiry/restart, and sends without acknowledgements. They do not establish compatibility with the live AngularJS version, game services, or anti-bot systems.
