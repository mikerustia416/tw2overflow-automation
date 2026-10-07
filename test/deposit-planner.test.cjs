const assert = require('node:assert/strict');
const test = require('node:test');
const {fixture} = require('./farm-fixture.cjs');
const plain = value => JSON.parse(JSON.stringify(value));

function setup(options = {}) {
    const f = fixture({deferFarmInit: true, storageEntries: options.storageEntries});
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
    f.context.injector = {get: () => ({getStackedEffect: () => effect, getEffectValue: e => e.value})};
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
    for (const file of ['settings', 'policy', 'adapter', 'core']) f.loadSource('src/modules/deposit_planner/src/' + file + '.js');
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

test('preview has zero game mutations, and running/paused settings restore through actual startup', async () => {
    const f = setup({data: {jobs: [job(1, 20, 500)]}});
    f.planner.start();
    await f.tick(60000);
    assert.equal(f.sends().length, 0);
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
    f.planner.getSettings().setAll({preview_only: false, target: 500});
    f.planner.start();
    await f.tick(31000);
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
    active.planner.getSettings().setAll({preview_only: false, auto_reroll: true, target: 500});
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
