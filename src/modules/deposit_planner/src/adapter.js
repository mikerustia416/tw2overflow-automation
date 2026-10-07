define('two/depositPlanner/adapter', ['helper/time', 'conf/effectTypes', 'conf/tribeSkillNames'], function (time, effects, skills) {
    const normalizedJob = function (job) {
        return {id: job.id, duration: Number(job.duration), amount: Number(job.amount), quality: Number(job.quality),
            resource: job.resource_type,
            completedAt: job.time_completed ? time.server2ClientTime(Number(job.time_completed)) / 1000 : null};
    };
    const snapshot = function (info, config, rerollsUsed) {
        const character = modelDataService.getSelectedCharacter();
        const model = character && character.getResourceDeposit();
        if (!model || !model.isAvailable()) {
            throw new Error('Resource deposit unavailable');
        }
        const milestones = model.getMilestones().map(item => ({target: Number(item.target),
            reward: item.i18n, achieved: !!item.achieved, amount: item.amount}));
        const cap = Math.max(0, ...milestones.map(item => item.target));
        const left = Number(model.getResourcesLeft());
        if (!cap || !Number.isFinite(left) || left < 0 || left > cap || config.target > cap) {
            throw new Error('Milestone progress unavailable or target exceeds the deposit maximum');
        }
        if (!info || !Number(info.time_next_reset) || !Number(info.time_new_milestones)) {
            throw new Error('Waiting for both reset timestamps from the server');
        }
        const inventory = modelDataService.getInventory();
        if (!inventory) {
            throw new Error('Waiting for inventory data');
        }
        const item = inventory.getItemByType('resource_deposit_reroll');
        const itemCount = item ? Number(item.amount) : 0;
        if (!Number.isInteger(itemCount) || itemCount < 0 || item && item.type !== 'resource_deposit_reroll') {
            throw new Error('Reroll item data unavailable');
        }
        const effectService = injector.get('effectService');
        const tribe = modelDataService.getTribeSkills();
        const effectValue = function (type) {
            const effect = effectService.getStackedEffect(type);
            return effect ? effectService.getEffectValue(effect) : null;
        };
        // Effective server job values are authoritative. Never multiply bonuses twice.
        const context = JSON.stringify([modelDataService.getSelectedVillage().getId(),
            effectValue(effects.INCREASED_CARRYING_CAPACITY),
            effectValue(effects.RESOURCE_DEPOSIT_JOB_DURATION),
            tribe ? tribe.isSkillActive(skills.loot_bonus) : false,
            tribe ? tribe.isSkillActive(skills.raid_speed) : false]);
        const current = model.getCurrentJob();
        const state = {now: Date.now() / 1000, progress: cap - left, target: config.target || cap, cap, milestones, context,
            jobs: (model.getReadyJobs() || []).map(normalizedJob),
            collectible: (model.getCollectibleJobs() || []).map(normalizedJob),
            current: current ? normalizedJob(current) : null,
            errandsReset: time.server2ClientTime(Number(info.time_next_reset)) / 1000,
            milestonesReset: time.server2ClientTime(Number(info.time_new_milestones)) / 1000,
            cycleId: Number(info.time_new_milestones), itemCount, itemId: item && item.id, rerollsUsed};
        if (![state.errandsReset, state.milestonesReset].every(Number.isFinite)
            || state.current && !Number.isFinite(state.current.completedAt)) {
            throw new Error('Errand completion or reset time unavailable');
        }
        return state;
    };
    const boardKey = state => JSON.stringify(state.jobs.map(job => job.id).sort());
    return {snapshot, boardKey, toClientSeconds: seconds => time.server2ClientTime(seconds) / 1000};
});
