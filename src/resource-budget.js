define('two/resourceBudget', [], function () {
    const pending = new Map();
    const resources = ['wood', 'clay', 'iron', 'food'];
    const stock = village => village.getResources().getComputed();
    const isBusy = function (village) {
        const entry = pending.get(village.getId());
        if (!entry) {
            return false;
        }
        const current = stock(village);
        if (entry.acknowledged && resources.every(type => !entry.cost[type]
            || (current[type] && Number.isFinite(current[type].currentStock)
                && current[type].currentStock <= entry.before[type] - entry.cost[type]))) {
            pending.delete(village.getId());
            return false;
        }
        return true;
    };
    return {
        isBusy,
        begin: function (village, cost) {
            if (!cost || !resources.every(type => Number.isFinite(Number(cost[type])) && Number(cost[type]) >= 0)
                || isBusy(village)) {
                return false;
            }
            const current = stock(village);
            cost = Object.fromEntries(resources.map(type => [type, Number(cost[type])]));
            const entry = {cost, before: {}, acknowledged: false};
            for (const type of resources) {
                if (cost[type] && (!current[type] || !Number.isFinite(current[type].currentStock)
                    || current[type].currentStock < cost[type])) {
                    return false;
                }
                entry.before[type] = current[type] ? current[type].currentStock : 0;
            }
            pending.set(village.getId(), entry);
            return entry;
        },
        acknowledge: function (village, entry) {
            if (pending.get(village.getId()) === entry) {
                entry.acknowledged = true;
            }
        },
        reject: function (village, entry) {
            if (pending.get(village.getId()) === entry) {
                pending.delete(village.getId());
            }
        },
        clear: function (villageId) {
            pending.delete(Number(villageId));
        }
    };
});
