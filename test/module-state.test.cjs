const assert = require('node:assert/strict');
const test = require('node:test');
const {fixture} = require('./farm-fixture.cjs');

const modules = [
    {id: 'farm_overflow', name: 'farmOverflow', key: 'farm_overflow_active', change: {unit_reserve_percent: 25}},
    {id: 'recruiter', name: 'recruiter', key: 'recruiter_active', change: {check_interval: '10 seconds'}},
    {id: 'builder_queue', name: 'builderQueue', key: 'builder_queue_active', change: {preserve_wood: 100}},
    {id: 'auto_quest', name: 'autoQuest', key: 'auto_quest_active', change: {check_interval: '5 seconds'}}
];

function setup (entry, options = {}) {
    const f = fixture({deferFarmInit: true, ...options});
    f.loadSource('src/module-state.js');
    f.loadSource('src/resource-budget.js');
    f.context.document = {querySelectorAll: () => []};
    f.context.modelDataService.getGameData = () => ({
        getUnitsObject: () => ({spear: {load: 25, building: 'barracks'}}),
        getBuildings: () => ({barracks: {max_level: 25}}),
        getCostsPerCoin: () => ({wood: 100, clay: 100, iron: 100})
    });
    f.context.modelDataService.getWorldConfig = () => ({});
    if (entry.id === 'builder_queue' || entry.id === 'auto_minter' || entry.id === 'spy_recruiter') {
        // Empty village lists isolate lifecycle/timers from actual spending.
        f.context.modelDataService.getSelectedCharacter().getVillages = () => ({});
        f.context.injector = {get: () => ({})};
        f.setModule('conf/buildingTypes', {BARRACKS: 'barracks'});
        f.setModule('conf/locationTypes', {MASS_SCREEN: 'mass'});
        f.setModule('conf/upgradeabilityStates', {POSSIBLE: 'possible'});
        f.setModule('conf/spyTypes', {});
    }
    if (entry.id !== 'farm_overflow') {
        if (entry.id === 'builder_queue') f.setModule('two/builderQueue/defaultOrders', {Essential: ['barracks']});
        for (const file of ['settings', 'policy', 'types', 'events', 'core']) {
            const source = 'src/modules/' + entry.id + '/src/' + file + '.js';
            if (require('node:fs').existsSync(require('node:path').join(__dirname, '..', source))) f.loadSource(source);
        }
    }
    const module = f.get('two/' + entry.name);
    f.setModule('two/' + entry.name + '/ui', () => {
        assert.equal(module.isInitialized(), true, 'restore runs after module initialization and UI setup');
        assert.equal(module.isRunning(), false);
    });
    f.context.require = (deps, callback) => callback(...deps.map(f.get));
    const boot = () => f.loadSource('src/modules/' + entry.id + '/src/init.js');
    return {...f, module, boot};
}

for (const entry of modules) {
    test(entry.name + ' saves Start/Stop and restores running state through real startup after reload', async () => {
        const first = setup(entry);
        first.boot();
        assert.equal(first.module.isRunning(), false);
        first.module.start();
        await first.settle();
        assert.equal(first.storage.get(entry.key), true);
        const reloaded = setup(entry, {storageEntries: [...first.storage.entries()]});
        assert.equal(reloaded.module.isInitialized(), false);
        reloaded.boot();
        await reloaded.settle();
        assert.equal(reloaded.module.isRunning(), true);
        assert.equal(reloaded.storage.get(entry.key), true);
        const timers = [...reloaded.timers.keys()];
        reloaded.boot();
        assert.deepEqual([...reloaded.timers.keys()], timers, 'repeated startup cannot create duplicate timers');
        reloaded.module.stop();
        assert.equal(reloaded.storage.get(entry.key), false);
        const stopped = setup(entry, {storageEntries: [...reloaded.storage.entries()]});
        stopped.boot();
        assert.equal(stopped.module.isRunning(), false);
    });

    test(entry.name + ' restarts on settings save, replaces timers, and remains active after reload', async () => {
        const f = setup(entry);
        f.boot();
        f.module.start();
        await f.settle();
        const oldIntervals = [...f.timers.entries()].filter(([, timer]) => timer.interval).map(([id]) => id);
        const transitions = [];
        const events = entry.name === 'recruiter'
            ? ['two_recruiter_stop', 'two_recruiter_start']
            : [entry.key.replace('_active', '_stop'), entry.key.replace('_active', '_start')];
        for (const event of events) f.rootScope.$on(event, () => transitions.push(event));
        f.module.getSettings().setAll(entry.change);
        await f.settle();
        assert.deepEqual(transitions, events);
        assert.equal(f.module.isRunning(), true);
        assert.equal(f.storage.get(entry.key), true);
        assert.ok(oldIntervals.every(id => !f.timers.has(id)), 'old intervals must be cancelled');
        const reloaded = setup(entry, {storageEntries: [...f.storage.entries()]});
        reloaded.boot();
        await reloaded.settle();
        assert.equal(reloaded.module.isRunning(), true);
        for (const [key, value] of Object.entries(entry.change)) {
            assert.equal(reloaded.module.getSettings().getRaw(key), value);
        }
        f.module.stop();
        f.module.getSettings().setAll(entry.id === 'farm_overflow' ? {unit_reserve_percent: 30} : entry.id === 'builder_queue'
            ? {preserve_wood: 200} : {check_interval: '20 seconds'});
        assert.equal(f.module.isRunning(), false, 'saving stopped modules must not start them');
        assert.equal(f.storage.get(entry.key), false);
    });
}

test('failed restored starts clear stale running state', () => {
    for (const [entry, storageEntries] of [
        [modules[0], [['farm_overflow_active', true], ['farm_overflow_settings', {max_travel_time: 'invalid'}]]],
        [modules[1], [['recruiter_active', true], ['recruiter_settings_101_7', {check_interval: 'invalid'}]]],
        [modules[2], [['builder_queue_active', true], ['builder_queue_settings', {building_orders: {}}]]]
    ]) {
        const f = setup(entry, {storageEntries, ...(entry.id === 'farm_overflow' ? {settings: {max_travel_time: 'invalid'}} : {})});
        f.boot();
        assert.equal(f.module.isRunning(), false);
        assert.equal(f.storage.get(entry.key), false);
    }
});

test('Builder settings restart discards old readiness callbacks and rejects missing active sequences', () => {
    const waiting = [];
    const g = fixture({deferFarmInit: true});
    g.context.modelDataService.getSelectedCharacter().getVillages = () => ({});
    g.context.injector = {get: () => ({})};
    g.setModule('two/ready', callback => waiting.push(callback));
    g.setModule('conf/buildingTypes', {BARRACKS: 'barracks'});
    g.setModule('conf/locationTypes', {});
    g.setModule('conf/upgradeabilityStates', {});
    g.setModule('two/builderQueue/defaultOrders', {Essential: ['barracks']});
    for (const name of ['settings', 'types', 'events', 'core']) g.loadSource('src/modules/builder_queue/src/' + name + '.js');
    g.loadSource('src/resource-budget.js');
    const builder = g.get('two/builderQueue');
    let reads = 0;
    g.context.modelDataService.getSelectedCharacter().getVillages = () => { reads++; return {}; };
    builder.init();
    builder.start();
    builder.getSettings().set('preserve_wood', 200);
    assert.equal(waiting.length, 2);
    waiting[0]();
    assert.equal(reads, 0);
    waiting[1]();
    assert.ok(reads > 0);
    builder.getSettings().set('building_sequence', 'Missing');
    assert.equal(builder.isRunning(), false);
    builder.getSettings().set('building_sequence', 'Essential');
    builder.start();
    assert.equal(builder.isRunning(), true);
});

for (const entry of [
    {id: 'auto_minter', name: 'autoMinter'},
    {id: 'spy_recruiter', name: '___spy_recruiter_id'}
]) {
    test(entry.id + ' restarts completely on every settings change and leaves stopped modules stopped', () => {
        const f = setup(entry);
        f.module.init();
        f.module.start();
        const oldIntervals = [...f.timers.keys()];
        f.module.getSettings().set('preserve_wood', 123);
        assert.equal(f.module.isRunning(), true);
        assert.ok(oldIntervals.every(id => !f.timers.has(id)));
        assert.equal(f.timers.size, 1);
        f.module.stop();
        f.module.getSettings().set('preserve_wood', 234);
        assert.equal(f.module.isRunning(), false);
        assert.equal(f.timers.size, 0);
    });
}


test('invalid new settings stop the previous run and save stopped state', async () => {
    for (const [entry, values] of [
        [modules[0], {max_travel_time: 'invalid'}],
        [modules[1], {check_interval: 'invalid'}],
        [modules[2], {building_sequence: 'Missing'}]
    ]) {
        const f = setup(entry);
        f.boot();
        f.module.start();
        await f.settle();
        f.module.getSettings().setAll(values);
        assert.equal(f.module.isRunning(), false);
        assert.equal(f.storage.get(entry.key), false);
    }
});
