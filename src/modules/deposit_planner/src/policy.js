define('two/depositPlanner/policy', [], function () {
    const REFRESH_SECONDS = 8 * 60 * 60;
    const FORECAST_RUNS = 128;
    const BOOTSTRAP_RUNS = 16;
    const invalidSettings = function (config, map) {
        return Object.entries(map).filter(([key, field]) => field.inputType === 'checkbox'
            ? typeof config[key] !== 'boolean'
            : !Number.isInteger(config[key]) || config[key] < field.min || config[key] > field.max)
            .map(([key]) => key);
    };
    const validSettings = (config, map) => invalidSettings(config, map).length === 0;
    const validJob = job => job && job.id !== undefined && Number.isFinite(job.duration) && job.duration > 0
        && Number.isFinite(job.amount) && job.amount > 0;
    // Reuse subset totals across simulations, keeping deadline/target decisions exact.
    // Store indices rather than game objects so current metadata is never stale.
    const subsetCache = new Map();
    const optimize = function (jobs, gap, budget, delay) {
        if (!Array.isArray(jobs) || jobs.length > 12 || !jobs.every(validJob)) {
            throw new Error('Errand rewards or durations unavailable');
        }
        if (gap <= 0 || budget <= 0 || !jobs.length) {
            return {jobs: [], reward: 0, seconds: 0};
        }
        const key = JSON.stringify([delay, jobs.map(job => [job.id, job.duration, job.amount])]);
        let subsets = subsetCache.get(key);
        if (!subsets) {
            const order = jobs.map((job, index) => index).sort((a, b) => jobs[b].amount / jobs[b].duration - jobs[a].amount / jobs[a].duration
                || jobs[a].duration - jobs[b].duration || String(jobs[a].id).localeCompare(String(jobs[b].id)));
            subsets = [];
            for (let mask = 1; mask < 2 ** jobs.length; mask++) {
                const indices = order.filter(index => mask & (1 << index));
                subsets.push({indices, seconds: indices.reduce((sum, index) => sum + jobs[index].duration + delay, 0),
                    amount: indices.reduce((sum, index) => sum + jobs[index].amount, 0)});
            }
            if (subsetCache.size >= 512) {
                subsetCache.delete(subsetCache.keys().next().value);
            }
            subsetCache.set(key, subsets);
        }
        let best;
        let reward = 0;
        for (const subset of subsets) {
            const value = Math.min(gap, subset.amount);
            if (subset.seconds <= budget && (value > reward || value === reward && best && subset.seconds < best.seconds)) {
                best = subset;
                reward = value;
            }
        }
        return best ? {jobs: best.indices.map(index => jobs[index]), reward, seconds: best.seconds} : {jobs: [], reward: 0, seconds: 0};
    };
    const quantile = function (values, fraction) {
        if (!values.length) {
            return null;
        }
        const sorted = values.slice().sort((a, b) => a - b);
        return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
    };
    // This interval describes simulation sampling error, not unknown game odds.
    const probabilityBand = function (successes, count) {
        const z = 1.96;
        const p = successes / count;
        const scale = 1 + z * z / count;
        const center = (p + z * z / (2 * count)) / scale;
        const margin = z * Math.sqrt(p * (1 - p) / count + z * z / (4 * count * count)) / scale;
        return {lower: Math.max(0, center - margin), upper: Math.min(1, center + margin)};
    };
    const timingEstimate = function (entries, state, config) {
        const matching = entries.filter(entry => entry.context === state.context && Number.isFinite(entry.delay)
            && entry.delay >= 0 && entry.delay <= 300 && entry.at <= state.now && entry.at >= state.now - 30 * 86400);
        const learnedDelay = matching.length >= 3 ? Math.ceil(quantile(matching.map(entry => entry.delay), 0.9)) : null;
        return {sampleCount: matching.length, learnedDelay,
            effectiveDelay: config.learn_action_delay && learnedDelay !== null ? Math.max(config.action_delay, learnedDelay) : config.action_delay};
    };
    const random = function (seed) {
        return function () {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            return seed / 4294967296;
        };
    };
    const hash = function (text) {
        let value = 2166136261;
        for (const letter of text) {
            value = Math.imul(value ^ letter.charCodeAt(0), 16777619) >>> 0;
        }
        return value;
    };
    const budgetFor = (state, config) => Math.max(0, Math.min(config.max_rerolls - state.rerollsUsed,
        state.itemCount - config.reserve_items));

    const canRerollRunning = (state, config) => !!(state.runningRerollAllowed && state.current && validJob(state.current)
        && state.current.completedAt > state.now && !state.jobs.length && !state.collectible.length
        && state.current.completedAt + config.action_delay <= Math.min(state.errandsReset, state.milestonesReset) - config.deadline_buffer
        && state.progress + state.current.amount < state.target && config.auto_reroll && budgetFor(state, config) > 0 && state.itemId);

    const simulate = function (state, config, samples, first, limit, seed) {
        const rng = random(seed);
        let time = state.now;
        let progress = state.progress;
        let free = state.errandsReset;
        let jobs = state.jobs.map(job => ({...job}));
        let spent = 0;
        const deadline = state.milestonesReset - config.deadline_buffer;
        const hits = {};
        const milestones = (state.milestones || []).filter(item => !item.achieved && Number.isFinite(item.target)
            && item.target > state.progress && item.target <= state.target);
        const record = function () {
            for (const milestone of milestones) {
                if (!hits[milestone.target] && progress >= milestone.target) {
                    hits[milestone.target] = {time, spent};
                }
            }
        };
        const board = () => samples[Math.floor(rng() * samples.length)].jobs.map((job, id) => ({...job, id}));
        const wait = function () {
            time = Math.max(time, free) + config.action_delay;
            free += REFRESH_SECONDS;
            jobs = board();
        };
        const reroll = function () {
            spent++;
            time += config.action_delay;
            jobs = board();
        };
        if (first === 'reroll_now') {
            reroll();
        }
        if (state.current) {
            time = Math.max(time, state.current.completedAt) + config.action_delay;
            // A running errand contributes only when collected before both resets.
            if (time <= Math.min(free, state.milestonesReset) - config.deadline_buffer) {
                progress += state.current.amount;
                record();
            }
            if (progress >= state.target || time >= deadline) {
                return {success: progress >= state.target && time <= deadline, time, spent, progress: Math.min(progress, state.target), hits};
            }
        }
        if (first === 'wait') {
            wait();
        } else if (first === 'reroll') {
            reroll();
        }
        // A forecast is a bounded rollout of a replanning policy, not a claim of
        // global optimality over unknown boards or independently sampled errands.
        for (let step = 0; step < 256 && time < deadline && progress < state.target; step++) {
            if (time >= free) {
                wait();
                continue;
            }
            const selection = optimize(jobs, state.target - progress, Math.min(free - config.deadline_buffer, deadline) - time, config.action_delay);
            if (selection.jobs.length) {
                // A simulated board is fixed: execute the exact chosen subset in
                // one step. Real automation still confirms and replans each job.
                for (const job of selection.jobs) {
                    time += job.duration + config.action_delay;
                    progress += job.amount;
                    record();
                }
                const selected = new Set(selection.jobs.map(job => job.id));
                jobs = jobs.filter(candidate => !selected.has(candidate.id));
            } else if (free < deadline && (free - time <= config.free_refresh_wait || spent >= limit)) {
                wait();
            } else if (spent < limit) {
                reroll();
            } else {
                break;
            }
        }
        return {success: progress >= state.target && time <= deadline, time, spent, progress: Math.min(progress, state.target), hits};
    };

    const choose = function (options, config) {
        const score = option => config.confidence_guard ? option.lowerProbability : option.probability;
        const rank = option => option.action === 'continue' ? 0 : option.action === 'wait' ? 1 : 2;
        const withoutItems = options.filter(option => option.itemLimit === 0)
            .sort((a, b) => b.probability - a.probability || b.expectedGain - a.expectedGain || rank(a) - rank(b))[0];
        for (const option of options) {
            option.gainPerItem = option.meanItems > 0 ? (option.expectedGain - (withoutItems ? withoutItems.expectedGain : 0)) / option.meanItems : null;
        }
        const eligible = options.filter(option => option.meanItems === 0
            || option.gainPerItem > 0 && option.gainPerItem >= config.min_gain_per_item);
        const reliable = eligible.filter(option => score(option) * 100 >= config.success_percent);
        const contenders = (reliable.length ? reliable : eligible).slice().sort((a, b) => (reliable.length ? a.itemLimit - b.itemLimit : score(b) - score(a))
            || a.meanItems - b.meanItems || rank(a) - rank(b) || (a.eta || Infinity) - (b.eta || Infinity));
        let best = contenders[0];
        const withoutReroll = eligible.filter(option => !option.action.startsWith('reroll'))
            .sort((a, b) => score(b) - score(a) || a.itemLimit - b.itemLimit || rank(a) - rank(b))[0];
        if (best && best.action.startsWith('reroll') && (config.confidence_guard && score(best) * 100 < config.success_percent
            || withoutReroll && (score(best) - (config.confidence_guard ? withoutReroll.upperProbability : withoutReroll.probability)) * 100 < config.min_improvement)) {
            best = withoutReroll || withoutItems;
        }
        return best;
    };

    const forecast = function (state, config, history) {
        const samples = history.filter(sample => sample && sample.context === state.context && Array.isArray(sample.jobs) && sample.jobs.length === 6
            && sample.jobs.every(validJob) && sample.at <= state.now && sample.at >= state.now - 30 * 86400);
        if (samples.length < config.min_samples) {
            return {ready: false, sampleCount: samples.length, options: [], reason: 'Learning complete boards before estimating rerolls'};
        }
        const options = [];
        const maximum = config.auto_reroll ? budgetFor(state, config) : 0;
        // Common random numbers make candidate comparisons repeatable and fair.
        const baseSeed = hash(JSON.stringify([state.jobs, state.progress, Math.floor(state.now / 30), state.context]));
        // Resample whole observed boards to expose sensitivity to a small history.
        // The resulting band is approximate and cannot include unseen board types.
        const bootstrap = Array.from({length: BOOTSTRAP_RUNS}, (unused, index) => {
            const rng = random(baseSeed + index * 104729);
            return Array.from({length: samples.length}, () => samples[Math.floor(rng() * samples.length)]);
        });
        for (const action of ['continue', 'wait', 'reroll', ...(canRerollRunning(state, config) ? ['reroll_now'] : [])]) {
            if (action === 'continue' && !state.current && !optimize(state.jobs, state.target - state.progress, Math.min(state.errandsReset, state.milestonesReset) - config.deadline_buffer - state.now, config.action_delay).jobs.length) {
                continue;
            }
            for (let limit = action.startsWith('reroll') ? 1 : 0; limit <= maximum; limit++) {
                const results = Array.from({length: FORECAST_RUNS}, (unused, index) => simulate(state, config, samples, action, limit, baseSeed + index * 7919));
                const successes = results.filter(result => result.success);
                const times = successes.map(result => result.time);
                const band = probabilityBand(successes.length, results.length);
                const resampled = bootstrap.map((boards, block) => Array.from({length: 16}, (unused, run) => simulate(state, config, boards, action, limit, baseSeed + (block * 16 + run) * 7919)));
                const sensitivity = resampled.map(block => block.filter(result => result.success).length / block.length);
                const milestones = (state.milestones || []).filter(item => !item.achieved && Number.isFinite(item.target)
                    && item.target > state.progress && item.target <= state.target).map(milestone => {
                    const hits = results.filter(result => result.hits[milestone.target]);
                    const band = probabilityBand(hits.length, results.length);
                    const sensitivity = resampled.map(block => block.filter(result => result.hits[milestone.target]).length / block.length);
                    const times = hits.map(result => result.hits[milestone.target].time);
                    return {target: milestone.target, probability: hits.length / results.length,
                        lowerProbability: Math.min(band.lower, quantile(sensitivity, 0.05)),
                        upperProbability: Math.max(band.upper, quantile(sensitivity, 0.95)),
                        eta: quantile(times, 0.5), conservativeEta: quantile(times, 0.9),
                        meanItems: results.reduce((sum, result) => sum + (result.hits[milestone.target] ? result.hits[milestone.target].spent : result.spent), 0) / results.length,
                        expectedGain: results.reduce((sum, result) => sum + Math.min(result.progress, milestone.target) - state.progress, 0) / results.length};
                });
                options.push({action, itemLimit: limit, milestones, probability: successes.length / results.length,
                    lowerProbability: Math.min(band.lower, quantile(sensitivity, 0.05)),
                    upperProbability: Math.max(band.upper, quantile(sensitivity, 0.95)),
                    expectedGain: results.reduce((sum, result) => sum + result.progress - state.progress, 0) / results.length,
                    eta: quantile(times, 0.5), conservativeEta: quantile(times, 0.9),
                    meanItems: results.reduce((sum, result) => sum + result.spent, 0) / results.length});
            }
        }
        const best = choose(options, config);
        const milestones = (state.milestones || []).filter(item => !item.achieved && Number.isFinite(item.target)
            && item.target > state.progress && item.target <= state.target).map(milestone => {
            const choices = options.map(option => ({action: option.action, itemLimit: option.itemLimit,
                ...option.milestones.find(item => item.target === milestone.target)}));
            const best = choose(choices, config);
            const supported = best && (config.confidence_guard ? best.lowerProbability : best.probability) * 100 >= config.success_percent;
            return {target: milestone.target, best, supported, options: choices};
        }).sort((a, b) => b.target - a.target);
        const bestMilestone = milestones.find(milestone => milestone.supported);
        return {ready: true, sampleCount: samples.length, best, options, milestones, bestMilestone,
            reason: 'Approximate history bootstrap and simulation bands; unseen boards remain unknown. ETAs cover successful runs only'};
    };

    const plan = function (state, config, history = [], predict = () => forecast(state, config, history)) {
        const base = {state, action: 'wait', reason: '', jobs: [], knownEta: null, forecast: null};
        if (state.progress >= state.target) {
            return {...base, action: 'target', reason: 'Target reached; preserve reroll items for the next milestone cycle'};
        }
        if (state.now >= state.milestonesReset || state.now >= state.errandsReset) {
            return {...base, action: 'refresh', reason: 'Reset elapsed; waiting for fresh server data'};
        }
        if (state.now + config.action_delay >= state.milestonesReset - config.deadline_buffer) {
            return {...base, reason: 'Collection buffer reached; wait for the next milestone cycle'};
        }
        if (state.collectible.length && state.collectible[0].completedAt > state.now) {
            return {...base, reason: 'Completed status is ahead of the synchronized timer; wait'};
        }
        if (state.collectible.length) {
            return {...base, action: 'collect', job: state.collectible[0], reason: 'Collect completed resources, then recalculate'};
        }
        if (state.current) {
            const prediction = predict();
            const milestone = prediction.bestMilestone;
            const supported = prediction.best && (config.confidence_guard ? prediction.best.lowerProbability : prediction.best.probability) * 100 >= config.success_percent;
            const completion = state.current.completedAt + config.action_delay;
            const known = completion <= Math.min(state.errandsReset, state.milestonesReset) - config.deadline_buffer
                ? (state.milestones || []).filter(item => !item.achieved && item.target > state.progress && item.target <= Math.min(state.target, state.progress + state.current.amount))
                    .sort((a, b) => b.target - a.target)[0] : null;
            const attainableMilestone = known && (!milestone || known.target >= milestone.target)
                ? {target: known.target, known: true, best: {eta: completion, meanItems: 0, probability: 1, lowerProbability: 1, upperProbability: 1}}
                : milestone;
            const fallback = config.milestone_fallback && !supported && attainableMilestone && attainableMilestone.target < state.target;
            const projectedTotal = state.progress + state.current.amount;
            const validCompletion = completion <= Math.min(state.errandsReset, state.milestonesReset) - config.deadline_buffer;
            const earlyOptions = fallback && milestone && milestone.target === attainableMilestone.target ? milestone.options : prediction.options;
            const early = prediction.ready && choose(earlyOptions.filter(option => option.itemLimit === 0 || option.action === 'reroll_now'), config);
            const recommended = canRerollRunning(state, config) && early && early.action === 'reroll_now';
            const lastErrand = !state.jobs.length && !state.collectible.length && state.current.completedAt > state.now;
            const runningPreview = lastErrand ? {collectedTotal: state.progress, runningReward: state.current.amount,
                projectedTotal, remainingGap: Math.max(0, state.target - projectedTotal), collectableBeforeReset: validCompletion,
                usableItems: budgetFor(state, config), canRerollNow: !!recommended,
                reason: !validCompletion ? 'The running reward cannot be safely collected before both reset buffers'
                    : projectedTotal >= state.target ? 'The running errand covers the target; keep items'
                        : !config.auto_reroll ? 'Automatic item rerolls are disabled'
                            : budgetFor(state, config) < 1 ? 'No items available within the reserve and cycle limit'
                                : !state.runningRerollAllowed ? 'The game reroll capability is unavailable or disabled'
                                    : !prediction.ready ? prediction.reason
                                        : recommended ? 'An item can prepare the next board now; the current errand remains running'
                                            : 'An early reroll does not meet the forecast confidence, improvement or item-value checks'} : null;
            return {...base, action: recommended ? 'reroll' : 'wait', forecast: prediction, attainableMilestone,
                runningPreview, earlyReroll: !!recommended, fallback: !!fallback,
                goalTarget: fallback ? attainableMilestone.target : undefined,
                reason: recommended ? 'Nothing to do: prepare the next board with an item while the last errand runs'
                    : fallback ? 'An errand is running; plan the highest supported lower milestone after collection'
                        : 'An errand is running; wait for completion'};
        }
        const selection = optimize(state.jobs, state.target - state.progress, Math.min(state.errandsReset, state.milestonesReset) - config.deadline_buffer - state.now, config.action_delay);
        const result = {...base, jobs: selection.jobs, reachableProgress: state.progress + selection.reward,
            knownEta: selection.reward >= state.target - state.progress ? state.now + selection.seconds : null};
        if (result.knownEta !== null) {
            return {...result, action: 'start', job: selection.jobs[0], reason: 'Visible errands reach the target before both resets'};
        }
        const prediction = predict();
        result.forecast = prediction;
        result.attainableMilestone = prediction.bestMilestone;
        const best = prediction.best;
        const supported = best && (config.confidence_guard ? best.lowerProbability : best.probability) * 100 >= config.success_percent;
        if (config.milestone_fallback && !supported) {
            const goal = (state.milestones || []).filter(item => !item.achieved && Number.isFinite(item.target)
                && item.target > state.progress && item.target < state.target && item.target <= result.reachableProgress)
                .sort((a, b) => b.target - a.target)[0];
            const projected = prediction.bestMilestone;
            if (projected && projected.target < state.target && (!goal || projected.target > goal.target)) {
                const next = plan({...state, target: projected.target}, {...config, milestone_fallback: false}, history, () => ({ready: true, best: projected.best, options: projected.options}));
                return {...next, state, forecast: prediction, attainableMilestone: projected,
                    goalTarget: projected.target, fallback: true,
                    reason: 'Plan toward the highest supported lower milestone: ' + next.reason};
            }
            if (goal) {
                const fallback = optimize(state.jobs, goal.target - state.progress, Math.min(state.errandsReset, state.milestonesReset) - config.deadline_buffer - state.now, config.action_delay);
                return {...result, action: 'start', jobs: fallback.jobs, job: fallback.jobs[0], goalTarget: goal.target,
                    fallback: true, knownEta: state.now + fallback.seconds,
                    reason: 'Secure the highest visible attainable milestone; the configured target stays unchanged'};
            }
        }
        if (best && best.action === 'reroll') {
            return {...result, action: 'reroll', reason: 'An item reroll materially improves the forecast before the deadline'};
        }
        if (selection.jobs.length && (!best || best.action === 'continue')) {
            return {...result, action: 'start', job: selection.jobs[0], reason: 'Collect the best feasible visible rewards, then recalculate'};
        }
        const close = state.errandsReset - state.now <= config.free_refresh_wait;
        return {...result, reason: best && best.action === 'wait' || close
            ? 'Wait for free errands and keep reroll items'
            : prediction.ready ? 'No useful reroll within the item budget; wait for the next reset' : prediction.reason};
    };
    return {validSettings, invalidSettings, validJob, optimize, forecast, plan, budgetFor, timingEstimate, canRerollRunning};
});
