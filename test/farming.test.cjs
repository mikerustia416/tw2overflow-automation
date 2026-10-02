const assert = require('node:assert/strict');
const test = require('node:test');
const {fixture} = require('./farm-fixture.cjs');

function choose (policy, presets, overrides = {}) {
    return policy.choosePreset(presets, {spear: {in_town: 100}}, {spear: {load: 25}}, preset => preset.seconds,
        {optimize: true, reservePercent: 0, maxTravelMs: 90000, ...overrides});
}

test('travel limit uses milliseconds and includes the exact boundary', () => {
    const policy = fixture().get('two/farmOverflow/policy');
    assert.equal(choose(policy, [{id: 1, units: {spear: 5}, seconds: 91}]).reason, 'time_limit');
    assert.equal(choose(policy, [{id: 1, units: {spear: 5}, seconds: 90}]).preset.id, 1);
});

test('all affordable presets are examined and capacity per round trip wins', () => {
    const policy = fixture().get('two/farmOverflow/policy');
    const presets = [{id: 1, units: {spear: 5}, seconds: 30}, {id: 2, units: {spear: 20}, seconds: 60}];
    assert.equal(choose(policy, presets).preset.id, 2);
    assert.equal(choose(policy, presets, {optimize: false}).preset.id, 1);
    assert.equal(choose(policy, [{...presets[0], seconds: 300}, presets[1]]).preset.id, 2);
});

test('a configured loot estimate avoids oversizing a slower farming army', () => {
    const policy = fixture().get('two/farmOverflow/policy');
    const presets = [{id: 1, units: {spear: 5}, seconds: 30}, {id: 2, units: {spear: 20}, seconds: 60}];
    const choice = choose(policy, presets, {expectedLoot: 125});
    assert.equal(choice.preset.id, 1);
    assert.equal(choice.expectedHaul, 125);
});

test('missing units, negative units, empty presets, and invalid limits cannot send', () => {
    const policy = fixture().get('two/farmOverflow/policy');
    for (const units of [{unknown: 1}, {spear: -1}, {}, {spear: 0}]) {
        assert.equal(choose(policy, [{units, seconds: 1}]).reason, 'no_units');
    }
    assert.equal(choose(policy, [{units: {spear: 1}, seconds: 1}], {maxTravelMs: NaN}).reason, 'no_units');
    assert.equal(choose(policy, [{units: {spear: 51}, seconds: 1}], {reservePercent: 50}).reason, 'no_units');
});

test('barbarian ownership must be explicit; undefined ownership is not accepted', () => {
    const policy = fixture().get('two/farmOverflow/policy');
    for (const character_id of [null, 0, '0']) assert.equal(policy.isBarbarian({character_id}), true);
    for (const character_id of [undefined, false, '', 7, '7']) assert.equal(policy.isBarbarian({character_id}), false);
});

test('timing jitter is additive, bounded, and subject to the minimum interval', () => {
    const policy = fixture().get('two/farmOverflow/policy');
    assert.equal(policy.boundedDelay(2000, 1000, 1000, () => 0), 2000);
    assert.equal(policy.boundedDelay(2000, 1000, 1000, () => 0.5), 2500);
    assert.equal(policy.boundedDelay(-100, -100, 1000, () => 0), 1000);
    for (let i = 0; i < 1000; i++) {
        const delay = policy.boundedDelay(2000, 1000, 1000);
        assert.ok(delay >= 2000 && delay <= 3000);
    }
});

test('target shuffling stays in score bands and preserves every target exactly once', () => {
    const policy = fixture().get('two/farmOverflow/policy');
    const targets = [{id: 1, score: 100}, {id: 2, score: 96}, {id: 3, score: 50}, {id: 4, score: 48}];
    const result = policy.orderTargets(targets, t => t.score, 5, () => 0);
    assert.deepEqual(Array.from(result, t => t.id), [2, 1, 4, 3]);
    assert.deepEqual(Array.from(policy.orderTargets(targets, t => t.score, 0), t => t.id), [1, 2, 3, 4]);
    assert.deepEqual(targets.map(t => t.id), [1, 2, 3, 4]);
});

test('arrival spacing uses seconds consistently and fails closed on unknown timestamps', () => {
    const policy = fixture().get('two/farmOverflow/policy');
    assert.equal(policy.arrivalIsBusy(100, [{time_completed: 101}], 2000), true);
    assert.equal(policy.arrivalIsBusy(100, [{time_completed: 102}], 2000), false);
    assert.equal(policy.arrivalIsBusy(100, [{}], 2000), true);
});

test('preview is the default and neither sends attacks nor assigns presets', async () => {
    const f = fixture();
    f.farm.start();
    await f.settle();
    assert.equal(f.sends().length, 0);
    assert.equal(f.requests.filter(r => r.route === 'assign').length, 0);
    assert.equal(f.farm.getLogs()[0].type, 'planned_village');
    assert.equal(f.farm.getLogs()[0].ratePerHour, 3750);
});

test('the actual farmer selects the more efficient available preset', async () => {
    const f = fixture({settings: {preview_only: false}, presets: {
        1: {id: 1, units: {spear: 5}, fieldTime: 30},
        2: {id: 2, units: {spear: 20}, fieldTime: 60}
    }});
    f.farm.start();
    await f.settle();
    assert.equal(f.sends()[0].data.army_preset_id, 2);
});

test('a travel limit shorter than the actual trip prevents a send', async () => {
    const f = fixture({settings: {preview_only: false, max_travel_time: '30 seconds'}});
    f.farm.start();
    await f.settle();
    assert.equal(f.sends().length, 0);
});

test('actual sends respect the base interval even with random timing enabled', async () => {
    const f = fixture({settings: {preview_only: false}, targets: [
        {id: 100, x: 1, y: 0, points: 100, character_id: null},
        {id: 101, x: 2, y: 0, points: 100, character_id: null}
    ]});
    f.farm.start();
    await f.settle();
    assert.equal(f.sends().length, 1);
    await f.tick(1999);
    assert.equal(f.sends().length, 1);
    await f.tick(1001);
    assert.equal(f.sends().length, 2);
});

test('removing a target with invalid points does not skip the next target', async () => {
    const targets = [
        {id: 100, x: 1, y: 0, points: 100, character_id: null},
        {id: 101, x: 2, y: 0, points: 100, character_id: null}
    ];
    const f = fixture({targets, freshTargets: [{...targets[0], points: 99999}, targets[1]], settings: {preview_only: false}});
    f.farm.start();
    await f.settle();
    assert.equal(f.sends()[0].data.target_village, 101);
});

test('a newly conquered target is rejected using the current map data', async () => {
    const f = fixture({settings: {preview_only: false}, freshTargets: [
        {id: 100, x: 1, y: 0, points: 100, character_id: 8}
    ]});
    f.farm.start();
    await f.settle();
    assert.equal(f.sends().length, 0);
});

test('target distance calculation never mutates shared map entries', () => {
    const f = fixture({villageIds: [1, 2]});
    assert.equal(f.targets[0].distance, undefined);
    assert.equal(f.farm.getFarmer(1).getTargets()[0].distance, 1);
    assert.equal(f.farm.getFarmer(2).getTargets()[0].distance, 9);
});

test('duplicate target entries are removed', () => {
    const target = {id: 100, x: 1, y: 0, points: 100, character_id: null};
    const f = fixture({targets: [target, target]});
    assert.equal(f.farm.getFarmer(1).getTargets().length, 1);
});

test('server-loaded incoming attacks enforce arrival spacing', async () => {
    const f = fixture({localReady: false, settings: {preview_only: false}, serverIncoming: [
        {type: 'attack', direction: 'forward', start_village_id: 2, time_completed: 1060}
    ]});
    f.farm.start();
    await f.settle();
    assert.equal(f.sends().length, 0);
    assert.ok(f.requests.some(r => r.route === 'details'));
});

test('single-farmer restriction applies even when this farmer also has an attack', async () => {
    const f = fixture({settings: {preview_only: false, target_behavior: 'targets_allow_single_farmer'}, localIncoming: [
        {startCharacterId: 7, startVillageId: 1, type: 'attack', data: {direction: 'forward'}, time_completed: 5000},
        {startCharacterId: 7, startVillageId: 2, type: 'attack', data: {direction: 'forward'}, time_completed: 5000}
    ]});
    f.farm.start();
    await f.settle();
    assert.equal(f.sends().length, 0);
});

test('a late callback from an expired validation step cannot issue an attack', async () => {
    const f = fixture({localReady: false, deferDetails: true, settings: {preview_only: false}});
    f.farm.start();
    await f.settle();
    assert.equal(f.deferredDetails.length, 1);
    await f.tick(30000);
    f.deferredDetails[0]();
    await f.settle();
    assert.equal(f.sends().length, 0);
});

test('a callback from a stopped run cannot issue an attack after restart', async () => {
    const f = fixture({localReady: false, deferDetails: true, settings: {preview_only: false}});
    f.farm.start();
    await f.settle();
    f.farm.stop();
    f.farm.start();
    await f.settle();
    assert.equal(f.deferredDetails.length, 2);
    f.deferredDetails[0]();
    await f.settle();
    assert.equal(f.sends().length, 0);
    f.deferredDetails[1]();
    await f.settle();
    assert.equal(f.sends().length, 1);
});

test('stopping during initialization prevents a late start', async () => {
    const f = fixture({deferVillage: true, settings: {preview_only: false}});
    f.farm.start();
    f.farm.stop();
    for (const callback of f.deferredVillages) callback();
    await f.settle();
    assert.equal(f.farm.isRunning(), false);
    assert.equal(f.sends().length, 0);
});

test('an unacknowledged send stops the whole farmer without retrying', async () => {
    const f = fixture({autoAck: false, settings: {preview_only: false}});
    f.farm.start();
    await f.settle();
    assert.equal(f.sends().length, 1);
    await f.tick(30000);
    assert.equal(f.farm.isRunning(), false);
    assert.equal(f.farm.getFarmer(1).getStatus(), 'command_timeout');
    await f.tick(600000);
    assert.equal(f.sends().length, 1);
});

test('the target-count string saved by older releases is migrated', async () => {
    const f = fixture({settings: {target_limit: '25'}});
    assert.equal(f.farm.getSettings().get('target_limit'), 25);
    f.farm.start();
    await f.settle();
    assert.equal(f.farm.getLogs()[0].type, 'planned_village');
});

test('empty haul causes a persistent cooldown without requiring an ignore group', async () => {
    const f = fixture({settings: {preview_only: false}});
    f.farm.start();
    await f.settle();
    f.rootScope.$broadcast(f.events.REPORT_NEW, {type: 'attack', target_village_id: 100, result: 1, haul: 'none'});
    assert.ok(f.storage.get('farm_overflow_cooldowns_101_7')[100] > 1000000);
    f.farm.stop();
    f.farm.start();
    await f.settle();
    assert.equal(f.sends().length, 1);
    const reloaded = fixture({storageEntries: [...f.storage.entries()], settings: {preview_only: false}});
    reloaded.farm.start();
    await reloaded.settle();
    assert.equal(reloaded.sends().length, 0);
    f.farm.stop();
    await f.tick(20 * 60 * 1000);
    f.farm.start();
    await f.settle();
    assert.equal(f.sends().length, 2);
});

test('the displayed next-cycle date matches the actual sampled timer', async () => {
    const f = fixture();
    f.farm.start();
    await f.settle();
    await f.tick(3000);
    const next = f.farm.getNextCycleDate();
    assert.ok(next >= 1302000 && next <= 1333000);
    assert.equal([...f.timers.values()].filter(timer => !timer.interval && timer.date === next).length, 1);
});

test('per-village cycle cap stops before issuing another attack', async () => {
    const f = fixture({settings: {preview_only: false, max_attacks_per_cycle: 1, attack_jitter: '0 seconds'}, targets: [
        {id: 100, x: 1, y: 0, points: 100, character_id: null},
        {id: 101, x: 2, y: 0, points: 100, character_id: null}
    ]});
    f.farm.start();
    await f.settle();
    await f.tick(2000);
    assert.equal(f.sends().length, 1);
    assert.equal(f.farm.getFarmer(1).getStatus(), 'cycle_attack_limit');
});

test('saving settings cancels an in-progress validation step', async () => {
    const f = fixture({localReady: false, deferDetails: true, settings: {preview_only: false}});
    f.farm.start();
    await f.settle();
    f.farm.getSettings().set('unit_reserve_percent', 50);
    f.deferredDetails[0]();
    await f.settle();
    assert.equal(f.farm.isRunning(), false);
    assert.equal(f.sends().length, 0);
});

test('invalid persisted settings fail closed', () => {
    for (const settings of [{max_travel_time: 'invalid'}, {target_limit: null}, {unit_reserve_percent: 101},
        {attack_jitter: '-1 seconds'}, {barbarians_only: 'true'}, {min_distance: 20, max_distance: 10}]) {
        const f = fixture({settings});
        assert.equal(f.farm.start(), false);
        assert.equal(f.sends().length, 0);
    }
});
