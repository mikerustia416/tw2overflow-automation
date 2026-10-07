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
    const f = fixture({deferFarmInit: true, storageEntries: options.storageEntries});
    f.context.modelDataService.getWorldConfig = () => ({isResourceDepositEnabled: () => options.enabled !== false});
    f.context.modelDataService.getSelectedVillage = () => ({getId: () => 1});
    const player = f.context.modelDataService.getSelectedCharacter();
    player.getResourceDeposit = () => ({getCurrentJob: () => null, getCollectibleJobs: () => [], getReadyJobs: () => []});
    let second = {isAvailable: () => false};
    player.getSecondVillage = () => second;
    player.setSecondVillage = value => { second = value; };
    f.setModule('models/SecondVillageModel', class { constructor(data) {this.data = data;} isAvailable() {return false;} });
    f.setModule('helper/time', {gameTime: () => 1000000, server2ClientTime: value => value * 1000});
    f.context.injector = {get: () => ({isFeatureActive: () => options.secondEnabled !== false, hasFinishedLastJob: jobs => !!jobs.finished})};
    for (const name of ['RESOURCE_DEPOSIT_INFO', 'RESOURCE_DEPOSIT_JOB_COLLECTIBLE', 'RESOURCE_DEPOSIT_JOBS_REROLLED',
        'RESOURCE_DEPOSIT_JOB_COLLECTED', 'SECOND_VILLAGE_VILLAGE_CREATED', 'SECOND_VILLAGE_JOB_COLLECTED']) f.events[name] = name;
    for (const name of ['RESOURCE_DEPOSIT_GET_INFO', 'SECOND_VILLAGE_GET_INFO', 'SECOND_VILLAGE_FINISH_VILLAGE']) f.context.routeProvider[name] = {type: name};
    f.context.socketService.emit = (route, data, callback) => {
        if (options.deferred && route.type === 'SECOND_VILLAGE_GET_INFO') options.deferred.push(callback);
        else if (callback) callback({jobs: {}, day: 0});
        f.requests.push({route: route.type});
    };
    for (const name of ['core', 'events', 'second-village']) f.loadSource('src/modules/auto_collector/src/' + name + '.js');
    f.loadSource('src/module-state.js');
    const module = f.get('two/autoCollector');
    f.setModule('two/autoCollector/ui', () => {});
    f.context.require = (deps, callback) => callback(...deps.map(f.get));
    const boot = () => f.loadSource('src/modules/auto_collector/src/init.js');
    return {...f, module, boot};
}

test('Collector and Second Village persist independently, including migration from the old shared flag', () => {
    const f = collector({storageEntries: [['auto_collector_active', true]]});
    f.boot();
    assert.equal(f.module.isRunning(), true);
    assert.equal(f.module.secondVillage.isRunning(), true);
    assert.equal(f.storage.get('auto_collector_second_village_active'), true);
    f.rootScope.$broadcast('two_deposit_planner_controls_deposit');
    assert.equal(f.module.isRunning(), false);
    assert.equal(f.module.secondVillage.isRunning(), true);
    assert.equal(f.storage.get('auto_collector_active'), false);
    const loaded = collector({storageEntries: [...f.storage.entries()]});
    loaded.boot();
    assert.equal(loaded.module.isRunning(), false);
    assert.equal(loaded.module.secondVillage.isRunning(), true);
    loaded.module.secondVillage.stop();
    const paused = collector({storageEntries: [...loaded.storage.entries()]});
    paused.boot();
    assert.equal(paused.module.secondVillage.isRunning(), false);
});

test('disabled Collector/Second Village reject saved active states and repeated startup stays idempotent', () => {
    const f = collector({enabled: false, secondEnabled: false, storageEntries: [
        ['auto_collector_active', true], ['auto_collector_second_village_active', true]
    ]});
    f.boot();
    f.boot();
    assert.equal(f.storage.get('auto_collector_active'), false);
    assert.equal(f.storage.get('auto_collector_second_village_active'), false);
});


test('paused or superseded Second Village callbacks cannot finish a village', () => {
    const deferred = [];
    const f = collector({deferred});
    f.boot();
    deferred.shift()({jobs: {}, day: 0}); // Initial read registers listeners only.
    const second = f.module.secondVillage;
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
    f.module.secondVillage.start();
    assert.equal(f.requests.filter(r => r.route === 'SECOND_VILLAGE_FINISH_VILLAGE').length, 1);
    assert.equal(f.module.secondVillage.isRunning(), false);
});
