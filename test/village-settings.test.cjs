const assert = require('node:assert/strict');
const test = require('node:test');
const {fixture} = require('./farm-fixture.cjs');

function builderFixture (options = {}) {
    const f = fixture({deferFarmInit: true, villageIds: [1, 2, 3], ...options});
    const levels = {barracks: 0, farm: 0};
    const costs = {wood: 100, clay: 100, iron: 100, food: 0};
    const state = {barracks: 'possible', farm: 'possible'};
    f.context.injector = {get: name => ({buildingService: {compute: () => {}},
        premiumActionService: {instantBuild: () => {}}, buildingQueueService: {canBeFinishedForFree: () => false}}[name])};
    f.context.modelDataService.getGameData = () => ({getBuildings: () => ({barracks: {max_level: 25}, farm: {max_level: 30}})});
    f.context.villageService.initializeVillage = () => {};
    f.setModule('conf/buildingTypes', {BARRACKS: 'barracks', FARM: 'farm'});
    f.setModule('conf/locationTypes', {MASS_SCREEN: 'mass'});
    f.setModule('conf/upgradeabilityStates', {POSSIBLE: 'possible', NOT_ENOUGH_FOOD: 'food', NOT_ENOUGH_RESOURCES: 'resources'});
    f.setModule('two/builderQueue/defaultOrders', {Essential: ['barracks'], Farm: ['farm']});
    f.context.routeProvider.VILLAGE_UPGRADE_BUILDING = {type: 'build'};
    f.events.BUILDING_LEVEL_CHANGED = 'building_changed';
    for (const village of Object.values(f.villages)) {
        village.checkReadyState = () => ({buildingQueue: true, buildings: true});
        village.isInitialized = () => true;
        village.buildingQueue = {getQueue: () => [], getAmountJobs: () => 0, getUnlockedSlots: () => 2};
        village.buildingData = {getBuildingLevels: () => levels,
            getDataForBuilding: name => ({level: levels[name], nextLevelCosts: costs, upgradeability: state[name]})};
        village.getBuildingData = () => village.buildingData;
        village.getResources = () => ({getComputed: () => Object.fromEntries(['wood', 'clay', 'iron'].map(type => [type, {currentStock: 1000}]))});
    }
    f.loadSource('src/resource-budget.js');
    for (const file of ['settings', 'types', 'events', 'label-policy', 'core']) f.loadSource('src/modules/builder_queue/src/' + file + '.js');
    const builder = f.get('two/builderQueue');
    builder.init();
    return {...f, builder, levels, state};
}

test('Builder uses village-specific sequences and resource savings, including after reload', () => {
    const f = builderFixture();
    f.builder.getSettings(1).setAll({building_sequence: 'Farm', preserve_wood: 100});
    f.builder.getSettings(2).setAll({building_sequence: 'Essential', preserve_wood: 950});
    f.builder.start();
    assert.deepEqual(f.requests.filter(request => request.route === 'build').map(request => [request.data.village_id, request.data.building]), [[1, 'farm'], [3, 'barracks']]);
    const restored = builderFixture({storageEntries: [...f.storage.entries()]});
    assert.equal(restored.builder.getSettings(1).get('building_sequence'), 'Farm');
    assert.equal(restored.builder.getSettings(2).get('preserve_wood'), 950);
    assert.equal(restored.builder.getSettings(3).get('preserve_wood'), 0);
});

test('Builder respects each village farm priority and reserve even on fallback farm upgrades', () => {
    const f = builderFixture();
    f.state.barracks = 'food';
    f.builder.getSettings().set('building_orders', {Essential: ['barracks', 'farm']});
    f.builder.getSettings(1).set('priorize_farm', false);
    f.builder.getSettings(2).set('preserve_wood', 950);
    f.builder.start();
    assert.deepEqual(f.requests.filter(request => request.route === 'build').map(request => [request.data.village_id, request.data.building]), [[3, 'farm']]);
});

test('disabled or missing-sequence villages are skipped on timers and building-change events', async () => {
    const f = builderFixture();
    f.builder.getSettings(1).set('enabled', false);
    f.builder.getSettings(2).set('building_sequence', 'Missing');
    f.builder.start();
    assert.deepEqual(f.requests.map(request => request.data.village_id), [3]);
    f.rootScope.$broadcast('building_changed', {village_id: 1});
    f.rootScope.$broadcast('building_changed', {village_id: 2});
    await f.tick(1000);
    assert.deepEqual(f.requests.map(request => request.data.village_id), [3]);
});

test('shared library persists new sequences, and a valid profile works with a missing default sequence', () => {
    const f = builderFixture();
    const view = f.builder.getSettings(1);
    f.builder.addBuildingSequence('Special', ['farm']);
    assert.deepEqual(Array.from(view.get('building_orders').Special), ['farm']);
    view.set('building_sequence', 'Special');
    f.builder.getSettings().set('building_sequence', 'Missing');
    f.builder.start();
    assert.deepEqual(f.requests.map(request => [request.data.village_id, request.data.building]), [[1, 'farm']]);
    const restored = builderFixture({storageEntries: [...f.storage.entries()]});
    assert.deepEqual(Array.from(restored.builder.getSettings(2).get('building_orders').Special), ['farm']);
});
