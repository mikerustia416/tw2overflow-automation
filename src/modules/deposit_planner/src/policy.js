define('two/depositPlanner/policy', [], function () {
    const REFRESH_SECONDS = 8 * 60 * 60;
    const FORECAST_RUNS = 128;
    const validSettings = function (config, map) {
        return Object.entries(map).every(([key, field]) => field.inputType === 'checkbox'
            ? typeof config[key] === 'boolean'
            : Number.isInteger(config[key]) && config[key] >= field.min && config[key] <= field.max);
    };
    const validJob = job => job && job.id !== undefined && Number.isFinite(job.duration) && job.duration > 0
        && Number.isFinite(job.amount) && job.amount > 0;
    const ordered = jobs => jobs.slice().sort((a, b) => b.amount / b.duration - a.amount / a.duration
        || a.duration - b.duration || String(a.id).localeCompare(String(b.id)));

    // Exact for a fixed board: collect every selected job before both deadlines.
    // Deliberately do not assume that starting a job protects it from an errand reset.
    const optimize = function (jobs, gap, budget, delay) {
        if (!Array.isArray(jobs) || jobs.length > 12 || !jobs.every(validJob)) {
            throw new Error('Errand rewards or durations unavailable');
        }
        let best = {jobs: [], reward: 0, seconds: 0};
        for (let mask = 1; gap > 0 && mask < 2 ** jobs.length; mask++) {
            const selected = jobs.filter((job, index) => mask & (1 << index));
            const seconds = selected.reduce((sum, job) => sum + job.duration + delay, 0);
            const reward = Math.min(gap, selected.reduce((sum, job) => sum + job.amount, 0));
            if (seconds <= budget && (reward > best.reward || reward === best.reward && seconds < best.seconds)) {
                best = {jobs: ordered(selected), reward, seconds};
            }
        }
        return best;
    };
    const quantile = function (values, fraction) {
        if (!values.length) {
            return null;
        }
        const sorted = values.slice().sort((a, b) => a - b);
        return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
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

    const simulate = function (state, config, samples, first, limit, seed) {
        const rng = random(seed);
        let time = state.now;
        let progress = state.progress;
        let free = state.errandsReset;
        let jobs = state.jobs.map(job => ({...job}));
        let spent = 0;
        const deadline = state.milestonesReset - config.deadline_buffer;
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
        if (state.current) {
            time = Math.max(time, state.current.completedAt) + config.action_delay;
            progress += state.current.amount;
            if (progress >= state.target || time >= deadline) {
                return {success: progress >= state.target && time <= deadline, time, spent};
            }
            if (time >= free) {
                wait();
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
                const job = selection.jobs[0];
                time += job.duration + config.action_delay;
                progress += job.amount;
                jobs = jobs.filter(candidate => candidate.id !== job.id);
            } else if (free < deadline && (free - time <= config.free_refresh_wait || spent >= limit)) {
                wait();
            } else if (spent < limit) {
                reroll();
            } else {
                break;
            }
        }
        return {success: progress >= state.target && time <= deadline, time, spent};
    };

    const forecast = function (state, config, history) {
        const samples = history.filter(sample => sample.context === state.context && sample.jobs.length === 6
            && sample.jobs.every(validJob) && sample.at >= state.now - 30 * 86400);
        if (samples.length < config.min_samples) {
            return {ready: false, sampleCount: samples.length, options: [], reason: 'Learning complete boards before estimating rerolls'};
        }
        const options = [];
        const maximum = config.auto_reroll ? budgetFor(state, config) : 0;
        // Common random numbers make candidate comparisons repeatable and fair.
        const baseSeed = hash(JSON.stringify([state.jobs, state.progress, Math.floor(state.now / 30), state.context]));
        for (const action of ['continue', 'wait', 'reroll']) {
            if (action === 'continue' && !state.current && !optimize(state.jobs, state.target - state.progress, Math.min(state.errandsReset, state.milestonesReset) - config.deadline_buffer - state.now, config.action_delay).jobs.length) {
                continue;
            }
            for (let limit = action === 'reroll' ? 1 : 0; limit <= maximum; limit++) {
                const results = Array.from({length: FORECAST_RUNS}, (unused, index) => simulate(state, config, samples, action, limit, baseSeed + index * 7919));
                const successes = results.filter(result => result.success);
                const times = successes.map(result => result.time);
                options.push({action, itemLimit: limit, probability: successes.length / results.length,
                    eta: quantile(times, 0.5), conservativeEta: quantile(times, 0.9),
                    meanItems: results.reduce((sum, result) => sum + result.spent, 0) / results.length});
            }
        }
        const reliable = options.filter(option => option.probability * 100 >= config.success_percent);
        const rank = option => option.action === 'continue' ? 0 : option.action === 'wait' ? 1 : 2;
        const contenders = reliable.length ? reliable : options;
        contenders.sort((a, b) => (reliable.length ? a.itemLimit - b.itemLimit : b.probability - a.probability)
            || a.meanItems - b.meanItems || rank(a) - rank(b) || (a.eta || Infinity) - (b.eta || Infinity));
        let best = contenders[0];
        const withoutReroll = options.filter(option => option.action !== 'reroll')
            .sort((a, b) => b.probability - a.probability || a.itemLimit - b.itemLimit || rank(a) - rank(b))[0];
        if (best && best.action === 'reroll' && withoutReroll
            && (best.probability - withoutReroll.probability) * 100 < config.min_improvement) {
            best = withoutReroll;
        }
        return {ready: true, sampleCount: samples.length, best, options,
            reason: 'Empirical simulation; ETAs describe successful runs and are not guarantees'};
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
            return {...base, reason: 'An errand is running; wait for completion', forecast: predict()};
        }
        const selection = optimize(state.jobs, state.target - state.progress, Math.min(state.errandsReset, state.milestonesReset) - config.deadline_buffer - state.now, config.action_delay);
        const result = {...base, jobs: selection.jobs, reachableProgress: state.progress + selection.reward,
            knownEta: selection.reward >= state.target - state.progress ? state.now + selection.seconds : null};
        if (result.knownEta !== null) {
            return {...result, action: 'start', job: selection.jobs[0], reason: 'Visible errands reach the target before both resets'};
        }
        const prediction = predict();
        result.forecast = prediction;
        const best = prediction.best;
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
    return {validSettings, validJob, optimize, forecast, plan, budgetFor};
});
