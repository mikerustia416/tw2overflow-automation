const assert = require('node:assert/strict');
const test = require('node:test');
const {fixture} = require('./farm-fixture.cjs');

function commander(options = {}) {
    const f = fixture({deferFarmInit: true, storageEntries: options.storageEntries});
    Object.assign(f.get('two/utils'), {getTimeOffset: () => 0});
    f.context.window = {addEventListener: () => {}};
    for (const name of ['conf/buildingTypes', 'conf/officerTypes', 'conf/unitTypes']) f.setModule(name, {});
    for (const name of ['types', 'storage-keys', 'events', 'core']) f.loadSource('src/modules/command_queue/src/' + name + '.js');
    f.loadSource('src/module-state.js');
    const module = f.get('two/commandQueue');
    f.setModule('two/commandQueue/ui', () => assert.equal(module.initialized, true));
    f.context.require = (deps, callback) => callback(...deps.map(f.get));
    const boot = () => f.loadSource('src/modules/command_queue/src/init.js');
    return {...f, module, boot};
}
const queued = {id: 1, sendTime: 1100000, origin: {id: 1}, target: {id: 100}, units: {spear: 1}, officers: {}, type: 'attack'};

test('Commander preserves an explicit pause with queued commands, and saves future Start/Stop', async () => {
    const f = commander({storageEntries: [['command_queue_active', false], ['command_queue_commands', [queued]]]});
    f.boot();
    assert.equal(f.module.isRunning(), false);
    f.module.start();
    assert.equal(f.storage.get('command_queue_active'), true);
    const loaded = commander({storageEntries: [...f.storage.entries()]});
    loaded.boot();
    assert.equal(loaded.module.isRunning(), true);
    const timers = [...loaded.timers.keys()];
    loaded.boot();
    loaded.module.start();
    assert.deepEqual([...loaded.timers.keys()], timers, 'Repeated initialization cannot create another dispatch timer');
    loaded.module.stop();
    assert.equal(loaded.storage.get('command_queue_active'), false);
    const paused = commander({storageEntries: [...loaded.storage.entries()]});
    paused.boot();
    await paused.tick(101000);
    assert.equal(paused.requests.length, 0, 'Paused commands never dispatch');
});

test('Commander migrates legacy queue auto-start only when no saved running flag exists', () => {
    const f = commander();
    const keys = f.get('two/commandQueue/storageKeys');
    f.storage.set(keys.QUEUE_COMMANDS, [queued]);
    f.boot();
    assert.equal(f.module.isRunning(), true);
    assert.equal(f.storage.get('command_queue_active'), true);
    const empty = commander();
    empty.boot();
    assert.equal(empty.module.isRunning(), false);
});

function collector(options = {}) {
    const f = fixture({deferFarmInit: true, separateEventQueue: true, storageEntries: options.storageEntries});
    f.context.modelDataService.getWorldConfig = () => ({isResourceDepositEnabled: () => options.enabled !== false});
    f.context.modelDataService.getSelectedVillage = () => ({getId: () => 1, getResources: () => ({getResources: () => ({wood: 100, clay: 100, iron: 100})})});
    const player = f.context.modelDataService.getSelectedCharacter();
    player.getResourceDeposit = () => ({getCurrentJob: () => null, getCollectibleJobs: () => [], getReadyJobs: () => []});
    let second = {isAvailable: () => false};
    player.getSecondVillage = () => second;
    player.setSecondVillage = value => { second = value; };
    f.setModule('models/SecondVillageModel', class { constructor(data) {this.data = data;} isAvailable() {return !!options.secondData;} });
    f.setModule('helper/time', {gameTime: () => 1000000, server2ClientTime: value => value * 1000});
    f.context.injector = {get: () => ({isFeatureActive: () => options.secondEnabled !== false, hasFinishedLastJob: jobs => !!jobs.finished,
        getCurrentDayJobs: jobs => jobs, getCollectedJobs: () => [], getAvailableJobs: () => options.availableJobs || {}})};
    for (const name of ['RESOURCE_DEPOSIT_INFO', 'RESOURCE_DEPOSIT_JOB_COLLECTIBLE', 'RESOURCE_DEPOSIT_JOBS_REROLLED',
        'RESOURCE_DEPOSIT_JOB_COLLECTED', 'SECOND_VILLAGE_VILLAGE_CREATED', 'SECOND_VILLAGE_JOB_COLLECTED']) f.events[name] = name;
    for (const name of ['RESOURCE_DEPOSIT_GET_INFO', 'SECOND_VILLAGE_GET_INFO', 'SECOND_VILLAGE_FINISH_VILLAGE', 'SECOND_VILLAGE_START_JOB', 'SECOND_VILLAGE_COLLECT_JOB_REWARD']) f.context.routeProvider[name] = {type: name};
    f.context.socketService.emit = (route, data, callback) => {
        if (options.deferred && route.type === 'SECOND_VILLAGE_GET_INFO') options.deferred.push(callback);
        else if (callback) callback(options.secondData || {jobs: {}, day: 0});
        f.requests.push({route: route.type, data: structuredClone(data)});
    };
    for (const name of ['core', 'events', 'second-village']) f.loadSource('src/modules/auto_collector/src/' + name + '.js');
    f.loadSource('src/module-state.js');
    const module = f.get('two/autoCollector/secondVillage');
    if (options.ui) {
        f.setModule('two/ui', options.ui);
        f.loadSource('src/modules/auto_collector/src/interface.js');
    } else {
        f.setModule('two/autoCollector/ui', () => {});
    }
    f.context.require = (deps, callback) => callback(...deps.map(f.get));
    const boot = () => f.loadSource('src/modules/auto_collector/src/init.js');
    return {...f, module, boot};
}

test('Second Village retains its own running/paused state after deposit Collector retirement', () => {
    const f = collector({storageEntries: [['auto_collector_active', true]]});
    f.boot();
    assert.equal(f.module.isRunning(), true);
    assert.equal(f.storage.get('auto_collector_second_village_active'), true);
    assert.equal(f.requests.some(r => r.route.startsWith('RESOURCE_DEPOSIT_')), false);
    f.loadSource('src/modules/deposit_planner/src/migration.js');
    f.get('two/depositPlanner/migrate')();
    assert.equal(f.storage.get('auto_collector_active'), false);
    assert.equal(f.module.isRunning(), true);
    const loaded = collector({storageEntries: [...f.storage.entries()]});
    loaded.boot();
    assert.equal(loaded.module.isRunning(), true);
    loaded.module.stop();
    const paused = collector({storageEntries: [...loaded.storage.entries()]});
    paused.boot();
    assert.equal(paused.module.isRunning(), false);
    const timers = [...paused.timers.keys()];
    paused.boot();
    assert.deepEqual([...paused.timers.keys()], timers);
});

test('unavailable Second Village clears its saved active state without touching deposit actions', () => {
    const f = collector({enabled: false, secondEnabled: false, storageEntries: [
        ['auto_collector_active', true], ['auto_collector_second_village_active', true]
    ]});
    f.boot();
    f.boot();
    assert.equal(f.storage.get('auto_collector_second_village_active'), false);
    assert.equal(f.requests.length, 0);
});

test('paused or superseded Second Village callbacks cannot finish a village', () => {
    const deferred = [];
    const f = collector({deferred});
    f.boot();
    deferred.shift()({jobs: {}, day: 0}); // Initial read registers listeners only.
    const second = f.module;
    second.start();
    const old = deferred.shift();
    second.stop();
    second.start();
    old({jobs: {finished: true}, day: 0});
    assert.equal(f.requests.filter(r => r.route === 'SECOND_VILLAGE_FINISH_VILLAGE').length, 0);
    second.stop();
    deferred.shift()({jobs: {finished: true}, day: 0});
    assert.equal(f.requests.filter(r => r.route === 'SECOND_VILLAGE_FINISH_VILLAGE').length, 0);
    second.start();
    deferred.shift()({jobs: {finished: true}, day: 0});
    assert.equal(f.requests.filter(r => r.route === 'SECOND_VILLAGE_FINISH_VILLAGE').length, 1);
    assert.equal(second.isRunning(), false);
    assert.equal(f.storage.get('auto_collector_second_village_active'), false);
});


test('a stopped Second Village does not finalize during initialization', () => {
    const deferred = [];
    const f = collector({deferred});
    f.boot();
    deferred.shift()({jobs: {finished: true}, day: 0});
    assert.equal(f.requests.filter(r => r.route === 'SECOND_VILLAGE_FINISH_VILLAGE').length, 0);
    f.module.start();
    assert.equal(f.requests.filter(r => r.route === 'SECOND_VILLAGE_FINISH_VILLAGE').length, 1);
    assert.equal(f.module.isRunning(), false);
});


test('Second Village state migration is independent of module startup order', () => {
    for (const first of ['second', 'deposit']) {
        for (const savedSecond of [undefined, false, true]) {
            const entries = [['auto_collector_active', true]];
            if (savedSecond !== undefined) entries.push(['auto_collector_second_village_active', savedSecond]);
            const f = collector({storageEntries: entries});
            f.loadSource('src/modules/deposit_planner/src/migration.js');
            if (first === 'deposit') f.get('two/depositPlanner/migrate')();
            f.boot();
            if (first === 'second') f.get('two/depositPlanner/migrate')();
            assert.equal(f.module.isRunning(), savedSecond !== false);
            assert.equal(f.storage.get('auto_collector_second_village_active'), savedSecond !== false);
            assert.equal(f.requests.some(r => r.route.startsWith('RESOURCE_DEPOSIT_')), false);
        }
    }
});

test('Second Village menu controls only its own automation, with no Collector deposit button', () => {
    let click;
    const buttons = [];
    const f = collector({ui: {addMenuButton: (name, position, description) => {
        buttons.push({name, description});
        return {classList: {toggle: () => {}}, addEventListener: (event, handler) => {click = handler;}};
    }}});
    f.boot();
    assert.deepEqual(buttons.map(button => button.name), ['Second Village']);
    click();
    assert.equal(f.module.isRunning(), true);
    assert.equal(f.storage.get('auto_collector_second_village_active'), true);
    f.get('queues/EventQueue').trigger('two_deposit_planner_stop');
    assert.equal(f.module.isRunning(), true, 'Pausing deposits cannot pause Second Village');
    click();
    assert.equal(f.module.isRunning(), false);
    assert.equal(f.storage.get('auto_collector_second_village_active'), false);
    f.boot();
    assert.equal(buttons.length, 1);
    assert.equal(f.requests.some(r => r.route.startsWith('RESOURCE_DEPOSIT_')), false);
});


test('Second Village starts and collects its own jobs independently of deposits', async () => {
    const options = {secondData: {jobs: {}, day: 0}, availableJobs: {50: {id: 50, duration: 10}}};
    const f = collector(options);
    f.boot();
    assert.equal(f.requests.filter(r => r.route !== 'SECOND_VILLAGE_GET_INFO').length, 0, 'Paused initialization only reads');
    f.module.start();
    const started = f.requests.filter(r => r.route === 'SECOND_VILLAGE_START_JOB');
    assert.equal(started.length, 1);
    assert.deepEqual(started[0].data, {village_id: 1, job_id: 50});
    f.module.stop();
    await f.tick(61000);
    assert.equal(f.requests.filter(r => r.route === 'SECOND_VILLAGE_START_JOB').length, 1, 'Pause cancels job continuation');
    options.secondData = {jobs: {50: {id: 50, time_started: 1000, time_completed: 1010, collected: false}}, day: 0};
    f.module.start();
    const collected = f.requests.filter(r => r.route === 'SECOND_VILLAGE_COLLECT_JOB_REWARD');
    assert.equal(collected.length, 1);
    assert.deepEqual(collected[0].data, {village_id: 1, job_id: '50'});
    f.get('queues/EventQueue').trigger('two_deposit_planner_stop');
    assert.equal(f.module.isRunning(), true);
    options.secondData = {jobs: {finished: true}, day: 0};
    f.rootScope.$broadcast(f.events.SECOND_VILLAGE_JOB_COLLECTED);
    assert.equal(f.requests.filter(r => r.route === 'SECOND_VILLAGE_FINISH_VILLAGE').length, 1);
    assert.equal(f.module.isRunning(), false);
    assert.equal(f.requests.some(r => r.route.startsWith('RESOURCE_DEPOSIT_')), false);
});
