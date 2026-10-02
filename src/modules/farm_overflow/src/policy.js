define('two/farmOverflow/policy', [], function () {
    const MAX_TIMER = 2147483647;

    const isBarbarian = function (target) {
        return !!target && (target.character_id === null || target.character_id === 0 || target.character_id === '0');
    };

    const boundedDelay = function (base, jitter, minimum, random = Math.random) {
        base = Number(base);
        jitter = Number(jitter);
        const safeBase = Number.isFinite(base) ? Math.max(minimum, base) : minimum;
        const safeJitter = Number.isFinite(jitter) ? Math.max(0, jitter) : 0;
        return Math.min(MAX_TIMER, Math.round(safeBase + safeJitter * random()));
    };

    // Without a supplied loot estimate this is capacity per round-trip second.
    const choosePreset = function (presets, units, unitData, travelSeconds, options) {
        if (!Number.isFinite(options.maxTravelMs) || options.maxTravelMs <= 0
            || !Number.isFinite(options.reservePercent) || options.reservePercent < 0 || options.reservePercent > 100) {
            return {reason: 'no_units'};
        }

        let best = null;
        let affordable = false;

        for (const preset of presets) {
            let haul = 0;
            let valid = !!preset.units && Object.keys(preset.units).length > 0;

            for (const [name, amount] of Object.entries(preset.units || {})) {
                if (!Number.isInteger(amount) || amount < 0) {
                    valid = false;
                    break;
                }

                if (!amount) {
                    continue;
                }

                const stock = units[name] && units[name].in_town;
                const load = unitData[name] && unitData[name].load;
                const available = Math.floor(stock * (1 - options.reservePercent / 100));

                if (!Number.isFinite(stock) || !Number.isFinite(load) || available < amount) {
                    valid = false;
                    break;
                }

                haul += amount * load;
            }

            if (!valid || haul <= 0) {
                continue;
            }

            affordable = true;
            const seconds = travelSeconds(preset);

            if (!Number.isFinite(seconds) || seconds <= 0 || seconds * 1000 > options.maxTravelMs) {
                continue;
            }

            const expectedHaul = Number.isFinite(options.expectedLoot) && options.expectedLoot > 0
                ? Math.min(haul, options.expectedLoot) : haul;
            const candidate = {preset, haul, expectedHaul, travelSeconds: seconds, score: expectedHaul / (2 * seconds)};

            if (!best || (options.optimize ? candidate.score > best.score : seconds < best.travelSeconds)) {
                best = candidate;
            }
        }

        return best || {reason: affordable ? 'time_limit' : 'no_units'};
    };

    // Shuffle only within bands whose scores differ by at most the given percent.
    const orderTargets = function (targets, scoreTarget, variationPercent, random = Math.random) {
        const ranked = targets.map(target => ({target, score: scoreTarget(target)}))
            .filter(item => Number.isFinite(item.score) && item.score > 0)
            .sort((a, b) => b.score - a.score || a.target.id - b.target.id);
        const tolerance = Math.min(25, Math.max(0, Number(variationPercent) || 0)) / 100;

        if (tolerance) {
            for (let start = 0; start < ranked.length;) {
                let end = start + 1;
                const minimum = ranked[start].score * (1 - tolerance);

                while (end < ranked.length && ranked[end].score >= minimum) {
                    end++;
                }

                for (let i = end - 1; i > start; i--) {
                    const j = start + Math.floor(random() * (i - start + 1));
                    [ranked[i], ranked[j]] = [ranked[j], ranked[i]];
                }

                start = end;
            }
        }

        return ranked.map(item => item.target);
    };

    const arrivalIsBusy = function (arrivalSeconds, commands, minimumIntervalMs) {
        if (minimumIntervalMs <= 0) {
            return false;
        }

        return commands.some(function (command) {
            const completed = command.time_completed;
            // Unknown arrival time must not silently bypass duplicate protection.
            return !Number.isFinite(completed) || Math.abs(arrivalSeconds - completed) * 1000 < minimumIntervalMs;
        });
    };

    return {isBarbarian, boundedDelay, choosePreset, orderTargets, arrivalIsBusy};
});
