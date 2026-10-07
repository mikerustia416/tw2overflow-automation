const assert = require('node:assert/strict');
const test = require('node:test');
const {fixture} = require('./farm-fixture.cjs');

const loadPolicy = () => {
    const f = fixture({deferFarmInit: true});
    f.loadSource('src/modules/builder_queue/src/core.js');
    return f.get('two/builderQueue/planner');
};
const policy = loadPolicy();
const cost = (wood = 100, clay = 100, iron = 100, food = 0) => ({wood, clay, iron, food});
const building = (extra = {}) => ({level: 0, queued: 0, cost: cost(), durationSeconds: 100, allowed: true, ...extra});
function snapshot (extra = {}) {
    return {
        sequence: ['barracks', 'warehouse', 'farm', 'timber_camp', 'clay_pit', 'iron_mine', 'wall'],
        buildings: Object.fromEntries(['barracks', 'warehouse', 'farm', 'timber_camp', 'clay_pit', 'iron_mine', 'wall'].map(name => [name, building()])),
        stock: {wood: 1000, clay: 1000, iron: 1000}, reserves: {wood: 0, clay: 0, iron: 0},
        production: {wood: 1, clay: 1, iron: 1}, capacity: 10000, foodFree: 100, queueSeconds: 0,
        types: {farm: 'farm', warehouse: 'warehouse', resources: {wood: 'timber_camp', clay: 'clay_pit', iron: 'iron_mine'}},
        ...extra
    };
}
const dynamic = {dynamic: true, prioritizeFarm: true, prioritizeWarehouse: true};

test('strict mode keeps the official step and existing optional farm fallback', () => {
    const s = snapshot({foodFree: 2});
    assert.equal(policy.plan(s, {prioritizeFarm: true}).building, 'barracks');
    s.buildings.barracks.allowed = false;
    s.buildings.barracks.foodBlocked = true;
    assert.equal(policy.plan(s, {prioritizeFarm: true}).building, 'farm');
    assert.equal(policy.plan(s, {prioritizeFarm: false}).building, null);
});

test('dynamic priorities address storage and population ahead of a ready main step within timing budget', () => {
    const s = snapshot({capacity: 1000, foodFree: 2});
    assert.equal(policy.plan(s, dynamic).building, 'warehouse');
    s.stock = {wood: 800, clay: 800, iron: 800};
    assert.equal(policy.plan(s, dynamic).building, 'farm');
    assert.equal(policy.plan(s, {...dynamic, prioritizeFarm: false}).building, 'barracks');
    assert.equal(policy.plan(s, {...dynamic, maxDelayMinutes: 0}).building, 'barracks');
});

test('necessary farm and warehouse repairs can unblock otherwise impossible sequence steps', () => {
    const s = snapshot({capacity: 1000, foodFree: 2, queueSeconds: NaN, production: {}});
    s.buildings.barracks.cost.wood = 1500;
    s.buildings.barracks.allowed = false;
    assert.equal(policy.plan(s, {...dynamic, maxDelayMinutes: 0}).building, 'warehouse');
    s.buildings.barracks.cost.wood = 100;
    s.buildings.barracks.foodBlocked = true;
    assert.equal(policy.plan(s, {...dynamic, maxDelayMinutes: 0}).building, 'farm');
});

test('long resource waits choose a feasible bottleneck resource upgrade and account for spent resources', () => {
    const s = snapshot();
    s.buildings.barracks = building({allowed: false, cost: cost(5000, 1500, 1200)});
    const decision = policy.plan(s, dynamic);
    assert.equal(decision.building, 'timber_camp');
    assert.equal(decision.waitSeconds, 4000);
    assert.equal(decision.extraDelaySeconds, 100);
    assert.equal(decision.resourceDetour, true);
    assert.equal(policy.plan(s, {...dynamic, maxDelayMinutes: 1}).building, null);
});

test('wait threshold and max additional delay prevent counterproductive detours', () => {
    const s = snapshot();
    s.buildings.barracks = building({allowed: false, cost: cost(2000)});
    assert.equal(policy.plan(s, dynamic).building, null);
    s.buildings.barracks.cost.wood = 5000;
    for (const name of ['warehouse', 'farm', 'timber_camp', 'clay_pit', 'iron_mine', 'wall']) s.buildings[name].durationSeconds = 10000;
    assert.equal(policy.plan(s, {...dynamic, maxDelayMinutes: 15}).building, null);
});

test('all detours preserve resources and use game upgradeability and population feasibility', () => {
    const s = snapshot({reserves: {wood: 950, clay: 0, iron: 0}});
    s.buildings.barracks = building({allowed: false, cost: cost(5000)});
    assert.equal(policy.plan(s, dynamic).building, null);
    s.reserves.wood = 0;
    s.buildings.timber_camp.allowed = false;
    s.buildings.clay_pit.allowed = false;
    s.buildings.iron_mine.allowed = false;
    assert.equal(policy.plan(s, dynamic).building, 'warehouse');
    for (const name of ['warehouse', 'farm', 'wall']) s.buildings[name].cost.food = 101;
    assert.equal(policy.plan(s, dynamic).building, null);
});

test('resource detours are bounded by sequence targets, configured level and count', () => {
    const s = snapshot({resourceDetours: 2});
    s.buildings.barracks = building({allowed: false, cost: cost(5000)});
    assert.equal(policy.plan(s, dynamic).resourceDetour, false);
    const fallback = policy.plan(s, dynamic);
    assert.equal(fallback.building, 'warehouse');
    s.resourceDetours = 0;
    assert.equal(policy.plan(s, {...dynamic, resourceLevelLimit: 0}).building, 'warehouse');
    s.sequence = ['barracks'];
    assert.equal(policy.plan(s, dynamic).building, null);
});

test('queued levels satisfy targets and a queued farm or warehouse is not duplicated', () => {
    const s = snapshot({foodFree: 2, capacity: 1000});
    s.sequence = ['barracks', 'farm', 'farm', 'warehouse', 'warehouse'];
    s.buildings.farm.queued = 1;
    s.buildings.warehouse.queued = 1;
    assert.equal(policy.plan(s, dynamic).building, 'barracks');
    s.sequence = ['farm', 'warehouse'];
    assert.equal(policy.plan(s, dynamic).building, null);
    assert.match(policy.plan(s, dynamic).reason, /already queued/);
});

test('unknown production, duration or queue timing skips optional detours safely', () => {
    const s = snapshot({production: {}});
    s.buildings.barracks = building({allowed: false, cost: cost(5000)});
    assert.equal(policy.plan(s, dynamic).building, null);
    assert.match(policy.plan(s, dynamic).reason, /production timing/);
    s.production = {wood: 1, clay: 1, iron: 1};
    s.queueSeconds = NaN;
    assert.equal(policy.plan(s, dynamic).building, null);
    assert.match(policy.plan(s, dynamic).reason, /queue timing/);
    s.queueSeconds = 0;
    for (const data of Object.values(s.buildings)) data.durationSeconds = NaN;
    assert.equal(policy.plan(s, dynamic).building, null);
});

test('numeric strings from real nextLevelCosts are normalized in post-spend estimates', () => {
    const s = snapshot();
    s.buildings.barracks = building({allowed: false, cost: cost('5000', '1500', '1200', '0')});
    for (const data of Object.values(s.buildings)) data.cost = Object.fromEntries(Object.entries(data.cost).map(([key, value]) => [key, String(value)]));
    const result = policy.plan(s, dynamic);
    assert.equal(result.building, 'timber_camp');
    assert.equal(result.extraDelaySeconds, 100);
});

function runtime (options = {}) {
    const f = fixture({deferFarmInit: true, villageIds: [1, 2], storageEntries: options.storageEntries});
    const groups = {10: {id: 10, name: 'Resource'}, 11: {id: 11, name: 'Offensive'}};
    const links = {10: [], 11: []};
    const definitions = {Essential: ['barracks', 'warehouse', 'farm', 'timber_camp', 'timber_camp', 'timber_camp'],
        Resource: ['timber_camp', 'warehouse'], Offensive: ['barracks', 'farm'], Defensive: ['wall', 'farm']};
    const models = {};
    f.context.injector = {get: name => ({buildingService: {compute: () => {}}, premiumActionService: {},
        buildingQueueService: {canBeFinishedForFree: () => false}}[name])};
    f.context.modelDataService.getGroupList = () => ({getGroups: () => groups, getGroupVillageIds: id => links[id] || []});
    f.context.modelDataService.getGameData = () => ({getBuildings: () => Object.fromEntries(['barracks', 'farm', 'warehouse', 'timber_camp', 'wall'].map(name => [name, {max_level: 30}]))});
    f.context.villageService.initializeVillage = () => {};
    f.setModule('conf/buildingTypes', {BARRACKS: 'barracks', FARM: 'farm', WAREHOUSE: 'warehouse', TIMBER_CAMP: 'timber_camp'});
    f.setModule('conf/locationTypes', {MASS_SCREEN: 'mass'});
    f.setModule('conf/upgradeabilityStates', {POSSIBLE: 'possible', NOT_ENOUGH_FOOD: 'food', NOT_ENOUGH_RESOURCES: 'resources'});
    f.setModule('two/builderQueue/defaultOrders', definitions);
    f.context.routeProvider.VILLAGE_UPGRADE_BUILDING = {type: 'build'};
    f.events.BUILDING_LEVEL_CHANGED = 'building_changed';
    f.events.GROUPS_UPDATED = 'groups_updated';
    for (const [id, village] of Object.entries(f.villages)) {
        const model = models[id] = {levels: {barracks: 0, farm: 0, warehouse: 0, timber_camp: 0, wall: 0},
            stock: {wood: 1000, clay: 1000, iron: 1000, food: 100}, queue: [], capacity: 10000};
        village.checkReadyState = () => ({buildingQueue: true, buildings: true});
        village.isInitialized = () => true;
        village.buildingQueue = {getQueue: () => model.queue, getAmountJobs: () => model.queue.length, getUnlockedSlots: () => 2};
        village.buildingData = {getBuildingLevels: () => model.levels,
            getDataForBuilding: name => ({level: model.levels[name], nextLevelCosts: {...cost(name === 'barracks' ? 5000 : 100), build_time: '100'},
                upgradeability: model.stock.wood < (name === 'barracks' ? 5000 : 100) ? 'resources' : 'possible'})};
        village.getBuildingData = () => village.buildingData;
        village.getResources = () => ({getComputed: () => Object.fromEntries(Object.entries(model.stock).map(([type, value]) => [type, {currentStock: value, production: 15}])),
            getMaxStorage: () => model.capacity,
            getProductionRates: () => Object.fromEntries(['wood', 'clay', 'iron'].map(type => [type, {current: 3600}]))});
    }
    if (options.acknowledge) {
        f.context.socketService.emit = (route, data, callback) => {
            f.requests.push({route: route.type, data});
            const model = models[data.village_id];
            const prices = f.villages[data.village_id].getBuildingData().getDataForBuilding(data.building).nextLevelCosts;
            for (const type of ['wood', 'clay', 'iron', 'food']) model.stock[type] -= Number(prices[type]);
            model.levels[data.building]++;
            callback({job: {building: data.building, level: model.levels[data.building]}});
        };
    }
    f.loadSource('src/resource-budget.js');
    for (const file of ['settings', 'types', 'events', 'label-policy', 'core']) f.loadSource('src/modules/builder_queue/src/' + file + '.js');
    const builder = f.get('two/builderQueue');
    builder.init();
    return {...f, builder, models, links, groups};
}

test('Builder preview is read-only, profile-aware, uses hourly rates and draft options', () => {
    const f = runtime();
    const before = f.storage.get('builder_queue_settings');
    const draft = {...f.builder.getSettings(1).getAll(), dynamic_building: true};
    const decision = f.builder.preview(1, draft);
    assert.equal(decision.building, 'timber_camp');
    assert.equal(decision.waitSeconds, 4000);
    assert.equal(decision.extraDelaySeconds, 100);
    assert.deepEqual(f.storage.get('builder_queue_settings'), before);
    assert.equal(f.requests.length, 0);
    f.builder.getSettings(1).setAll({dynamic_building: true, preserve_wood: 950});
    assert.equal(f.builder.preview(1).building, null);
    assert.equal(f.builder.preview(2).building, null);
});

test('execution follows dynamic decision, logs reason, and resource detour cap survives reload', async () => {
    const f = runtime({acknowledge: true});
    f.builder.getSettings(1).setAll({dynamic_building: true, dynamic_resource_detour_limit: 1});
    f.builder.getSettings(2).set('enabled', false);
    f.builder.start();
    assert.deepEqual(f.requests.map(r => r.data.building), ['timber_camp']);
    assert.match(f.builder.getLogs()[0].reason, /production/);
    assert.equal(f.builder.preview(1).resourceDetour, false);
    const restored = runtime({storageEntries: [...f.storage.entries()]});
    restored.models[1].levels.timber_camp = 1;
    restored.models[1].stock = {...f.models[1].stock};
    assert.equal(restored.builder.preview(1).resourceDetour, false);
    assert.equal(restored.builder.getSettings(1).get('dynamic_building'), true);
    await f.tick(60000);
    assert.deepEqual(f.requests.map(r => r.data.building), ['timber_camp', 'warehouse']);
});

test('queue slots and shared resource reservations block preview and execution', () => {
    const f = runtime();
    f.builder.getSettings(1).set('dynamic_building', true);
    f.models[1].queue = [{building: 'warehouse'}, {building: 'farm'}];
    assert.equal(f.builder.preview(1).building, null);
    assert.match(f.builder.preview(1).reason, /slots/);
    f.builder.start();
    assert.equal(f.requests.length, 0);
    f.models[1].queue = [];
    const ledger = f.get('two/resourceBudget');
    ledger.begin(f.villages[1], cost());
    assert.match(f.builder.preview(1).reason, /another resource order/);
});

test('role links change effective sequence dynamically while manual old profiles retain their selection', () => {
    const f = runtime();
    f.links[10] = [1, 2];
    f.builder.getSettings(2).set('building_sequence', 'Offensive');
    assert.equal(f.builder.preview(1).sequence, 'Resource');
    assert.equal(f.builder.preview(2).sequence, 'Offensive');
    assert.equal(f.builder.preview(2).sequenceSource, 'manual');
    f.builder.start();
    assert.deepEqual(f.requests.map(r => [r.data.village_id, r.data.building]), [[1, 'timber_camp']]);
    f.links[10] = [];
    f.get('two/resourceBudget').clear(1);
    f.rootScope.$broadcast(f.events.GROUPS_VILLAGE_UNLINKED, {});
    assert.equal(f.builder.preview(1).sequence, 'Essential');
    assert.equal(f.requests.length, 1);
    f.links[10] = [2];
    f.builder.getSettings(2).setAll({follow_village_labels: true, manual_sequence_override: false});
    assert.equal(f.builder.preview(2).sequence, 'Resource');
});

test('stored libraries preserve shorter edits, deliberate emptiness and deleted migrated role presets', () => {
    const entries = [['builder_queue_settings', {building_orders: {Essential: ['farm']}, building_sequence: 'Essential'}]];
    const f = runtime({storageEntries: entries});
    assert.deepEqual(Array.from(f.builder.getSettings().get('building_orders').Essential), ['farm']);
    assert.ok(f.builder.getSettings().get('building_orders').Resource);
    f.builder.removeSequence('Resource');
    const restored = runtime({storageEntries: [...f.storage.entries()]});
    assert.equal(restored.builder.getSettings().get('building_orders').Resource, undefined);
    assert.deepEqual(Array.from(restored.builder.getSettings().get('building_orders').Essential), ['farm']);
    const empty = runtime({storageEntries: [['builder_queue_settings', {building_orders: {}}]]});
    assert.deepEqual(Object.keys(empty.builder.getSettings().get('building_orders')), []);
    assert.equal(empty.builder.start(), false);
});

test('invalid edited sequences cannot exceed actual game max levels or refer to unknown buildings', () => {
    const f = runtime();
    assert.notEqual(f.builder.updateBuildingSequence('Essential', Array(31).fill('farm')), f.builder.updateBuildingSequence('Essential', ['farm']));
    const invalid = f.builder.updateBuildingSequence('Essential', ['missing_building']);
    assert.equal(invalid, f.get('two/builderQueue/sequenceStatus').SEQUENCE_INVALID);
});

test('successive detours share the original main-step deadline instead of extending its delay budget', () => {
    const s = snapshot();
    s.buildings.barracks = building({allowed: false, cost: cost(5000)});
    assert.equal(policy.plan(s, {...dynamic, maxDelayMinutes: 3}).building, 'timber_camp');
    s.mainBudgetSeconds = 3900;
    assert.equal(policy.plan(s, {...dynamic, maxDelayMinutes: 3}).building, null);
    assert.equal(policy.plan(s, {...dynamic, maxDelayMinutes: 4}).extraDelaySeconds, 200);
});

test('missing data for the first sequence building cannot silently skip to another upgrade', () => {
    const s = snapshot();
    delete s.buildings.barracks;
    const result = policy.plan(s, dynamic);
    assert.equal(result.building, null);
    assert.equal(result.main, 'barracks');
    assert.match(result.reason, /missing/);
});

test('legacy village sequence overrides remain manual after an unrelated profile save and reload', () => {
    const f = runtime({storageEntries: [['builder_queue_settings', {village_profiles: {1: {building_sequence: 'Resource'}}}]]});
    f.links[11] = [1];
    assert.equal(f.builder.preview(1).sequence, 'Resource');
    assert.equal(f.builder.preview(1).sequenceSource, 'manual');
    f.builder.getSettings(1).set('preserve_wood', 100);
    const restored = runtime({storageEntries: [...f.storage.entries()]});
    restored.links[11] = [1];
    assert.equal(restored.builder.preview(1).sequence, 'Resource');
    assert.equal(restored.builder.preview(1).sequenceSource, 'manual');
    restored.builder.getSettings(1).setAll({follow_village_labels: true, manual_sequence_override: false});
    assert.equal(restored.builder.preview(1).sequence, 'Offensive');
});

test('adding an invalid new sequence does not persist unknown or excessive building levels', () => {
    const f = runtime();
    const invalid = f.get('two/builderQueue/sequenceStatus').SEQUENCE_INVALID;
    assert.equal(f.builder.addBuildingSequence('Unknown', ['missing_building']), invalid);
    assert.equal(f.builder.addBuildingSequence('TooMuchFarm', Array(31).fill('farm')), invalid);
    assert.equal(f.builder.getSettings().get('building_orders').Unknown, undefined);
    assert.equal(f.builder.getSettings().get('building_orders').TooMuchFarm, undefined);
});
