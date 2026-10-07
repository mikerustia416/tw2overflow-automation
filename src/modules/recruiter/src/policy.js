define('two/recruiter/policy', [], function () {
    const resources = ['wood', 'clay', 'iron', 'food'];
    const validCount = value => Number.isSafeInteger(value) && value >= 0;

    const validSettings = function (settings, map, unitData, buildings) {
        return Object.entries(map).every(([id, item]) => {
            const value = settings[id];
            if (item.inputType === 'number') {
                return validCount(value) && value >= item.min && value <= item.max;
            }
            if (item.inputType === 'checkbox') {
                return typeof value === 'boolean';
            }
            if (item.inputType === 'readable_time') {
                return Number.isFinite(value) && value >= 10000 && value <= 86400000;
            }
            return true;
        }) && settings.targets && !Array.isArray(settings.targets) && typeof settings.targets === 'object'
            && Object.entries(settings.targets).every(([name, amount]) => unitData[name]
                && unitData[name].building === 'barracks' && validCount(amount) && amount <= 1000000)
            && Array.isArray(settings.enabled_groups)
            && Array.isArray(settings.protect_buildings) && settings.protect_buildings.every(name => buildings[name]);
    };

    const plan = function (snapshot, settings, unitData, cycleBudget) {
        const empty = reason => ({reason, orders: [], budget: {}, protected: {}});
        if (!Number.isInteger(snapshot.barracksLevel) || snapshot.barracksLevel < 1) {
            return empty('Barracks unavailable');
        }
        if (!Array.isArray(snapshot.jobs) || snapshot.jobs.length >= settings.max_queue_jobs) {
            return empty('Recruitment queue full or unavailable');
        }
        const budget = {};
        const protectedResources = {};
        for (const type of resources) {
            const stock = snapshot.stock[type];
            const building = snapshot.buildingCosts[type];
            if (!Number.isFinite(stock) || stock < 0 || !Number.isFinite(building) || building < 0) {
                return empty('Resources or building costs unavailable');
            }
            protectedResources[type] = settings[`preserve_${type}`] + settings[`building_${type}`] + building;
            const spendable = Math.max(0, stock - protectedResources[type]);
            if (cycleBudget && !validCount(cycleBudget[type])) {
                return empty('Cycle budget unavailable');
            }
            budget[type] = cycleBudget ? Math.floor(Math.min(spendable, cycleBudget[type]))
                : Math.floor(spendable * (type === 'food' ? 1 : settings.spend_percent / 100));
        }
        const remaining = {...budget};
        const queued = {};
        for (const job of snapshot.jobs) {
            if (!job || !validCount(job.amount) || !validCount(job.recruited) || job.recruited > job.amount
                || !unitData[job.unit_type]) {
                return empty('Recruitment queue data unavailable');
            }
            queued[job.unit_type] = (queued[job.unit_type] || 0) + job.amount - job.recruited;
        }
        const orders = [];
        const deficits = [];
        // Settings order is recruitment priority; zero targets disable a kind.
        for (const [name, target] of Object.entries(settings.targets)) {
            if (!target) {
                continue;
            }
            const data = unitData[name];
            const count = snapshot.units[name] && snapshot.units[name].total;
            if (!validCount(count)) {
                return empty('Owned troop totals unavailable');
            }
            const deficit = Math.max(0, target - count - (queued[name] || 0));
            deficits.push({name, target, owned: count, queued: queued[name] || 0, deficit});
            if (!data || data.building !== 'barracks' || !validCount(data.required_level)
                || snapshot.barracksLevel < data.required_level || snapshot.barracksLevel < 1
                || orders.length + snapshot.jobs.length >= settings.max_queue_jobs) {
                continue;
            }
            // World unit data supplies costs. No hard-coded troop prices.
            const cost = Object.fromEntries(resources.map(type => [type, Number(data[type])]));
            if (!resources.every(type => Number.isFinite(cost[type]) && cost[type] >= 0) || cost.food <= 0) {
                return empty('Troop costs unavailable');
            }
            let missing = deficit;
            while (missing > 0 && orders.length + snapshot.jobs.length < settings.max_queue_jobs) {
                let amount = Math.min(missing, settings.max_batch);
                for (const type of resources) {
                    if (cost[type] > 0) {
                        amount = Math.min(amount, Math.floor(remaining[type] / cost[type]));
                    }
                }
                if (amount <= 0) {
                    break;
                }
                const totalCost = {};
                for (const type of resources) {
                    totalCost[type] = amount * cost[type];
                    remaining[type] -= totalCost[type];
                }
                orders.push({unit_type: name, amount, cost: totalCost});
                missing -= amount;
            }
        }
        return {reason: orders.length ? 'Ready' : 'Targets met, units locked, or budget reserved', orders,
            deficits, budget, remaining, protected: protectedResources, buildingCosts: snapshot.buildingCosts};
    };
    return {plan, validSettings};
});
