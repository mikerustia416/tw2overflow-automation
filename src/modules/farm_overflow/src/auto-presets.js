define('two/farmOverflow/autoPresets', ['two/farmOverflow/policy'], function (policy) {
    // Farmer-owned packets use SEND_CUSTOM_ARMY and never modify native presets.
    return function (villageId, targets, units, unitData, options) {
        if (!Array.isArray(options.unitNames) || !Number.isFinite(options.reservePercent)
            || options.reservePercent < 0 || options.reservePercent > 100
            || !Number.isInteger(options.minimum) || !Number.isInteger(options.maximum)
            || options.minimum < 1 || options.maximum < options.minimum
            || !Number.isFinite(options.carry) || options.carry <= 0) {
            return [];
        }
        const nearby = targets.filter(policy.isBarbarian);
        if (!nearby.length) {
            return [];
        }
        const packets = Math.max(1, Math.min(nearby.length, options.commandSlots, options.attackLimit));
        if (!Number.isInteger(packets)) {
            return [];
        }
        const result = [];
        for (const name of new Set(options.unitNames)) {
            const data = unitData[name];
            const stock = units[name] && units[name].in_town;
            if (!data || !Number.isFinite(data.load) || data.load <= 0 || !Number.isInteger(stock) || stock < 0) {
                continue;
            }
            const available = Math.floor(stock * (1 - options.reservePercent / 100));
            const cap = Math.min(available, options.maximum, Math.ceil(options.carry / data.load));
            if (cap < options.minimum) {
                continue;
            }
            const base = Math.min(cap, Math.max(options.minimum, Math.floor(available / packets)));
            for (const amount of new Set([base, Math.min(cap, base * 2), cap])) {
                result.push({
                    id: `auto:${villageId}:${name}:${amount}`,
                    name: `Auto ${name} × ${amount}`,
                    units: {[name]: amount},
                    officers: {},
                    generated: true,
                    nearbyTargets: nearby.length
                });
            }
        }
        return result;
    };
});
