const assert = require('node:assert/strict');
const test = require('node:test');
const {fixture} = require('./farm-fixture.cjs');

const plain = value => JSON.parse(JSON.stringify(value));
const troopData = {
    spear: {building: 'barracks', required_level: 1, load: 25, wood: 50, clay: 30, iron: 20, food: 1},
    axe: {building: 'barracks', required_level: 5, load: 20, wood: 60, clay: 30, iron: 40, food: 1}
};

function recruitmentFixture (options = {}) {
    const f = fixture({unitData: troopData, ...options});
    const stocks = {wood: 10000, clay: 10000, iron: 10000, food: 500, ...options.stocks};
    const units = {spear: {total: 20, in_town: 5, support: 1000}, axe: {total: 0, in_town: 0}, ...options.owned};
    const jobs = options.jobs || [];
    const buildingJobs = options.buildingJobs || [];
    const requests = [];
    const replies = [];
    const buildings = {barracks: {max_level: 25}, farm: {max_level: 30}};
    const levels = {
        barracks: {level: 5, nextLevelCosts: {wood: 1000, clay: 800, iron: 500, food: 10}},
        farm: {level: 3, nextLevelCosts: {wood: 500, clay: 400, iron: 300, food: 0}},
        ...options.levels
    };
    f.context.modelDataService.getGameData = () => ({getUnitsObject: () => troopData, getBuildings: () => buildings});
    f.context.buildingService = {compute: () => {}};
    f.context.routeProvider.BARRACKS_RECRUIT = {type: 'recruit'};
    f.context.socketService.emit = (route, data, reply) => { requests.push(plain(data)); replies.push(reply); };
    f.events.BARRACKS_RECRUIT_JOB_CREATED = 'barracks_created';
    f.setModule('helper/time', {server2ClientTime: value => Number(value) * 1000});
    f.context.Date = {now: () => options.clock ? options.clock.now : 1000000};
    for (const village of Object.values(f.villages)) {
        village.getResources = () => ({getComputed: () => Object.fromEntries(Object.entries(stocks).map(([type, currentStock]) => [type, {currentStock}])),
            getLastUpdate: () => options.resourceClock ? options.resourceClock.now : undefined});
        village.getUnitInfo = () => ({getUnits: () => units});
        village.getRecruitingQueue = () => ({jobs: jobs.map(data => ({data}))});
        village.getBuildingData = () => ({getDataForBuilding: name => levels[name]});
        village.buildingQueue = {getQueue: () => buildingJobs};
    }
    for (const file of ['src/resource-budget.js', 'src/modules/recruiter/src/settings.js',
        'src/modules/recruiter/src/policy.js', 'src/modules/recruiter/src/core.js']) f.loadSource(file);
    const recruiter = f.get('two/recruiter');
    recruiter.init();
    recruiter.getSettings().setAll({targets: {spear: 100, axe: 40}, preserve_wood: 1000,
        preserve_clay: 1000, preserve_iron: 1000, spend_percent: 100, ...options.config});
    return {...f, recruiter, stocks, jobs, units, buildingJobs, levels, requests, replies};
}

test('generated packets use nearby barbarians, carrying capacity, and reserved troops', () => {
    const f = fixture();
    const generate = f.get('two/farmOverflow/autoPresets');
    const targets = [{character_id: null}, {character_id: 8}, {character_id: null}, {character_id: null}];
    const options = {unitNames: ['spear'], reservePercent: 50, minimum: 5, maximum: 100,
        carry: 1000, commandSlots: 45, attackLimit: 50};
    const packets = generate(1, targets, f.units, {spear: {load: 25}}, options);
    assert.deepEqual(Array.from(packets, p => p.units.spear), [16, 32, 40]);
    assert.ok(packets.every(p => p.generated && p.nearbyTargets === 3));
    assert.equal(generate(1, [{character_id: 8}], f.units, {spear: {load: 25}}, options).length, 0);
    assert.equal(generate(1, targets, f.units, {spear: {load: 25}}, {...options, reservePercent: 100}).length, 0);
    assert.equal(generate(1, targets, f.units, {spear: {load: 25}}, {...options, minimum: 50}).length, 0);
});

test('more nearby targets split available troops into smaller packets', () => {
    const f = fixture();
    const options = {unitNames: ['spear'], reservePercent: 0, minimum: 5, maximum: 100,
        carry: 2500, commandSlots: 45, attackLimit: 50};
    const generate = f.get('two/farmOverflow/autoPresets');
    assert.equal(generate(1, [{character_id: null}], f.units, {spear: {load: 25}}, options)[0].units.spear, 100);
    assert.equal(generate(1, Array(10).fill({character_id: null}), f.units, {spear: {load: 25}}, options)[0].units.spear, 10);
});

test('auto presets work without manual presets and preview makes no writes', async () => {
    const f = fixture({presets: {}, settings: {auto_presets: true, auto_preset_units: ['spear']}});
    const plans = await f.farm.previewAutoPresets();
    assert.ok(plans.length);
    assert.equal(plans[0].villageId, 1);
    assert.equal(f.requests.length, 0);
    f.farm.start();
    await f.settle();
    assert.ok(f.farm.getLogs().some(log => log.presetId && log.presetId.startsWith('auto:')));
    assert.equal(f.requests.filter(r => r.route === 'custom').length, 1);
    assert.equal(f.requests.some(r => r.route === 'assign'), false);
});

test('auto preset live attacks use custom army and retain normal send timeout', async () => {
    const f = fixture({presets: {}, autoAck: false, settings: {auto_presets: true, auto_preset_units: ['spear']}});
    f.farm.start();
    await f.settle();
    const custom = f.requests.filter(r => r.route === 'custom');
    assert.equal(custom.length, 1);
    assert.deepEqual(custom[0].data.units, {spear: 40});
    assert.equal(f.requests.some(r => r.route === 'assign'), false);
    await f.tick(30000);
    assert.equal(f.farm.isRunning(), false);
    assert.equal(f.requests.filter(r => r.route === 'custom').length, 1);
});

test('invalid auto preset packet limits reject start', () => {
    const f = fixture({settings: {auto_presets: true, auto_preset_units: ['spear'], auto_preset_min_units: 200, auto_preset_max_units: 10}});
    assert.equal(f.farm.start(), false);
});

test('stopped Recruiter previews own totals plus unfinished queue jobs without orders', () => {
    const f = recruitmentFixture({jobs: [{job_id: 1, unit_type: 'spear', amount: 40, recruited: 10}]});
    f.recruiter.preview();
    const plan = f.recruiter.getPlans()[0];
    assert.equal(plan.deficits[0].owned, 20); // owned includes troops away; support is not ours
    assert.equal(plan.deficits[0].queued, 30);
    assert.equal(plan.orders[0].amount, 50);
    assert.equal(f.requests.length, 0);
});

test('resource savings, building headroom, actual next-upgrade costs, and spending share all reduce recruitment', () => {
    const f = recruitmentFixture({stocks: {wood: 3000}, config: {
        building_wood: 500, protect_buildings: ['farm'], spend_percent: 50
    }});
    f.recruiter.start();
    const plan = f.recruiter.getPlans()[0];
    assert.equal(plan.protected.wood, 2000);
    assert.equal(plan.budget.wood, 500);
    assert.equal(plan.orders[0].amount, 10);
    assert.equal(plan.remaining.wood, 0);
    assert.ok(plan.orders.every(order => order.cost.wood <= plan.budget.wood));
});

test('queued building upgrades are already paid and not reserved twice', () => {
    const f = recruitmentFixture({buildingJobs: [{building: 'farm'}], config: {protect_buildings: ['farm']}});
    f.recruiter.start();
    assert.equal(f.recruiter.getPlans()[0].buildingCosts.wood, 0);
});

test('population limits batches and leaves population reserved for buildings', () => {
    const f = recruitmentFixture({stocks: {food: 30}, config: {preserve_food: 5, building_food: 5, protect_buildings: ['barracks']}});
    f.recruiter.start();
    assert.equal(f.recruiter.getPlans()[0].orders[0].amount, 10);
    assert.equal(f.recruiter.getPlans()[0].orders.length, 1);
});

test('recruitment stops at targets and skips locked unit kinds and full queues', () => {
    const f = recruitmentFixture({owned: {spear: {total: 100, in_town: 0}}, levels: {
        barracks: {level: 1, nextLevelCosts: {wood: 100, clay: 100, iron: 100, food: 1}}
    }});
    f.recruiter.start();
    assert.equal(f.recruiter.getPlans()[0].orders.length, 0);
    const full = recruitmentFixture({config: {max_queue_jobs: 1}, jobs: [{unit_type: 'spear', amount: 1, recruited: 0}]});
    full.recruiter.start();
    assert.match(full.recruiter.getPlans()[0].reason, /queue full/);
});

test('missing resources, troop totals, queue fields, or protected building costs prevent writes', () => {
    const cases = [
        {stocks: {food: undefined}},
        {owned: {spear: {in_town: 10}}},
        {jobs: [{unit_type: 'spear', amount: 1}]},
        {jobs: [{unit_type: 'spear', amount: 1, recruited: 2}]},
        {config: {protect_buildings: ['farm']}, levels: {farm: {level: 2}}},
        {levels: {barracks: {level: undefined}}}
    ];
    for (const data of cases) {
        const f = recruitmentFixture({...data, config: {...data.config}});
        f.recruiter.start();
        assert.equal(f.requests.length, 0, JSON.stringify(data));
    }
});

test('negative, fractional, or unknown troop targets and invalid intervals cannot start', () => {
    for (const config of [{targets: {spear: -1}}, {targets: {spear: 1.5}}, {targets: {wizard: 10}},
        {check_interval: '0 seconds'}, {check_interval: '2 days'}, {spend_percent: NaN}]) {
        const f = recruitmentFixture({config});
        assert.equal(f.recruiter.start(), false);
        assert.equal(f.requests.length, 0);
    }
});

test('recruitment continues only after the preceding queue and resource update', async () => {
    const f = recruitmentFixture({config: {check_interval: '10 seconds'}});
    f.recruiter.start();
    assert.deepEqual(f.requests, [{village_id: 1, unit_type: 'spear', amount: 50}]);
    f.replies[0]({job_id: 17, village_id: 1, unit_type: 'spear', amount: 50});
    await f.tick(10000);
    assert.equal(f.requests.length, 1);
    // Server queue update alone is not sufficient if resources are stale.
    f.jobs.push({job_id: 17, unit_type: 'spear', amount: 50, recruited: 0});
    await f.tick(10000);
    assert.equal(f.requests.length, 1);
    for (const type of ['wood', 'clay', 'iron', 'food']) f.stocks[type] -= troopData.spear[type] * 50;
    await f.tick(10000);
    assert.equal(f.requests.length, 2);
    assert.equal(f.requests[1].amount, 30); // target deficit after the earlier batch
});

test('missing acknowledgement pauses recruitment and preserves guard across restart', async () => {
    const f = recruitmentFixture({config: {}});
    f.recruiter.start();
    await f.tick(30000);
    assert.equal(f.recruiter.isRunning(), false);
    assert.match(f.recruiter.status, /missing/);
    assert.ok(f.storage.get('recruiter_pending_101_7')[1]);
    f.recruiter.start();
    assert.equal(f.requests.length, 1);
    f.recruiter.stop();
    f.recruiter.resolvePending(1);
    f.recruiter.start();
    assert.equal(f.requests.length, 2);
});

test('persisted pending guard prevents resending after reload', () => {
    const f = recruitmentFixture({config: {}, storageEntries: [['recruiter_pending_101_7', {
        1: {sentAt: 1000000, before: {wood: 10000, clay: 10000, iron: 10000, food: 500}, cost: {wood: 2500, clay: 1500, iron: 1000, food: 50}}
    }]]});
    f.recruiter.start();
    assert.equal(f.requests.length, 0);
});

test('server rejection releases guard and stops, while a late success after pause never sends', () => {
    const f = recruitmentFixture({config: {}});
    f.recruiter.start();
    f.replies[0]({error: 'not enough resources'});
    assert.equal(f.recruiter.isRunning(), false);
    assert.equal(Object.keys(f.recruiter.getPending()).length, 0);
    f.recruiter.start();
    f.recruiter.stop();
    f.replies[1]({job_id: 18, village_id: 1, unit_type: 'spear', amount: 50});
    assert.equal(f.requests.length, 2);
    assert.equal(f.recruiter.getPending()[1].jobId, 18);
    assert.equal(f.recruiter.isRunning(), false);
});

test('stopping during readiness prevents a delayed recruitment start', () => {
    const f = recruitmentFixture({config: {}});
    const g = fixture();
    // Replace ready dependency before instantiating a fresh core module.
    let loaded;
    g.setModule('two/ready', callback => { loaded = callback; });
    for (const file of ['src/resource-budget.js', 'src/modules/recruiter/src/settings.js',
        'src/modules/recruiter/src/policy.js', 'src/modules/recruiter/src/core.js']) g.loadSource(file);
    g.context.modelDataService.getGameData = f.context.modelDataService.getGameData;
    const r = g.get('two/recruiter');
    r.init();
    r.getSettings().setAll({targets: {spear: 5}});
    r.start();
    r.stop();
    loaded();
    assert.equal(r.isRunning(), false);
    assert.equal(r.getPlans().length, 1, 'Stopped state still shows its preview');
});

test('shared spending guard prevents a building and recruiter using the same snapshot', () => {
    const f = recruitmentFixture({config: {}});
    const ledger = f.get('two/resourceBudget');
    const v = f.villages[1];
    const cost = {wood: 1000, clay: 800, iron: 500, food: 10};
    const entry = ledger.begin(v, cost); // builder spending in flight
    f.recruiter.start();
    assert.equal(f.requests.length, 0);
    ledger.acknowledge(v, entry);
    assert.equal(ledger.isBusy(v), true);
    for (const type of Object.keys(cost)) f.stocks[type] -= cost[type];
    assert.equal(ledger.isBusy(v), false);
    assert.equal(ledger.begin(v, {...cost, iron: -1}), false);
});

test('zero spending and savings above stock cause no resource spend', () => {
    for (const config of [{spend_percent: 0}, {preserve_wood: 100000}]) {
        const f = recruitmentFixture({config: {...config}});
        f.recruiter.start();
        assert.equal(f.requests.length, 0);
    }
});

test('selected village groups are deduplicated and non-owned villages excluded', () => {
    const f = recruitmentFixture({villageIds: [1, 2], config: {enabled_groups: [3, 4]}});
    f.context.modelDataService.getGroupList = () => ({getGroupVillageIds: () => [1, 1, 2, 999]});
    f.recruiter.start();
    assert.deepEqual(f.requests.map(r => r.village_id), [1, 2]);
});

test('a synchronous server rejection stops before spending in the next village', () => {
    const f = recruitmentFixture({villageIds: [1, 2], config: {}});
    f.context.socketService.emit = (route, data, reply) => {
        f.requests.push(plain(data));
        reply({error: 'rejected'});
    };
    f.recruiter.start();
    assert.equal(f.requests.length, 1);
    assert.equal(f.recruiter.isRunning(), false);
});

test('BuilderQueue respects recruitment in-flight resources in a combined build', () => {
    const f = recruitmentFixture({config: {}});
    f.recruiter.start();
    const buildingRequests = [];
    const village = f.villages[1];
    village.checkReadyState = () => ({buildings: true, buildingQueue: true});
    village.isInitialized = () => true;
    village.buildingQueue.getAmountJobs = () => 0;
    village.buildingQueue.getUnlockedSlots = () => 2;
    village.buildingData = {getBuildingLevels: () => ({barracks: 5, farm: 3})};
    village.getBuildingData = () => ({getDataForBuilding: name => f.levels[name], getBuildingLevels: village.buildingData.getBuildingLevels});
    f.levels.barracks.upgradeability = 'possible';
    const originalEmit = f.context.socketService.emit;
    f.context.socketService.emit = (route, data, callback) => {
        if (route.type === 'build') buildingRequests.push(data);
        else originalEmit(route, data, callback);
    };
    f.context.routeProvider.VILLAGE_UPGRADE_BUILDING = {type: 'build'};
    f.context.injector = {get: name => ({
        buildingService: f.context.buildingService,
        premiumActionService: {}, buildingQueueService: {canBeFinishedForFree: () => false}
    }[name])};
    for (const file of ['src/modules/builder_queue/src/settings.js', 'src/modules/builder_queue/src/types.js',
        'src/modules/builder_queue/src/label-policy.js', 'src/modules/builder_queue/src/core.js']) f.loadSource(file);
    f.setModule('conf/buildingTypes', {BARRACKS: 'barracks', FARM: 'farm'});
    f.setModule('conf/locationTypes', {MASS_SCREEN: 'mass'});
    f.setModule('conf/upgradeabilityStates', {POSSIBLE: 'possible'});
    f.setModule('two/builderQueue/defaultOrders', {custom: Array(6).fill('barracks')});
    f.storage.set('builder_queue_settings', {building_orders: {custom: Array(6).fill('barracks')},
        building_sequence: 'custom', preserve_wood: 0, preserve_clay: 0, preserve_iron: 0});
    const builder = f.get('two/builderQueue');
    builder.init();
    builder.start();
    assert.equal(buildingRequests.length, 0);
    f.recruiter.stop();
    f.recruiter.resolvePending(1);
    builder.stop();
    builder.start();
    assert.equal(buildingRequests.length, 1);
});


test('saving live recruitment settings restarts without duplicating an unconfirmed order', async () => {
    const f = recruitmentFixture({config: {}});
    f.loadSource('src/module-state.js');
    f.get('two/moduleState')(f.recruiter, 'recruiter_active', 'two_recruiter_start', 'two_recruiter_stop');
    f.recruiter.start();
    const oldInterval = [...f.timers.entries()].find(([, timer]) => timer.interval)[0];
    const pending = plain(f.recruiter.getPending());
    f.recruiter.getSettings().setAll({check_interval: '10 seconds', max_batch: 10});
    assert.equal(f.recruiter.isRunning(), true);
    assert.equal(f.storage.get('recruiter_active'), true);
    assert.deepEqual(plain(f.recruiter.getPending()), pending);
    assert.equal(f.requests.length, 1);
    assert.equal(f.timers.has(oldInterval), false);
    f.replies[0]({job_id: 19, village_id: 1, unit_type: 'spear', amount: 50});
    f.jobs.push({job_id: 19, unit_type: 'spear', amount: 50, recruited: 0});
    f.stocks.wood -= 2500;
    f.stocks.clay -= 1500;
    f.stocks.iron -= 1000;
    f.stocks.food -= 50;
    await f.tick(10000);
    assert.equal(f.requests.length, 2);
    assert.equal(f.requests[1].amount, 10);
});

test('saving recruiter settings invalidates old readiness callbacks', () => {
    const f = recruitmentFixture();
    const g = fixture();
    const waiting = [];
    g.setModule('two/ready', callback => waiting.push(callback));
    g.context.modelDataService.getGameData = f.context.modelDataService.getGameData;
    for (const file of ['src/resource-budget.js', 'src/modules/recruiter/src/settings.js',
        'src/modules/recruiter/src/policy.js', 'src/modules/recruiter/src/core.js']) g.loadSource(file);
    const recruiter = g.get('two/recruiter');
    recruiter.init();
    recruiter.start();
    recruiter.getSettings().set('check_interval', '10 seconds');
    assert.equal(waiting.length, 2);
    waiting[0]();
    assert.equal(g.timers.size, 0);
    waiting[1]();
    assert.equal([...g.timers.values()].filter(timer => timer.interval === 10000).length, 1);
});


test('Start recruits from a stopped preview and queue events confirm empty socket replies', async () => {
    const resourceClock = {now: 999};
    const f = recruitmentFixture({resourceClock, config: {check_interval: '10 seconds'}});
    f.recruiter.preview();
    assert.equal(f.requests.length, 0);
    assert.equal(f.recruiter.start(), true);
    assert.equal(f.requests.length, 1);
    f.replies[0]({}); // Real transport can acknowledge without a job payload.
    const job = {job_id: 28, village_id: 1, unit_type: 'spear', amount: 50, recruited: 0, start_time: 1000};
    f.jobs.push(job);
    f.rootScope.$broadcast(f.events.BARRACKS_RECRUIT_JOB_CREATED, job);
    await f.tick(10000);
    assert.equal(f.requests.length, 1, 'A job alone does not allow spending stale resources');
    resourceClock.now = 1010;
    // Production or incoming resources may already have replaced a small debit.
    await f.tick(10000);
    assert.equal(f.requests.length, 2);
    assert.equal(f.recruiter.isRunning(), true);
});

test('legacy guards recover only from a matching dated queue job and fresh resources', () => {
    const entry = {sentAt: 990000, before: {wood: 10000, clay: 10000, iron: 10000, food: 500},
        cost: {wood: 50, clay: 30, iron: 20, food: 1}, unit: 'spear', amount: 1};
    const storageEntries = [['recruiter_pending_101_7', {1: entry}]];
    const config = {};
    const job = {job_id: 19, unit_type: 'spear', amount: 1, recruited: 0, start_time: 990};
    const f = recruitmentFixture({config, storageEntries, resourceClock: {now: 1000}, jobs: [job]});
    assert.equal(f.recruiter.start(), true);
    assert.equal(f.requests.length, 1);
    const unrelated = recruitmentFixture({config, storageEntries, resourceClock: {now: 1000}, jobs: [{...job, start_time: 800}]});
    unrelated.recruiter.start();
    assert.equal(unrelated.requests.length, 0, 'An older similar job cannot clear an uncertain order');
});

test('pre-existing identical queue jobs never acknowledge a new request', async () => {
    const f = recruitmentFixture({config: {}, resourceClock: {now: 1001},
        jobs: [{job_id: 1, unit_type: 'spear', amount: 50, recruited: 40}]});
    f.recruiter.start();
    await f.tick(10000);
    assert.equal(f.requests.length, 1);
    assert.equal(f.recruiter.getPending()[1].jobId, undefined);
});

test('stopped previews never resume an uncertain recruitment order', async () => {
    const f = recruitmentFixture({config: {}});
    f.recruiter.start();
    f.recruiter.stop();
    f.recruiter.preview();
    await f.tick(30000);
    assert.equal(f.recruiter.isRunning(), false);
    assert.ok(f.recruiter.getPending()[1]);
    assert.equal(f.requests.length, 1);
});

test('Recruiter village profiles isolate targets, reserves, upcoming buildings and persist after reload', () => {
    const f = recruitmentFixture({villageIds: [1, 2, 3]});
    f.recruiter.getSettings(1).setAll({targets: {spear: 30}, preserve_wood: 7000, protect_buildings: ['farm']});
    f.recruiter.getSettings(2).setAll({targets: {axe: 10}, preserve_wood: 1000, protect_buildings: []});
    f.recruiter.preview();
    const [one, two, inherited] = f.recruiter.getPlans();
    assert.deepEqual(plain(one.deficits).map(item => item.name), ['spear']);
    assert.equal(one.orders[0].amount, 10);
    assert.equal(one.protected.wood, 7500);
    assert.equal(two.orders[0].unit_type, 'axe');
    assert.equal(two.orders[0].amount, 10);
    assert.equal(two.protected.wood, 1000);
    assert.equal(inherited.deficits[0].target, 100);
    assert.equal(f.requests.length, 0);
    const restored = recruitmentFixture({villageIds: [1, 2, 3], storageEntries: [...f.storage.entries()]});
    assert.deepEqual(plain(restored.recruiter.getSettings(1).get('targets')), {spear: 30});
    assert.deepEqual(plain(restored.recruiter.getSettings(2).get('targets')), {axe: 10});
    assert.equal(restored.recruiter.getSettings(3).get('preserve_wood'), 1000);
});

test('Recruiter village disablement and invalid profiles cannot submit orders in those villages', () => {
    const f = recruitmentFixture({villageIds: [1, 2, 3], config: {}});
    f.recruiter.getSettings(1).set('enabled', false);
    f.recruiter.getSettings(2).set('targets', {spear: -1});
    f.recruiter.start();
    assert.deepEqual(f.requests.map(request => request.village_id), [3]);
    assert.match(f.recruiter.getPlans()[0].reason, /disabled/);
    assert.match(f.recruiter.getPlans()[1].reason, /Invalid village/);
});

test('saved profiles freeze local values, share timing, and can return to defaults', () => {
    const f = recruitmentFixture({villageIds: [1, 2]});
    const profile = f.recruiter.getSettings(1);
    profile.setAll(profile.getAll()); // Save an unchanged inherited configuration.
    f.recruiter.getSettings().set('targets', {axe: 5});
    f.recruiter.getSettings().set('preserve_wood', 8000);
    assert.equal(profile.get('targets').spear, 100);
    assert.equal(profile.get('preserve_wood'), 1000);
    assert.equal(f.recruiter.getSettings(2).get('targets').axe, 5);
    profile.set('check_interval', '10 seconds');
    assert.equal(f.recruiter.getSettings(2).get('check_interval'), 10000);
    assert.equal(f.recruiter.getSettings().get('check_interval'), 10000);
    profile.resetProfile();
    assert.deepEqual(plain(profile.get('targets')), {axe: 5});
    assert.equal(profile.get('preserve_wood'), 8000);
});


function confirmRecruitment (f, index) {
    const request = f.requests[index];
    const job = {job_id: 100 + index, ...request, recruited: 0};
    f.jobs.push(job);
    for (const type of ['wood', 'clay', 'iron', 'food']) {
        f.stocks[type] -= troopData[request.unit_type][type] * request.amount;
    }
    f.replies[index](job);
}

test('preview fills available queue slots with repeated capped batches and unit priority', () => {
    const f = recruitmentFixture();
    f.recruiter.preview();
    const plan = f.recruiter.getPlans()[0];
    assert.deepEqual(plain(plan.orders.map(order => [order.unit_type, order.amount])),
        [['spear', 50], ['spear', 30], ['axe', 40]]);
    assert.equal(plan.deficits[0].deficit, 80);
    assert.equal(plan.remaining.wood, 2600);
    assert.equal(f.requests.length, 0);
    const capped = recruitmentFixture({config: {targets: {spear: 1000}, max_queue_jobs: 3},
        jobs: [{job_id: 1, unit_type: 'spear', amount: 10, recruited: 0}]});
    capped.recruiter.preview();
    assert.deepEqual(plain(capped.recruiter.getPlans()[0].orders.map(order => order.amount)), [50, 50]);
});

test('all affordable recruitment batches fill the queue before the next configured interval', async () => {
    const f = recruitmentFixture({config: {check_interval: '1 minute'}});
    f.recruiter.start();
    for (let index = 0; index < 3; index++) {
        assert.equal(f.requests.length, index + 1);
        confirmRecruitment(f, index);
        await f.tick(500);
    }
    assert.deepEqual(f.requests.map(order => [order.unit_type, order.amount]),
        [['spear', 50], ['spear', 30], ['axe', 40]]);
    await f.tick(1000);
    assert.equal(f.requests.length, 3);
    assert.equal(Object.keys(f.recruiter.getPending()).length, 0);
    assert.equal(f.recruiter.isRunning(), true);
});

test('spending percentage is one total interval budget, even if production replaces every debit', async () => {
    const resourceClock = {now: 1001};
    const f = recruitmentFixture({resourceClock, config: {check_interval: '1 minute',
        targets: {spear: 1000}, max_batch: 10, max_queue_jobs: 20, spend_percent: 25}});
    f.recruiter.start();
    for (let index = 0; index < 5; index++) {
        confirmRecruitment(f, index);
        for (const type of ['wood', 'clay', 'iron', 'food']) {
            f.stocks[type] += troopData.spear[type] * f.requests[index].amount;
        }
        await f.tick(500);
    }
    assert.deepEqual(f.requests.map(order => order.amount), [10, 10, 10, 10, 5]);
    assert.equal(f.requests.reduce((sum, order) => sum + order.amount * troopData.spear.wood, 0), 2250);
    await f.tick(1000);
    assert.equal(f.requests.length, 5, 'Completion cannot open another budget in the same interval');
    await f.tick(56500);
    assert.equal(f.requests.length, 6, 'The configured interval permits a new budget');
});

test('queue cap applies across multiple sends and preserves pre-existing paid jobs', async () => {
    const f = recruitmentFixture({config: {targets: {spear: 1000}, max_batch: 10, max_queue_jobs: 3},
        jobs: [{job_id: 1, unit_type: 'spear', amount: 10, recruited: 0}]});
    f.recruiter.start();
    confirmRecruitment(f, 0);
    await f.tick(500);
    confirmRecruitment(f, 1);
    await f.tick(500);
    assert.equal(f.requests.length, 2);
    assert.equal(f.jobs.length, 3);
    await f.tick(2000);
    assert.equal(f.requests.length, 2);
});

test('new external spending and population changes reduce subsequent batches before sending', async () => {
    const f = recruitmentFixture({config: {max_batch: 10, protect_buildings: ['farm']}});
    f.recruiter.start();
    confirmRecruitment(f, 0);
    f.stocks.wood = 1650; // 1000 savings + 500 protected upgrade: only 150 remains
    f.stocks.food = 2;
    await f.tick(500);
    assert.equal(f.requests.length, 2);
    assert.equal(f.requests[1].amount, 2);
    confirmRecruitment(f, 1);
    await f.tick(500);
    assert.equal(f.requests.length, 2);
    assert.equal(f.stocks.wood, 1550);
    assert.equal(f.stocks.food, 0);
});

test('pausing cancels queue filling and a late acknowledgement never resumes it', async () => {
    const f = recruitmentFixture({config: {max_batch: 10}});
    f.recruiter.start();
    f.recruiter.stop();
    confirmRecruitment(f, 0);
    await f.tick(2000);
    assert.equal(f.requests.length, 1);
    assert.equal([...f.timers.values()].filter(timer => timer.date < 1030000).length, 0);
});

test('a rejection during queue filling stops remaining batches', async () => {
    const f = recruitmentFixture({config: {max_batch: 10}});
    f.recruiter.start();
    confirmRecruitment(f, 0);
    await f.tick(500);
    f.replies[1]({error: 'rejected'});
    await f.tick(2000);
    assert.equal(f.requests.length, 2);
    assert.equal(f.recruiter.isRunning(), false);
});

test('villages keep independent resource budgets while filling their own queues', async () => {
    const f = recruitmentFixture({villageIds: [1, 2], config: {max_batch: 10, targets: {spear: 50}}});
    const secondStock = {wood: 0, clay: 0, iron: 0, food: 500};
    f.villages[2].getResources = () => ({getComputed: () => Object.fromEntries(
        Object.entries(secondStock).map(([name, currentStock]) => [name, {currentStock}]))});
    f.recruiter.start();
    confirmRecruitment(f, 0);
    await f.tick(500);
    assert.deepEqual(f.requests.map(order => order.village_id), [1, 1]);
    assert.equal(f.recruiter.getPlans().find(plan => plan.villageId === 2).orders.length, 0);
    assert.deepEqual(secondStock, {wood: 0, clay: 0, iron: 0, food: 500});
});


test('completed jobs free slots during queue filling without exceeding troop targets', async () => {
    const f = recruitmentFixture({config: {targets: {spear: 50}, max_batch: 10, max_queue_jobs: 1}});
    f.recruiter.start();
    for (let index = 0; index < 3; index++) {
        confirmRecruitment(f, index);
        f.rootScope.$broadcast(f.events.BARRACKS_RECRUIT_JOB_CREATED, f.jobs[0]);
        f.units.spear.total += 10;
        f.jobs.length = 0;
        await f.tick(500);
    }
    assert.deepEqual(f.requests.map(order => order.amount), [10, 10, 10]);
    assert.equal(f.units.spear.total, 50);
    assert.equal(f.requests.length, 3);
});

test('Builder spending between recruitment batches blocks continuation until its debit is confirmed', async () => {
    const f = recruitmentFixture({config: {max_batch: 10}});
    f.recruiter.start();
    confirmRecruitment(f, 0);
    f.rootScope.$broadcast(f.events.BARRACKS_RECRUIT_JOB_CREATED, f.jobs[0]);
    const cost = {wood: 1000, clay: 800, iron: 500, food: 10};
    const ledger = f.get('two/resourceBudget');
    const reservation = ledger.begin(f.villages[1], cost);
    assert.ok(reservation);
    await f.tick(500);
    assert.equal(f.requests.length, 1);
    ledger.acknowledge(f.villages[1], reservation);
    for (const type of Object.keys(cost)) f.stocks[type] -= cost[type];
    await f.tick(500);
    assert.equal(f.requests.length, 2);
});

test('Recruiter previews refresh saved settings and current resources while stopped, then Start executes', () => {
    const f = recruitmentFixture();
    assert.equal(f.recruiter.isRunning(), false);
    assert.equal(f.recruiter.getSettings().settingsMap.preview_only, undefined);
    assert.equal(f.recruiter.getPlans()[0].orders[0].amount, 50);
    f.stocks.wood = 1500;
    f.recruiter.preview();
    assert.equal(f.recruiter.getPlans()[0].orders[0].amount, 10);
    f.recruiter.getSettings().set('preserve_wood', 1500);
    assert.equal(f.recruiter.getPlans()[0].orders.length, 0);
    assert.equal(f.requests.length, 0);
    f.recruiter.getSettings().set('preserve_wood', 1000);
    f.recruiter.start();
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].amount, 10);
    f.recruiter.stop();
    assert.ok(f.recruiter.getPlans().length);
    assert.match(f.recruiter.getPlans()[0].reason, /earlier spend/);
});

test('Recruiter retires shared and profile preview flags while preserving live state and pending guards', () => {
    for (const [preview, active, expected] of [[true, true, false], [false, true, true], [false, false, false]]) {
        const guard = {1: {unit: 'spear', amount: 1, sentAt: 1000000}};
        const f = recruitmentFixture({storageEntries: [['recruiter_active', active],
            ['recruiter_settings_101_7', {preview_only: preview, village_profiles: {2: {preview_only: true, targets: {axe: 10}}}}],
            ['recruiter_pending_101_7', guard]]});
        assert.equal(f.storage.get('recruiter_active'), expected);
        const saved = f.storage.get('recruiter_settings_101_7');
        assert.equal(Object.hasOwn(saved, 'preview_only'), false);
        assert.equal(Object.hasOwn(saved.village_profiles[2], 'preview_only'), false);
        assert.equal(f.recruiter.getSettings(2).get('targets').axe, 10);
        assert.deepEqual(plain(f.recruiter.getPending()), guard);
        assert.equal(f.requests.length, 0);
    }
});
