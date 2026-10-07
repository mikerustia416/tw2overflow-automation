define('two/depositPlanner/rerollNotice', ['two/depositPlanner/policy'], function (policy) {
    return function (plan, config, pending) {
        const reasons = [];
        let level = 'info';
        const add = function (text, warning = false) {
            reasons.push(text);
            if (warning) {
                level = 'warning';
            }
        };
        const result = () => ({level, title: level === 'warning' ? 'Reroll not recommended now' : 'Keep your reroll items for now', reasons});
        if (pending) {
            add('A previous ' + pending.action + ' request still needs game confirmation. Wait for confirmation before rerolling.', true);
            return result();
        }
        if (!plan.state || plan.action === 'unavailable' || plan.action === 'refresh') {
            add('Wait for fresh deposit data before deciding whether to reroll.');
            return result();
        }
        if (plan.action === 'reroll') {
            return null;
        }
        const state = plan.state;
        if (state.progress >= state.target) {
            add('The target is already reached. Save items for the next milestone cycle.');
            return result();
        }
        if (state.now + config.action_delay >= state.milestonesReset - config.deadline_buffer) {
            add('The milestone reset buffer has been reached. There is no safe collection time for a new plan.', true);
            return result();
        }
        if (state.collectible.length) {
            add('Collect the completed errand and let the planner recalculate before spending an item.');
            return result();
        }
        if (plan.knownEta != null) {
            add('The selected visible errands can reach ' + (plan.fallback ? 'the planned lower milestone' : 'the target') + ' before both reset buffers without a reroll.');
            return result();
        }
        if (!config.auto_reroll) {
            add('Automatic item rerolls are switched off. This setting alone does not judge the value of a manual reroll.');
        }
        if (state.itemCount <= config.reserve_items) {
            add('Inventory has ' + state.itemCount + ' reroll items; ' + config.reserve_items + ' are reserved. No item is available to spend.', true);
        }
        if (state.rerollsUsed >= config.max_rerolls) {
            add('The milestone-cycle reroll limit is reached (' + state.rerollsUsed + '/' + config.max_rerolls + ' reserved or used).', true);
        }
        if (policy.budgetFor(state, config) > 0 && !state.itemId) {
            add('The inventory reroll item is unavailable in the current game data.', true);
        }
        if (state.current) {
            if (plan.runningPreview) {
                // The planner already evaluates the running job, capability and early-reroll checks.
                add(plan.runningPreview.reason, !plan.runningPreview.collectableBeforeReset || !state.runningRerollAllowed);
            } else {
                add('An errand is running. Wait for completion and collection before replacing the board.');
            }
            return result();
        }
        if (plan.fixedYield) {
            add(plan.reason, plan.goalTarget === undefined && !!(plan.fallbackRerollEstimate && plan.fallbackRerollEstimate.availableRerolls));
            return result();
        }
        const forecast = plan.forecast;
        if (forecast && !forecast.ready) {
            add('Only ' + forecast.sampleCount + '/' + config.min_samples + ' matching complete boards are learned. There is not enough history to assess an item reroll.', true);
        } else if (forecast && forecast.ready && config.auto_reroll && policy.budgetFor(state, config) > 0 && state.itemId) {
            const options = plan.fallback && plan.attainableMilestone && plan.attainableMilestone.options || forecast.options;
            const candidates = options.filter(option => option.action === 'reroll');
            const valuePasses = option => option.meanItems === 0 || option.gainPerItem > 0 && option.gainPerItem >= config.min_gain_per_item;
            const score = option => config.confidence_guard ? option.lowerProbability : option.probability;
            const valuable = candidates.filter(valuePasses);
            const confident = valuable.filter(option => !config.confidence_guard || score(option) * 100 >= config.success_percent);
            const alternative = options.filter(option => !option.action.startsWith('reroll') && valuePasses(option))
                .sort((a, b) => score(b) - score(a) || a.itemLimit - b.itemLimit || (a.action === 'continue' ? 0 : 1) - (b.action === 'continue' ? 0 : 1))[0];
            if (candidates.length && !valuable.length) {
                add('Item rerolls add too little expected progress per item. The gain must be positive and at least ' + config.min_gain_per_item + '.', true);
            } else if (valuable.length && !confident.length) {
                add('No item-reroll forecast meets the cautious success threshold of ' + config.success_percent + '%.', true);
            } else if (confident.length && alternative && confident.every(option => (score(option) - (config.confidence_guard ? alternative.upperProbability : alternative.probability)) * 100 < config.min_improvement)) {
                add('Rerolling now does not improve forecast success by the required ' + config.min_improvement + ' percentage points over continuing or waiting.', true);
            } else {
                add('Continuing visible errands or waiting is preferred by the forecast and item-saving rules.');
            }
        }
        if (plan.action === 'wait' && state.errandsReset > state.now && state.errandsReset - state.now <= config.free_refresh_wait) {
            add('A free errand reset is due within ' + Math.ceil((state.errandsReset - state.now) / 60) + ' minutes. Wait for the new board.');
        }
        if (!reasons.length) {
            add(plan.reason || 'The current plan does not recommend an item reroll.');
        }
        return result();
    };
});
