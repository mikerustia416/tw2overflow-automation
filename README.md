# TW2Overflow Farming Improvements

A customized TW2Overflow farmer that prioritizes estimated loot per round-trip travel time, with configurable troop reserves, cooldowns, attack limits, scheduling variation, and a preview mode.

This source snapshot is based on [relaxeaza/twoverflow](https://gitlab.com/relaxeaza/twoverflow) version 2.1.500, commit `ba49338011f5a6429f07290115dd6a1365540bdb`. Original authorship and the [WTFPL license](LICENCE) are preserved. The original project README is available in [UPSTREAM-README.md](UPSTREAM-README.md).

## Userscript

Download [tw2overflow-farming.user.js](userscript/tw2overflow-farming.user.js) using GitHub's **Raw** or download button, then install it in your userscript manager. Disable other TW2Overflow copies before using this variant.

**Preview only** is enabled by default. Read [FARMING-CHANGES.md](FARMING-CHANGES.md) for the new settings, scoring formula, preview instructions, and limitations.

The included userscript contains FarmOverflow and shared infrastructure. It excludes the upstream usage-report module and other automation modules. Upstream automatic updates are disabled. The source snapshot retains the upstream modules for reference and development; the build command below selects the farmer.

The original implementation changes are also saved as an [upstream patch](patches/farming-improvements.patch).

## Build and verification

Use Node.js 22 or later:

```sh
git clone https://github.com/mikerustia416/tw2overflow-automation.git
cd tw2overflow-automation
npm ci --ignore-scripts
node --test --test-isolation=none test/farming.test.cjs
node make.js --only=farm_overflow --userscript --lint
node --check dist/tw2overflow.user.js
```

The build writes `dist/tw2overflow.user.js`. To refresh the checked-in userscript after rebuilding, copy that file to `userscript/tw2overflow-farming.user.js`.

The 28 offline tests exercise the actual farmer modules with mocked game services. Live Tribal Wars 2 compatibility is unverified. Timing variation and browser event flags do not establish resistance to detection; game automation can lead to an account ban. This project does not modify the browser or spoof `isTrusted`.
