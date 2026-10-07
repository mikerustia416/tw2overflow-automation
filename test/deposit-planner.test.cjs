const assert = require('node:assert/strict');
const test = require('node:test');
const {fixture} = require('./farm-fixture.cjs');
const plain = value => JSON.parse(JSON.stringify(value));

function setup(options = {}) {
    const f = fixture({deferFarmInit: true, storageEntries: options.storageEntries, separateEventQueue: true});
    // Existing forecasting regressions exercise history mode explicitly.
    f.storage.set('deposit_planner_settings', {fixed_yield_rerolls: options.fixedYield === true,
        ...f.storage.get('deposit_planner_settings')});
    const clock = f.get('helper/time');
    f.context.Date = class extends Date { static now() { return clock.gameTime(); } };
    const data = {jobs: [], progress: 0, cap: 10000, reset: 5000, milestones: 10000, ...options.data};
    const model = {
        isAvailable: () => true,
        getResourcesLeft: () => data.cap - data.progress,
        getMilestones: () => [250, 750, 1500, 3000, 6000, data.cap].map(target => ({target, achieved: data.progress >= target, i18n: 'Reward ' + target, amount: 1})),
        getReadyJobs: () => data.jobs.filter(job => job.state === 2),
        getCollectibleJobs: () => data.jobs.filter(job => job.state === 1),
        getCurrentJob: () => data.jobs.find(job => job.state === 0)
    };
    let item = {id: 42, type: 'resource_deposit_reroll', amount: 9};
    let effect = null;
    Object.assign(f.context.modelDataService, {
        getSelectedVillage: () => ({getId: () => 1}),
        getWorldConfig: () => ({isResourceDepositEnabled: () => options.enabled !== false}),
        getInventory: () => ({getItemByType: () => item}),
        getTribeSkills: () => null
    });
    f.context.modelDataService.getSelectedCharacter().getResourceDeposit = () => model;
    f.context.injector = {get: name => name === 'resourceDepositService' ? {enableRerollButton: () => options.runningRerollAllowed === true} : {getStackedEffect: () => effect, getEffectValue: e => e.value}};
    f.setModule('helper/time', {...clock, server2ClientTime: seconds => seconds * 1000 + (options.skew || 0)});
    f.setModule('conf/effectTypes', {INCREASED_CARRYING_CAPACITY: 'loot', RESOURCE_DEPOSIT_JOB_DURATION: 'speed'});
    f.setModule('conf/tribeSkillNames', {loot_bonus: 'loot', raid_speed: 'speed'});
    for (const name of ['RESOURCE_DEPOSIT_INFO', 'RESOURCE_DEPOSIT_JOBS_REROLLED', 'RESOURCE_DEPOSIT_JOB_STARTED',
        'RESOURCE_DEPOSIT_JOB_COLLECTED', 'RESOURCE_DEPOSIT_JOB_COLLECTIBLE', 'INVENTORY_ITEM_CHANGED']) f.events[name] = name;
    for (const name of ['RESOURCE_DEPOSIT_GET_INFO', 'RESOURCE_DEPOSIT_START_JOB', 'RESOURCE_DEPOSIT_COLLECT', 'PREMIUM_USE_ITEM']) f.context.routeProvider[name] = {type: name};
    const requests = [];
    const receiveInfo = () => f.rootScope.$broadcast(f.events.RESOURCE_DEPOSIT_INFO, {time_next_reset: data.reset, time_new_milestones: data.milestones});
    f.context.socketService.emit = (route, payload, callback) => {
        requests.push({route: route.type, payload, callback});
        if (route.type === 'RESOURCE_DEPOSIT_GET_INFO' && options.autoInfo !== false) receiveInfo();
    };
    for (const file of ['settings', 'policy', 'adapter', 'core', 'migration']) f.loadSource('src/modules/deposit_planner/src/' + file + '.js');
    f.loadSource('src/module-state.js');
    const planner = f.get('two/depositPlanner');
    const policy = f.get('two/depositPlanner/policy');
    f.setModule('two/depositPlanner/ui', () => {});
    f.context.require = (deps, callback) => callback(...deps.map(f.get));
    const boot = () => f.loadSource('src/modules/deposit_planner/src/init.js');
    const sends = () => requests.filter(request => request.route !== 'RESOURCE_DEPOSIT_GET_INFO');
    const sampleState = () => f.get('two/depositPlanner/adapter').snapshot({time_next_reset: data.reset, time_new_milestones: data.milestones}, planner.getSettings().getAll(), 0);
    boot();
    return {...f, planner, policy, data, requests, sends, boot, receiveInfo, sampleState,
        item: () => item, setItem: value => {item = value;}, setEffect: value => {effect = value;}};
}
const job = (id, duration, amount, extra = {}) => ({id, duration, amount, resource_type: 'wood', state: 2, ...extra});
const board = () => Array.from({length: 6}, (_, id) => job(id, 10, 100));
const history = (state, count = 5) => Array.from({length: count}, (_, id) => ({key: String(id), at: state.now, context: state.context, jobs: board()}));

test('exact selection beats shortest-first and rate-first, without mutating the board', () => {
    const f = setup();
    const jobs = [job('short', 5, 100), job('target', 25, 700), job('rate', 10, 300)];
    const copy = plain(jobs);
    const result = f.policy.optimize(jobs, 700, 25, 0);
    assert.deepEqual(plain(result.jobs.map(item => item.id)), ['target']);
    assert.equal(result.seconds, 25);
    assert.deepEqual(jobs, copy);
    assert.equal(f.policy.optimize(jobs, 700, 25, 1).reward, 400);
    assert.equal(f.policy.optimize([], 700, 25, 0).jobs.length, 0);
});

test('exact subsets match an independent exhaustive sequence oracle on 1000 six-job boards', () => {
    const f = setup();
    let seed = 731;
    const rng = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
    function oracle(jobs, gap, budget, delay) {
        let best = {reward: 0, seconds: 0};
        function visit(mask, reward, seconds) {
            reward = Math.min(gap, reward);
            if (reward > best.reward || reward === best.reward && seconds < best.seconds) best = {reward, seconds};
            for (let i = 0; i < jobs.length; i++) if (!(mask & (1 << i))) {
                const next = seconds + jobs[i].duration + delay;
                if (next <= budget) visit(mask | (1 << i), reward + jobs[i].amount, next);
            }
        }
        visit(0, 0, 0);
        return best;
    }
    for (let k = 0; k < 1000; k++) {
        const jobs = Array.from({length: 6}, (_, id) => job(id, 1 + rng(50), 1 + rng(1000)));
        const gap = 1 + rng(5000), budget = rng(200), delay = rng(4);
        const actual = f.policy.optimize(jobs, gap, budget, delay);
        assert.deepEqual({reward: actual.reward, seconds: actual.seconds}, oracle(jobs, gap, budget, delay));
    }
});

test('both reset deadlines include the buffer; expired state must refresh before any action', () => {
    const f = setup({data: {jobs: [job(1, 80, 700)], reset: 1100, milestones: 5000}});
    const config = {...f.planner.getSettings().getAll(), target: 700};
    let state = {...f.sampleState(), target: 700};
    assert.equal(f.policy.plan(state, config).action, 'wait');
    assert.equal(f.policy.plan({...state, errandsReset: 5000, milestonesReset: 1100}, config).action, 'wait');
    assert.equal(f.policy.plan({...state, errandsReset: 1000, collectible: [job(2, 10, 300)]}, config).action, 'refresh');
    assert.equal(f.policy.plan({...state, errandsReset: 5000}, config).action, 'start');
    assert.throws(() => f.policy.optimize([job(1, NaN, 100)], 700, 1000, 2));
});

test('forecasts use complete boards with matching bonuses, and are repeatable', () => {
    const f = setup();
    const state = {...f.sampleState(), target: 700, errandsReset: 1005};
    const config = {...f.planner.getSettings().getAll(), auto_reroll: true};
    assert.equal(f.policy.forecast(state, config, history(state, 4)).ready, false);
    const samples = history(state);
    samples.push({context: 'other bonuses', at: state.now, jobs: board()});
    samples.push({context: state.context, at: state.now, jobs: board().slice(0, 3)});
    const result = f.policy.forecast(state, config, samples);
    assert.equal(result.sampleCount, 5);
    assert.deepEqual(plain(result), plain(f.policy.forecast(state, config, samples)));
    assert.equal(result.best.action, 'wait');
    assert.equal(result.best.itemLimit, 1);
    assert.equal(f.policy.plan(state, config, samples).action, 'wait');
});

test('reroll forecast respects item reserves, cycle limits, disabled rerolls and impossible targets', () => {
    const f = setup();
    const state = {...f.sampleState(), target: 500, errandsReset: 10000, milestonesReset: 2000};
    const config = {...f.planner.getSettings().getAll(), auto_reroll: true};
    assert.equal(f.policy.plan(state, config, history(state)).action, 'reroll');
    assert.equal(f.policy.plan({...state, itemCount: 1}, config, history(state)).action, 'wait');
    assert.equal(f.policy.plan({...state, rerollsUsed: 3}, config, history(state)).action, 'wait');
    assert.equal(f.policy.plan(state, {...config, auto_reroll: false}, history(state)).action, 'wait');
    assert.equal(f.policy.plan({...state, target: 10000, milestonesReset: 1050}, config, history(state)).action, 'wait');
});

test('reroll resource forecast uses 850 per usable item and preserves uncollected progress', () => {
    const f = setup();
    const state = {...f.sampleState(), progress: 5982, target: 10000,
        milestones: [{target: 6000, achieved: false}, {target: 10000, achieved: false}], itemCount: 6, rerollsUsed: 0};
    const config = {...f.planner.getSettings().getAll(), fallback_minimum_resources: 850, max_rerolls: 20, reserve_items: 1};
    const estimate = f.policy.fallbackRerollEstimate(state, config, 83);
    assert.equal(estimate.availableRerolls, 5);
    assert.equal(estimate.rerollProgress, 4250);
    assert.equal(estimate.projectedProgress, 10315);
    assert.equal(state.progress, 5982);
    assert.equal(estimate.nextMilestone.target, 6000);
    assert.equal(estimate.nextMilestoneReachable, true);
    assert.equal(estimate.targetReachable, true);
    assert.equal(estimate.resourceOnly, true);
    assert.equal(f.policy.fallbackRerollEstimate({...state, itemCount: 1}, config, 83).availableRerolls, 0);
});

test('fixed 850 forecast bypasses all history and percentage checks for ordinary and early rerolls', () => {
    const f = setup({fixedYield: true});
    const state = {...f.sampleState(), progress: 5982, target: 10000, itemCount: 6,
        current: {...job('running', 20, 83), completedAt: 1020}, jobs: [], runningRerollAllowed: true};
    const config = {...f.planner.getSettings().getAll(), auto_reroll: true, max_rerolls: 20,
        success_percent: 100, min_samples: 30, min_improvement: 100};
    const predict = () => {throw Error('History forecast must not run');};
    const early = f.policy.plan(state, config, [], predict);
    assert.equal(early.action, 'reroll');
    assert.equal(early.earlyReroll, true);
    assert.equal(early.goalTarget, 10000);
    assert.equal(early.fallbackRerollEstimate.projectedProgress, 10315);
    assert.equal(early.fallbackRerollEstimate.rerollsNeeded, 5);
    assert.equal(early.forecast, null);
    const ordinary = f.policy.plan({...state, progress: 6065, current: null}, config, [], predict);
    assert.equal(ordinary.action, 'reroll');
    assert.equal(ordinary.earlyReroll, false);
    assert.match(ordinary.reason, /850 resources per reroll/);
});

test('fixed yield retains reserves, limits, deadline buffers, capability and reachable milestone decisions', () => {
    const f = setup({fixedYield: true});
    const state = {...f.sampleState(), target: 10000, progress: 6065, itemCount: 6, jobs: []};
    const config = {...f.planner.getSettings().getAll(), auto_reroll: true, max_rerolls: 20};
    for (const [snapshot, options] of [[{...state, itemCount: 1}, config],
        [{...state, rerollsUsed: 20}, config], [{...state, itemId: null}, config],
        [{...state, errandsReset: state.now + config.deadline_buffer}, config],
        [{...state, milestonesReset: state.now + config.deadline_buffer}, config],
        [state, {...config, auto_reroll: false}], [state, {...config, min_gain_per_item: 851}]]) {
        assert.notEqual(f.policy.plan(snapshot, options).action, 'reroll');
    }
    const active = {...state, progress: 5982, current: {...job('running', 20, 83), completedAt: 1020}};
    assert.equal(f.policy.plan({...active, runningRerollAllowed: false}, config).action, 'wait');
    assert.equal(f.policy.plan({...active, runningRerollAllowed: true, jobs: [job(2, 20, 100)]}, config).action, 'wait');
    const outOfReach = {...state, progress: 300, itemCount: 4};
    assert.equal(f.policy.plan(outOfReach, config).action, 'wait');
    const lower = f.policy.plan(outOfReach, {...config, milestone_fallback: true});
    assert.equal(lower.action, 'reroll');
    assert.equal(lower.goalTarget, 1500);
    assert.equal(lower.fallback, true);
    assert.equal(lower.state.target, 10000);
});

test('fixed yield consumes useful visible errands and collects before spending another item', () => {
    const f = setup({fixedYield: true});
    const state = {...f.sampleState(), progress: 6065, itemCount: 6, jobs: [job(1, 20, 900)]};
    const config = {...f.planner.getSettings().getAll(), auto_reroll: true, max_rerolls: 20};
    const visible = f.policy.plan(state, config);
    assert.equal(visible.action, 'start');
    assert.equal(visible.job.id, 1);
    assert.equal(visible.fallbackRerollEstimate.baseline, 900);
    assert.equal(f.policy.plan({...state, jobs: [], collectible: [{...job(1, 20, 900), completedAt: state.now}]}, config).action, 'collect');
    const covered = f.policy.plan({...state, jobs: [job(2, 20, 4000)]}, config);
    assert.equal(covered.action, 'start');
    assert.equal(covered.fallbackRerollEstimate.rerollsNeeded, 0);
    assert.equal(covered.knownEta, state.now + 22);
});

test('fixed mode sends one inventory reroll without history, confirms it and recalculates the actual board', async () => {
    const f = setup({fixedYield: true, data: {progress: 6065, jobs: []}});
    f.setItem({id: 42, type: 'resource_deposit_reroll', amount: 6});
    f.planner.getSettings().setAll({auto_reroll: true, max_rerolls: 20});
    f.receiveInfo();
    f.planner.start();
    await f.tick(1000);
    assert.equal(f.sends().length, 1);
    assert.equal(f.sends()[0].route, 'PREMIUM_USE_ITEM');
    assert.equal(f.storage.get('deposit_planner_cycle').spent, 1);
    f.sends()[0].callback({});
    await f.tick(1000);
    assert.equal(f.sends().length, 1, 'An acknowledgement alone cannot trigger another spend');
    f.setItem({id: 42, type: 'resource_deposit_reroll', amount: 5});
    f.data.jobs = Array.from({length: 6}, (_, id) => job(id, 10, 150));
    f.receiveInfo();
    await f.tick(1000);
    assert.equal(f.sends().length, 2);
    assert.equal(f.sends()[1].route, 'RESOURCE_DEPOSIT_START_JOB');
    assert.equal(f.planner.getPlan().fallbackRerollEstimate.baseline, 900);
    assert.equal(f.planner.getPlan().forecast, null);
    assert.equal(f.storage.has('deposit_planner_samples'), false);
});

test('known reachable targets need no rerolls; running errands have conditional forecast ETAs', () => {
    const f = setup({data: {jobs: [job(1, 100, 700)]}});
    const config = {...f.planner.getSettings().getAll(), auto_reroll: true};
    const state = {...f.sampleState(), target: 700};
    const exact = f.policy.plan(state, config, history(state));
    assert.equal(exact.action, 'start');
    assert.equal(exact.knownEta, state.now + 102);
    const active = {...state, jobs: [], current: {...job(2, 100, 700), completedAt: 1100}};
    const result = f.policy.plan(active, config, history(state));
    assert.equal(result.action, 'wait');
    assert.equal(result.forecast.best.eta, 1102);
    assert.equal(result.forecast.best.itemLimit, 0);
});

test('paused forecasts have zero game mutations, and running/paused settings restore through actual startup', async () => {
    const f = setup({data: {jobs: [job(1, 20, 500)]}});
    await f.tick(60000);
    assert.equal(f.sends().length, 0);
    assert.equal(f.planner.isRunning(), false);
    assert.ok(f.requests.length >= 3, 'Paused polling keeps refreshing server data');
    f.planner.start();
    assert.equal(f.storage.get('deposit_planner_active'), true);
    f.planner.getSettings().set('target', 500);
    const reloaded = setup({storageEntries: [...f.storage.entries()], data: {jobs: [job(1, 20, 500)]}});
    assert.equal(reloaded.planner.isRunning(), true);
    assert.equal(reloaded.planner.getSettings().get('target'), 500);
    const timers = [...reloaded.timers.keys()];
    reloaded.boot();
    assert.deepEqual([...reloaded.timers.keys()], timers);
    reloaded.planner.stop();
    const paused = setup({storageEntries: [...reloaded.storage.entries()]});
    assert.equal(paused.planner.isRunning(), false);
    assert.equal(paused.storage.get('deposit_planner_active'), false);
    assert.equal(paused.planner.getSettings().get('target'), 500);
});

test('start/collection are single-flight; delayed callbacks after pause cannot send another action', async () => {
    const f = setup({data: {jobs: [job(1, 20, 500)]}});
    f.planner.getSettings().setAll({target: 500});
    f.planner.start();
    await f.tick(29000);
    assert.equal(f.sends().length, 1);
    assert.equal(f.sends()[0].route, 'RESOURCE_DEPOSIT_START_JOB');
    f.receiveInfo();
    await f.tick(1000);
    assert.equal(f.sends().length, 1);
    f.data.jobs[0].state = 0;
    f.data.jobs[0].time_completed = 1030;
    f.receiveInfo();
    assert.equal(f.planner.getPending(), null);
    f.data.jobs[0].state = 1;
    f.rootScope.$broadcast(f.events.RESOURCE_DEPOSIT_JOB_COLLECTIBLE);
    await f.tick(1000);
    assert.equal(f.sends().length, 2);
    assert.equal(f.sends()[1].route, 'RESOURCE_DEPOSIT_COLLECT');
    f.planner.stop();
    f.data.progress = 500;
    f.data.jobs = [];
    f.sends()[1].callback({});
    await f.tick(60000);
    assert.equal(f.sends().length, 2);
});

test('an uncertain reroll is charged and survives stop/reload; no Crown route is used', async () => {
    const f = setup({data: {reset: 10000, milestones: 2000}});
    const state = f.sampleState();
    f.storage.set('deposit_planner_samples', history(state));
    // Reload so persisted observations are loaded through the real initialization path.
    const active = setup({storageEntries: [...f.storage.entries()], data: {reset: 10000, milestones: 2000}});
    active.planner.getSettings().setAll({auto_reroll: true, target: 500});
    active.planner.start();
    await active.tick(31000);
    assert.equal(active.sends().length, 1);
    assert.equal(active.sends()[0].route, 'PREMIUM_USE_ITEM');
    assert.deepEqual(plain(active.sends()[0].payload), {village_id: 1, item_id: 42});
    assert.equal(active.storage.get('deposit_planner_cycle').spent, 1);
    const loaded = setup({storageEntries: [...active.storage.entries()], data: {reset: 10000, milestones: 2000}});
    await loaded.tick(60000);
    assert.equal(loaded.sends().length, 0);
    assert.equal(loaded.planner.isRunning(), false);
    assert.ok(loaded.planner.getPending());
    loaded.planner.resolvePending();
    assert.equal(loaded.storage.get('deposit_planner_cycle').spent, 1, 'Resolving uncertainty cannot refund reserved items');
});

test('reroll guard clears only after both the board changes and inventory is debited', async () => {
    const f = setup({data: {reset: 10000, milestones: 2000}});
    const state = f.sampleState();
    const pending = {action: 'reroll', itemId: 42, itemCount: 9, boardKey: '[]', progress: 0, cycleId: 2000, sentAt: 1000};
    const g = setup({storageEntries: [['deposit_planner_pending', pending]], data: {jobs: board(), reset: 10000, milestones: 2000}});
    assert.ok(g.planner.getPending());
    g.setItem({id: 42, type: 'resource_deposit_reroll', amount: 8});
    g.receiveInfo();
    assert.equal(g.planner.getPending(), null);
    assert.equal(g.storage.get('deposit_planner_pending'), null);
});

test('cycle budgets reset only after the previous milestone deadline passes', async () => {
    const f = setup({storageEntries: [['deposit_planner_cycle', {reset: 1500, spent: 3}]], data: {milestones: 2000}});
    assert.equal(f.planner.getPlan().state.rerollsUsed, 3, 'A corrected future timestamp cannot replenish items');
    await f.tick(1001000);
    f.data.milestones = 3000;
    f.receiveInfo();
    assert.equal(f.planner.getPlan().state.rerollsUsed, 0);
});

test('adapter uses client-synchronized time once and server amounts without duplicating boosts', () => {
    const f = setup({skew: 7000, data: {jobs: [job(1, '10', '250', {state: 0, time_completed: 1100})], progress: 2809}});
    const state = f.sampleState();
    assert.equal(state.errandsReset, 5007);
    assert.equal(state.current.completedAt, 1107);
    assert.equal(state.current.amount, 250);
    assert.equal(state.progress, 2809);
    f.setEffect({value: 2});
    assert.notEqual(f.sampleState().context, state.context);
});

test('reaching the target holds completed rewards and disabled-world restoration clears stale state', () => {
    const f = setup({data: {progress: 10000, jobs: [job(1, 10, 300, {state: 1})]}});
    assert.equal(f.planner.getPlan().action, 'target');
    const disabled = setup({enabled: false, storageEntries: [['deposit_planner_active', true]]});
    assert.equal(disabled.planner.isRunning(), false);
    assert.equal(disabled.storage.get('deposit_planner_active'), false);
});

test('cautious forecast bands block unsupported automatic rerolls and distinguish certain visible plans', () => {
    const f = setup();
    const state = {...f.sampleState(), target: 500, errandsReset: 10000, milestonesReset: 2000};
    const config = {...f.planner.getSettings().getAll(), auto_reroll: true, success_percent: 100};
    const prediction = f.policy.forecast(state, config, history(state));
    const option = prediction.options.find(item => item.action === 'reroll' && item.itemLimit === 1);
    assert.equal(option.probability, 1);
    assert.ok(option.lowerProbability < 1 && option.lowerProbability > 0.95);
    assert.equal(option.upperProbability, 1);
    assert.equal(prediction.best.action, 'wait', 'Simulation certainty cannot satisfy a 100% cautious threshold');
    assert.equal(f.policy.plan(state, config, history(state)).action, 'wait');
    assert.equal(f.policy.plan(state, {...config, confidence_guard: false}, history(state)).action, 'reroll');
    assert.equal(f.policy.plan({...state, jobs: [job(1, 20, 500)]}, config, history(state)).action, 'start');
});

test('whole-board resampling exposes sensitivity to mixed historical boards', () => {
    const f = setup();
    const state = {...f.sampleState(), target: 500, errandsReset: 10000, milestonesReset: 1140};
    const config = {...f.planner.getSettings().getAll(), auto_reroll: true, max_rerolls: 1, success_percent: 50};
    const samples = history(state);
    samples[0].jobs = samples[1].jobs = board().map(item => ({...item, duration: 1000}));
    const prediction = f.policy.forecast(state, config, samples);
    const option = prediction.options.find(item => item.action === 'reroll');
    assert.ok(option.probability > 0 && option.probability < 1);
    assert.ok(option.lowerProbability < option.probability && option.upperProbability > option.probability);
    assert.equal(prediction.best.action, 'wait');
    assert.match(prediction.reason, /unseen boards remain unknown/);
});

test('item efficiency uses incremental expected progress including failed target runs', () => {
    const f = setup();
    const state = {...f.sampleState(), target: 700, errandsReset: 10000, milestonesReset: 1140};
    const config = {...f.planner.getSettings().getAll(), auto_reroll: true, max_rerolls: 1};
    const prediction = f.policy.forecast(state, config, history(state));
    const option = prediction.options.find(item => item.action === 'reroll');
    assert.equal(option.probability, 0);
    assert.equal(option.expectedGain, 600);
    assert.equal(option.meanItems, 1);
    assert.equal(option.gainPerItem, 600);
    assert.equal(prediction.options.find(item => item.itemLimit === 0).gainPerItem, null);
    const reachable = {...state, target: 500, milestonesReset: 2000};
    assert.equal(f.policy.plan(reachable, config, history(state)).action, 'reroll');
    assert.equal(f.policy.plan(reachable, {...config, min_gain_per_item: 501}, history(state)).action, 'wait');
});

test('item gain is measured against the best no-item strategy rather than total reward', () => {
    const f = setup();
    const state = {...f.sampleState(), target: 500, jobs: [job('visible', 10, 200)], errandsReset: 10000, milestonesReset: 2000};
    const config = {...f.planner.getSettings().getAll(), auto_reroll: true, max_rerolls: 1};
    const prediction = f.policy.forecast(state, config, history(state));
    const option = prediction.options.find(item => item.action === 'reroll');
    assert.equal(option.expectedGain, 500);
    assert.equal(option.gainPerItem, 300);
    assert.equal(prediction.options.find(item => item.action === 'continue' && item.itemLimit === 0).expectedGain, 200);
});

test('opt-in fallback chooses the highest visible reachable milestone without changing target holding', () => {
    const f = setup({data: {jobs: [job(1, 10, 300), job(2, 10, 600)]}});
    const state = f.sampleState();
    const config = f.planner.getSettings().getAll();
    const predict = () => ({ready: true, options: [], best: {action: 'wait', probability: 0, lowerProbability: 0}});
    assert.equal(f.policy.plan(state, config, [], predict).action, 'wait');
    const result = f.policy.plan(state, {...config, milestone_fallback: true}, [], predict);
    assert.equal(result.action, 'start');
    assert.equal(result.goalTarget, 750);
    assert.equal(result.knownEta, state.now + 24);
    assert.equal(result.state.target, 10000);
    assert.equal(config.target, 0);
    assert.notEqual(f.policy.plan({...state, progress: 900, jobs: []}, {...config, milestone_fallback: true}, [], predict).action, 'target');
    assert.equal(f.policy.plan({...state, progress: 10000}, {...config, milestone_fallback: true}).action, 'target');
});

test('fallback obeys both reset buffers and needs no historical forecast to secure a visible milestone', () => {
    const f = setup({data: {jobs: [job(1, 20, 300)]}});
    const state = f.sampleState();
    const config = {...f.planner.getSettings().getAll(), milestone_fallback: true};
    assert.equal(f.policy.plan(state, config).goalTarget, 250);
    for (const field of ['errandsReset', 'milestonesReset']) {
        const result = f.policy.plan({...state, [field]: state.now + 80}, config);
        assert.equal(result.action, 'wait');
        assert.equal(result.fallback, undefined);
    }
    assert.equal(f.policy.plan({...state, progress: 300, jobs: [job(1, 20, 300)]}, config).fallback, undefined);
});

test('forecasts do not credit a running errand that crosses either reset buffer', () => {
    const f = setup();
    const state = {...f.sampleState(), target: 500, jobs: [], current: {...job(1, 100, 500), completedAt: 1100}, milestonesReset: 1120};
    const config = {...f.planner.getSettings().getAll(), auto_reroll: false};
    let prediction = f.policy.forecast(state, config, history(state));
    assert.ok(prediction.options.every(option => option.probability === 0 && option.expectedGain === 0 && option.eta === null));
    prediction = f.policy.forecast({...state, errandsReset: 1110, milestonesReset: 1170}, config, history(state));
    assert.ok(prediction.options.every(option => option.probability === 0 && option.expectedGain === 0));
});

test('learned timing uses matching recent observations, the 90th percentile and the configured floor', () => {
    const f = setup();
    const state = f.sampleState(), config = f.planner.getSettings().getAll();
    const entries = [3, 5, 15].map(delay => ({context: state.context, at: state.now, delay}));
    entries.push({context: 'another village', at: state.now, delay: 200}, {context: state.context, at: state.now - 31 * 86400, delay: 200},
        {context: state.context, at: state.now + 10, delay: 200}, {context: state.context, at: state.now, delay: 400});
    assert.deepEqual(plain(f.policy.timingEstimate(entries, state, config)), {sampleCount: 3, learnedDelay: 15, effectiveDelay: 15});
    assert.equal(f.policy.timingEstimate(entries.slice(0, 2), state, config).effectiveDelay, 2);
    assert.equal(f.policy.timingEstimate(entries, state, {...config, action_delay: 30}).effectiveDelay, 30);
    assert.equal(f.policy.timingEstimate(entries, state, {...config, learn_action_delay: false}).effectiveDelay, 2);
});

test('persisted timing changes exact deadline feasibility and survives reload', () => {
    const f = setup();
    const state = f.sampleState();
    const timings = [10, 20, 30].map(delay => ({context: state.context, at: state.now, delay}));
    const g = setup({storageEntries: [['deposit_planner_timing', timings]], data: {jobs: [job(1, 30, 500)], milestones: 1120}});
    g.planner.getSettings().set('target', 500);
    assert.equal(g.planner.getPlan().timing.effectiveDelay, 30);
    assert.equal(g.planner.getPlan().knownEta, 1060);
    g.data.milestones = 1110;
    g.receiveInfo();
    assert.equal(g.planner.getPlan().action, 'wait');
    g.planner.getSettings().set('learn_action_delay', false);
    assert.equal(g.planner.getPlan().action, 'start');
    assert.equal(g.planner.getSettings().get('action_delay'), 2, 'Learning does not overwrite the configured floor');
});

test('timing learns only after owned start and collection are confirmed, never while paused or from callback alone', async () => {
    const f = setup({data: {jobs: [job(1, 20, 500)]}});
    f.planner.getSettings().setAll({target: 500});
    f.planner.start();
    await f.tick(4000);
    const start = f.planner.getPending();
    assert.equal(start.action, 'start');
    f.data.jobs[0].state = 0;
    f.data.jobs[0].time_completed = start.sentAt + 27;
    f.receiveInfo();
    assert.equal(f.storage.has('deposit_planner_timing'), false);
    await f.tick(30000);
    f.data.jobs[0].state = 1;
    f.rootScope.$broadcast(f.events.RESOURCE_DEPOSIT_JOB_COLLECTIBLE);
    await f.tick(1000);
    assert.equal(f.planner.getPending().action, 'collect');
    f.sends()[1].callback({});
    assert.equal(f.storage.has('deposit_planner_timing'), false);
    f.data.progress = 500;
    f.data.jobs = [];
    f.receiveInfo();
    const observations = f.storage.get('deposit_planner_timing');
    assert.equal(observations.length, 1);
    assert.ok(Math.abs(observations[0].delay - (7 + 1035 - (start.sentAt + 27))) < 0.001);
    const paused = setup({data: {jobs: [job(1, 10, 500)]}});
    await paused.tick(60000);
    assert.equal(paused.storage.has('deposit_planner_timing'), false);
});

test('cached visible selection returns current game objects when rewards and durations repeat', () => {
    const f = setup();
    const original = [job(1, 10, 100, {resource: 'wood'})];
    const updated = [job(1, 10, 100, {resource: 'iron', quality: 4})];
    f.policy.optimize(original, 100, 20, 2);
    const result = f.policy.optimize(updated, 100, 20, 2);
    assert.equal(result.jobs[0], updated[0]);
    assert.equal(result.jobs[0].resource, 'iron');
    assert.equal(result.jobs[0].quality, 4);
    assert.equal(f.policy.optimize(updated, 100, 11, 2).jobs.length, 0);
});

test('last running errand looks ahead to the highest supported lower milestone with abundant items', () => {
    const f = setup();
    const state = {...f.sampleState(), progress: 300, target: 10000, jobs: [],
        current: {...job('last', 20, 200), completedAt: 1020}, errandsReset: 10000, milestonesReset: 1190, itemCount: 50};
    const config = {...f.planner.getSettings().getAll(), auto_reroll: true, max_rerolls: 20, milestone_fallback: true};
    const result = f.policy.plan(state, config, history(state));
    assert.equal(result.action, 'wait');
    assert.equal(result.state.target, 10000);
    assert.equal(result.forecast.options.some(option => option.probability > 0), false);
    assert.equal(result.forecast.bestMilestone.target, 750);
    assert.equal(result.attainableMilestone.target, 750);
    assert.equal(result.goalTarget, 750);
    assert.equal(result.fallback, true);
    assert.equal(result.attainableMilestone.best.meanItems, 1);
    assert.equal(result.attainableMilestone.best.eta, 1060, 'ETA follows individual collections, not the whole sampled board');
    assert.ok(result.attainableMilestone.best.lowerProbability >= 0.95);
    assert.equal(result.forecast.milestones.find(item => item.target === 1500).supported, false);
    const disabled = f.policy.plan(state, {...config, milestone_fallback: false}, history(state));
    assert.equal(disabled.attainableMilestone.target, 750, 'Look-ahead remains visible with automatic fallback off');
    assert.equal(disabled.fallback, false);
});

test('after last collection, fallback can reroll toward a supported lower milestone while retaining the saved target', () => {
    const f = setup();
    const state = {...f.sampleState(), now: 1022, progress: 500, target: 10000, jobs: [],
        current: null, errandsReset: 10000, milestonesReset: 1190, itemCount: 50};
    const config = {...f.planner.getSettings().getAll(), auto_reroll: true, max_rerolls: 20, milestone_fallback: true};
    const result = f.policy.plan(state, config, history(state));
    assert.equal(result.action, 'reroll');
    assert.equal(result.goalTarget, 750);
    assert.equal(result.fallback, true);
    assert.equal(result.state.target, 10000);
    const noFallback = f.policy.plan(state, {...config, milestone_fallback: false}, history(state));
    assert.equal(noFallback.action, 'wait');
});

test('milestone look-ahead respects inventory reserves, cycle usage, disabled rerolls and collection deadlines', () => {
    const f = setup();
    const state = {...f.sampleState(), progress: 300, jobs: [], current: {...job(1, 20, 200), completedAt: 1020},
        errandsReset: 10000, milestonesReset: 1190, itemCount: 50};
    const config = {...f.planner.getSettings().getAll(), auto_reroll: true, max_rerolls: 20, milestone_fallback: true};
    for (const [snapshot, options] of [[{...state, itemCount: 1}, config],
        [{...state, rerollsUsed: 20}, config], [state, {...config, auto_reroll: false}],
        [state, {...config, min_gain_per_item: 1000}]]) {
        const result = f.policy.plan(snapshot, options, history(state));
        assert.equal(result.attainableMilestone, undefined);
        assert.equal(result.action, 'wait');
        assert.equal(result.fallback, false);
    }
    const expired = f.policy.plan({...state, current: {...state.current, completedAt: 1140}}, config, history(state));
    assert.equal(expired.attainableMilestone, undefined);
    assert.equal(expired.fallback, false);
});

test('a known current-errand milestone is shown while learning without inventing future rewards', () => {
    const f = setup();
    const state = {...f.sampleState(), current: {...job(1, 20, 800), completedAt: 1020}};
    const config = {...f.planner.getSettings().getAll(), milestone_fallback: true, auto_reroll: true};
    const result = f.policy.plan(state, config, history(state, 4));
    assert.equal(result.forecast.ready, false);
    assert.equal(result.attainableMilestone.target, 750);
    assert.equal(result.attainableMilestone.known, true);
    assert.equal(result.attainableMilestone.best.meanItems, 0);
    assert.equal(result.action, 'wait');
    assert.equal(result.goalTarget, 750);
    const elapsed = f.policy.plan({...state, errandsReset: 1040}, config, history(state, 4));
    assert.equal(elapsed.attainableMilestone, undefined);
});

test('automatic last-errand look-ahead emits no reroll until collection is confirmed', async () => {
    const seed = setup();
    const observations = history(seed.sampleState());
    const f = setup({storageEntries: [['deposit_planner_samples', observations]],
        data: {progress: 300, reset: 10000, milestones: 1190, jobs: [job('last', 20, 200, {state: 0, time_completed: 1020})]}});
    f.planner.getSettings().setAll({auto_reroll: true, milestone_fallback: true, max_rerolls: 20});
    f.planner.start();
    await f.tick(10000);
    assert.equal(f.planner.getPlan().goalTarget, 750);
    assert.equal(f.sends().length, 0);
    await f.tick(11000);
    f.data.jobs[0].state = 1;
    f.rootScope.$broadcast(f.events.RESOURCE_DEPOSIT_JOB_COLLECTIBLE);
    await f.tick(1000);
    assert.equal(f.sends().length, 1);
    assert.equal(f.sends()[0].route, 'RESOURCE_DEPOSIT_COLLECT');
    f.sends()[0].callback({});
    await f.tick(1000);
    assert.equal(f.sends().length, 1, 'Callback alone cannot unlock a reroll');
    f.data.jobs = [];
    f.data.progress = 500;
    f.receiveInfo();
    await f.tick(1000);
    assert.equal(f.sends().length, 2);
    assert.equal(f.sends()[1].route, 'PREMIUM_USE_ITEM');
    assert.equal(f.storage.get('deposit_planner_cycle').spent, 1);
    assert.equal(f.planner.getPlan().state.target, 10000);
});

test('Nothing-to-do preview totals the last running reward and can recommend a verified early item reroll', () => {
    const f = setup();
    const state = {...f.sampleState(), progress: 300, target: 10000, jobs: [], runningRerollAllowed: true,
        current: {...job('last', 20, 200), completedAt: 1020}, errandsReset: 10000, milestonesReset: 1190};
    const config = {...f.planner.getSettings().getAll(), auto_reroll: true, milestone_fallback: true};
    const result = f.policy.plan(state, config, history(state));
    assert.equal(result.action, 'reroll');
    assert.equal(result.earlyReroll, true);
    assert.equal(result.goalTarget, 750);
    assert.equal(result.runningPreview.collectedTotal, 300);
    assert.equal(result.runningPreview.runningReward, 200);
    assert.equal(result.runningPreview.projectedTotal, 500);
    assert.equal(result.runningPreview.remainingGap, 9500);
    assert.equal(result.runningPreview.canRerollNow, true);
    assert.equal(result.state.progress, 300, 'Preview must not credit the uncollected reward');
    assert.equal(result.state.current.id, 'last');
});

test('proactive preview and early reroll are limited to an empty errand list and one still-running last job', () => {
    const f = setup();
    const state = {...f.sampleState(), progress: 300, jobs: [], runningRerollAllowed: true,
        current: {...job('last', 20, 200), completedAt: 1020}, errandsReset: 10000, milestonesReset: 1190};
    const config = {...f.planner.getSettings().getAll(), auto_reroll: true, milestone_fallback: true};
    const ready = {...state, jobs: [job('ready', 10, 100)]};
    assert.equal(f.policy.canRerollRunning(ready, config), false);
    assert.equal(f.policy.plan(ready, config, history(state)).runningPreview, null);
    const completed = {...state, collectible: [job('completed', 10, 100)]};
    assert.equal(f.policy.canRerollRunning(completed, config), false);
    assert.equal(f.policy.plan(completed, config, history(state)).action, 'collect');
    assert.equal(f.policy.canRerollRunning({...state, current: {...state.current, completedAt: state.now}}, config), false);
    assert.equal(f.policy.canRerollRunning({...state, current: null}, config), false);
    assert.equal(f.policy.plan({...state, current: {...state.current, completedAt: state.now}}, config, history(state)).runningPreview, null);
});

test('last-errand preview explains target coverage, item limits, missing capability, learning and deadline failures', () => {
    const f = setup();
    const state = {...f.sampleState(), progress: 300, jobs: [], runningRerollAllowed: true,
        current: {...job('last', 20, 200), completedAt: 1020}, errandsReset: 10000, milestonesReset: 1190};
    const config = {...f.planner.getSettings().getAll(), auto_reroll: true, milestone_fallback: true};
    for (const [snapshot, options, reason] of [[{...state, target: 500}, config, /covers the target/],
        [{...state, itemCount: 1}, config, /No items available/], [{...state, rerollsUsed: 3}, config, /No items available/],
        [{...state, runningRerollAllowed: false}, config, /capability/], [state, {...config, auto_reroll: false}, /disabled/],
        [{...state, milestonesReset: 1070}, config, /cannot be safely collected/]]) {
        const result = f.policy.plan(snapshot, options, history(state));
        assert.equal(result.action, 'wait');
        assert.equal(result.runningPreview.canRerollNow, false);
        assert.match(result.runningPreview.reason, reason);
    }
    const learning = f.policy.plan(state, config, history(state, 4));
    assert.equal(learning.runningPreview.canRerollNow, false);
    assert.match(learning.runningPreview.reason, /Learning complete boards/);
    const over = f.policy.plan({...state, progress: 9900, current: {...state.current, amount: 200}}, config, history(state));
    assert.equal(over.runningPreview.projectedTotal, 10100, 'Total includes reward overshoot');
    assert.equal(over.runningPreview.remainingGap, 0);
});

test('early automatic reroll preserves the active errand and waits for inventory and board confirmation', async () => {
    const seed = setup();
    const f = setup({runningRerollAllowed: true, storageEntries: [['deposit_planner_samples', history(seed.sampleState())]],
        data: {progress: 300, reset: 10000, milestones: 1190, jobs: [job('last', 20, 200, {state: 0, time_completed: 1020})]}});
    f.planner.getSettings().setAll({auto_reroll: true, milestone_fallback: true});
    f.planner.start();
    await f.tick(5000);
    assert.equal(f.sends().length, 1);
    assert.equal(f.sends()[0].route, 'PREMIUM_USE_ITEM');
    assert.equal(f.planner.getPending().runningJobId, 'last');
    assert.equal(f.data.jobs[0].state, 0);
    assert.equal(f.storage.get('deposit_planner_cycle').spent, 1);
    f.data.jobs.push(...board());
    f.receiveInfo();
    assert.ok(f.planner.getPending(), 'Changed board alone cannot acknowledge item use');
    f.setItem({id: 42, type: 'resource_deposit_reroll', amount: 8});
    f.receiveInfo();
    assert.equal(f.planner.getPending(), null);
    await f.tick(1000);
    assert.equal(f.sends().length, 1, 'New ready jobs prevent another proactive reroll, and no second errand can start');
});

test('an early reroll that loses the running job retains the guard and stops automation', async () => {
    const seed = setup();
    const f = setup({runningRerollAllowed: true, storageEntries: [['deposit_planner_samples', history(seed.sampleState())]],
        data: {progress: 300, reset: 10000, milestones: 1190, jobs: [job('last', 20, 200, {state: 0, time_completed: 1020})]}});
    f.planner.getSettings().setAll({auto_reroll: true, milestone_fallback: true});
    f.planner.start();
    await f.tick(5000);
    f.data.jobs = board();
    f.setItem({id: 42, type: 'resource_deposit_reroll', amount: 8});
    f.receiveInfo();
    assert.equal(f.planner.isRunning(), false);
    assert.ok(f.planner.getPending());
    assert.match(f.planner.getStatus(), /Running errand changed/);
    await f.tick(60000);
    assert.equal(f.sends().length, 1);
});

test('Nothing-to-do early reroll forecast remains read-only while paused', async () => {
    const seed = setup();
    const f = setup({runningRerollAllowed: true, storageEntries: [['deposit_planner_samples', history(seed.sampleState())]],
        data: {progress: 300, reset: 10000, milestones: 1190, jobs: [job('last', 20, 200, {state: 0, time_completed: 1020})]}});
    f.planner.getSettings().setAll({auto_reroll: true, milestone_fallback: true});
    await f.tick(5000);
    assert.equal(f.planner.getPlan().runningPreview.canRerollNow, true);
    assert.equal(f.sends().length, 0);
    assert.equal(f.storage.get('deposit_planner_cycle').spent, 0);
});


test('the retired Collector cannot submit deposit actions or pause the unified planner', async () => {
    const f = setup({data: {jobs: [job(1, 20, 500)]}});
    f.loadSource('src/modules/auto_collector/src/core.js');
    const collector = f.get('two/autoCollector');
    assert.equal(collector.start, undefined);
    f.planner.getSettings().set('target', 500);
    f.planner.start();
    f.get('queues/EventQueue').trigger('auto_collector_started');
    await f.tick(1000);
    assert.equal(f.planner.isRunning(), true);
    assert.equal(f.sends().length, 1);
    assert.equal(f.sends()[0].route, 'RESOURCE_DEPOSIT_START_JOB');
});

test('migration preserves actual runs and explicit pauses, and converts old running previews to paused forecasts', () => {
    const cases = [
        {entries: [], running: false},
        {entries: [['deposit_planner_active', true], ['deposit_planner_settings', {preview_only: true, auto_reroll: true}]], running: false},
        {entries: [['deposit_planner_active', true]], running: false},
        {entries: [['deposit_planner_active', true], ['deposit_planner_settings', {preview_only: false, target: 750}]], running: true},
        {entries: [['deposit_planner_active', false], ['auto_collector_active', true]], running: false},
        {entries: [['auto_collector_active', true], ['deposit_planner_settings', {preview_only: true, auto_reroll: true}]], running: true, inherited: true},
        {entries: [['auto_collector_active', true], ['auto_collector_second_village_active', false]], running: true, inherited: true, second: false}
    ];
    for (const scenario of cases) {
        const f = setup({storageEntries: scenario.entries});
        assert.equal(f.planner.isRunning(), scenario.running);
        assert.equal(f.storage.get('deposit_planner_active'), scenario.running);
        assert.equal(f.storage.get('auto_collector_active'), false);
        assert.equal(f.storage.get('deposit_planner_unified'), true);
        assert.equal(f.planner.getSettings().settingsMap.preview_only, undefined);
        assert.equal(Object.hasOwn(f.storage.get('deposit_planner_settings'), 'preview_only'), false);
        if (scenario.inherited) assert.equal(f.planner.getSettings().get('auto_reroll'), false);
        if (scenario.second === false) assert.equal(f.storage.get('auto_collector_second_village_active'), false);
        f.planner.stop();
        f.storage.set('auto_collector_active', true);
        const reloaded = setup({storageEntries: [...f.storage.entries()]});
        assert.equal(reloaded.planner.isRunning(), false, 'Migration runs once and cannot undo a new explicit pause');
    }
});

test('Start executes without a preview switch, Pause refreshes forecasts without orders, and rerolls stay opt-in', async () => {
    const f = setup({data: {jobs: [job(1, 20, 500)]}});
    f.planner.getSettings().set('target', 500);
    await f.tick(31000);
    assert.equal(f.sends().length, 0);
    assert.equal(f.planner.getPlan().action, 'start');
    f.planner.start();
    await f.tick(1000);
    assert.equal(f.sends().length, 1);
    f.planner.stop();
    f.data.jobs[0].state = 0;
    f.data.jobs[0].time_completed = 1055;
    f.receiveInfo();
    assert.equal(f.planner.getPending(), null);
    f.data.jobs[0].state = 1;
    await f.tick(31000);
    assert.equal(f.planner.getPlan().action, 'collect', 'Paused forecasts still observe game changes');
    assert.equal(f.sends().length, 1, 'Pause prevents collecting and every other mutation');
    assert.equal(f.planner.getSettings().get('auto_reroll'), false);
});

test('unresolved guards reject Start without resubmission and remain protected across reload', async () => {
    const pending = {action: 'start', jobId: 'missing', sentAt: 900, progress: 0, cycleId: 10000};
    const f = setup({storageEntries: [['deposit_planner_pending', pending]], data: {jobs: [job(1, 20, 500)]}});
    assert.equal(f.planner.start(), false);
    assert.match(f.planner.getStatus(), /resolve the guard before Start/);
    await f.tick(31000);
    assert.equal(f.sends().length, 0);
    assert.ok(f.planner.getPending());
    const reloaded = setup({storageEntries: [...f.storage.entries()]});
    assert.equal(reloaded.planner.start(), false);
    assert.ok(reloaded.planner.getPending());
});


test('invalid saved poll intervals cannot start automation or create a rapid paused polling loop', async () => {
    const f = setup({storageEntries: [['deposit_planner_settings', {poll_seconds: 0}]]});
    assert.equal(f.planner.start(), false);
    const before = f.requests.length;
    await f.tick(31000);
    assert.equal(f.requests.length - before, 1);
    assert.equal(f.sends().length, 0);
});
