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

    // Estimate barbarian village power based on available data
    const estimateBarbarianPower = function (target, estimateMethod) {
        if (!target) return 0;
        
        // Use village points as the primary power indicator
        if (!Number.isFinite(target.points) || target.points <= 0) {
            return 100; // Default power for unknown villages
        }
        
        if (estimateMethod === 'buildings') {
            // Building levels correlate with village strength
            const basePower = target.points * 10;
            return Math.round(basePower);
        }
        
        // Default: use village points directly
        return Math.round(target.points * 50);
    };

    // Calculate distance penalty - longer travel time = lower priority
    const calculateDistancePenalty = function (distance, baseTravelSeconds) {
        // Penalize based on round-trip travel time
        const roundTrip = baseTravelSeconds * 2;
        // 10% penalty per 100 seconds of travel
        const penaltyFactor = 1 - (Math.min(roundTrip, 3600) / 3600) * 0.3;
        return Math.max(0.1, penaltyFactor);
    };

    // Score a target considering power, distance, and loot
    const scoreTarget = function (target, options) {
        if (!target || !Number.isFinite(target.distance)) {
            return 0;
        }
        
        const powerWeight = Number(options.powerWeight) || 20;
        const powerEstimate = options.powerEstimate || 'points';
        const distancePenalty = calculateDistancePenalty(target.distance, options.baseTravelSeconds || 60);
        
        // Base score: loot per round-trip second
        const baseScore = (options.capacity || 1000) / (2 * (options.baseTravelSeconds || 60));
        
        // Apply power factor - higher power targets are worth more but riskier
        const powerEstimateValue = estimateBarbarianPower(target, powerEstimate);
        const powerFactor = 1 + (powerWeight / 100) * Math.log10(powerEstimateValue + 1);
        
        // Final score with distance penalty
        return baseScore * powerFactor * distancePenalty;
    };

    // Select preset based on target power and overkill percentage
    const choosePresetForTarget = function (presets, units, unitData, travelSeconds, target, options) {
        if (!Number.isFinite(options.maxTravelMs) || options.maxTravelMs <= 0
            || !Number.isFinite(options.reservePercent) || options.reservePercent < 0 || options.reservePercent > 100) {
            return {reason: 'no_units'};
        }

        let best = null;
        let affordable = false;

        // Estimate target power for preset selection
        const targetPower = estimateBarbarianPower(target, options.powerEstimate || 'points');
        const overkillPercent = Number(options.overkillPercent) || 20;
        const powerBuffer = 1 + (overkillPercent / 100);

        for (const preset of presets) {
            let haul = 0;
            let valid = !!preset.units && Object.keys(preset.units).length > 0;

            // Calculate required power to handle target with buffer
            let requiredPower = Math.round(targetPower * powerBuffer);

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
                
                // Estimate unit power (simplified: assume 1 power per 5 load)
                const unitPower = (load / 5) * amount;
                requiredPower -= unitPower;
            }

            if (!valid || haul <= 0) {
                continue;
            }

            affordable = true;
            const seconds = travelSeconds(preset);

            if (!Number.isFinite(seconds) || seconds <= 0 || seconds * 1000 > options.maxTravelMs) {
                continue;
            }

            // Score considers power efficiency
            const expectedHaul = Number.isFinite(options.expectedLoot) && options.expectedLoot > 0
                ? Math.min(haul, options.expectedLoot) : haul;
            
            // Power-adjusted score: favor presets that match target power
            const powerEfficiency = requiredPower <= 0 ? 1.2 : (1 - Math.min(1, -requiredPower / targetPower) * 0.3);
            
            const candidate = {
                preset, 
                haul, 
                expectedHaul, 
                travelSeconds: seconds, 
                powerEstimate: targetPower,
                requiredPower: Math.round(targetPower * powerBuffer),
                score: (expectedHaul / (2 * seconds)) * powerEfficiency
            };

            if (!best || (options.optimize ? candidate.score > best.score : seconds < best.travelSeconds)) {
                best = candidate;
            }
        }

        return best || {reason: affordable ? 'time_limit' : 'no_units'};
    };

    // Original choosePreset - kept for backwards compatibility
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

    return {
        isBarbarian,
        boundedDelay,
        choosePreset,
        choosePresetForTarget,
        scoreTarget,
        estimateBarbarianPower,
        orderTargets,
        arrivalIsBusy
    };
});