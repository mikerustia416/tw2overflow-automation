const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const plain = value => JSON.parse(JSON.stringify(value));
const types = Object.fromEntries(['HEADQUARTER', 'FARM', 'WAREHOUSE', 'RALLY_POINT', 'BARRACKS', 'TIMBER_CAMP', 'CLAY_PIT', 'IRON_MINE', 'WALL', 'MARKET', 'HOSPITAL', 'ACADEMY', 'TAVERN', 'STATUE', 'PRECEPTORY'].map(key => [key, key.toLowerCase()]));
function load (file, deps = {}) {
    let result;
    const context = vm.createContext({hasOwn: Object.prototype.hasOwnProperty, define: (name, dependencies, factory) => {
        result = factory(...dependencies.map(id => deps[id]));
    }});
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
    return result;
}
function labels () {
    const groups = {10: {id: 10, name: 'defensive'}, 20: {id: 20, name: ' OFFENSIVE '}, 30: {id: 30, name: 'Resource'}, 40: {id: 40, name: 'Custom'}};
    const membership = {10: [1], 20: ['1', 2], 30: [3], 40: [2]};
    const calls = [];
    return {groups, membership, calls, getGroups: () => groups, getGroupVillageIds: id => {calls.push(id); return membership[id] || [];}};
}
const policy = load('src/modules/builder_queue/src/label-policy.js');
const sequences = {Essential: ['farm'], Offensive: ['barracks'], Defensive: ['wall'], Resource: ['timber_camp'], Custom: ['market']};
const config = {building_sequence: 'Essential', follow_village_labels: true, manual_sequence_override: false, label_sequence_mappings: []};

test('Builder labels use group objects and group-village API with stable role precedence', () => {
    const groups = labels();
    assert.deepEqual(plain(policy.resolve(config, '1', groups, sequences)), {sequence: 'Offensive', source: 'label', groupId: 20});
    assert.equal(policy.resolve(config, 3, groups, sequences).sequence, 'Resource');
    assert.equal(policy.resolve(config, 999, groups, sequences).sequence, 'Essential');
    assert.ok(groups.calls.includes(20));
    const reversed = {...groups, getGroups: () => Object.values(groups.groups).reverse()};
    assert.equal(policy.resolve(config, 1, reversed, sequences).sequence, 'Offensive');
});

test('Builder ordered ID mappings can select edited custom sequences and skip invalid entries', () => {
    const mapped = {...config, label_sequence_mappings: [null, {group_id: 40, sequence: 'Missing'}, {group_id: 999, sequence: 'Custom'}, {group_id: '40', sequence: 'Custom'}, {group_id: 20, sequence: 'Resource'}]};
    assert.deepEqual(plain(policy.resolve(mapped, 2, labels(), sequences)), {sequence: 'Custom', source: 'mapping', groupId: 40});
    assert.equal(policy.resolve({...mapped, label_sequence_mappings: mapped.label_sequence_mappings.slice().reverse()}, 2, labels(), sequences).sequence, 'Resource');
    assert.equal(policy.resolve({...config, label_sequence_mappings: [{group_id: 20, sequence: 'Missing'}]}, 2, labels(), sequences).sequence, 'Offensive');
});

test('manual village choice and disabled following take priority; missing manual sequence remains invalid', () => {
    assert.equal(policy.resolve({...config, manual_sequence_override: true, building_sequence: 'Defensive'}, 2, labels(), sequences).sequence, 'Defensive');
    assert.equal(policy.resolve({...config, follow_village_labels: false}, 2, labels(), sequences).source, 'manual');
    assert.equal(policy.resolve({...config, manual_sequence_override: true, building_sequence: 'Deleted'}, 2, labels(), sequences).sequence, 'Deleted');
});

test('role selection refreshes after linking/unlinking and does not mutate labels or configurations', () => {
    const groups = labels();
    const originalConfig = JSON.stringify(config);
    const originalGroups = JSON.stringify(groups.groups);
    assert.equal(policy.resolve(config, 2, groups, sequences).sequence, 'Offensive');
    groups.membership[20] = [1];
    assert.equal(policy.resolve(config, 2, groups, sequences).sequence, 'Custom');
    groups.membership[30].push(2);
    assert.equal(policy.resolve(config, 2, groups, sequences).sequence, 'Resource');
    assert.equal(JSON.stringify(config), originalConfig);
    assert.equal(JSON.stringify(groups.groups), originalGroups);
});

test('unavailable group APIs, nonexact names, and missing role sequences fall back safely', () => {
    for (const groups of [null, {}, {getGroups: () => {throw Error('unavailable');}, getGroupVillageIds: () => []}, {getGroups: () => null, getGroupVillageIds: () => []}]) {
        assert.equal(policy.resolve(config, 1, groups, sequences).source, 'fallback');
    }
    const groups = labels();
    groups.groups[20].name = 'Offensive extra';
    groups.membership[10] = [];
    assert.equal(policy.resolve(config, 1, groups, sequences).sequence, 'Essential');
    groups.groups[20].name = 'Offensive';
    assert.equal(policy.resolve(config, 2, groups, {Essential: []}).sequence, 'Essential');
    groups.getGroupVillageIds = () => {throw Error('stale group');};
    assert.equal(policy.resolve(config, 1, groups, sequences).sequence, 'Essential');
    assert.equal(policy.resolve(config, 1, labels(), Object.create({Offensive: []})).sequence, 'Essential');
});

test('editable role phases generate deterministic complete sequences within verified max levels and HQ gates', () => {
    const first = load('src/modules/builder_queue/src/default-orders.js', {'conf/buildingTypes': types});
    const second = load('src/modules/builder_queue/src/default-orders.js', {'conf/buildingTypes': types});
    for (const role of ['Offensive', 'Defensive', 'Resource']) {
        assert.deepEqual(plain(first[role]), plain(second[role]));
        const counts = {};
        for (const building of first[role]) {
            assert.ok(Object.values(types).includes(building));
            if (!counts[building]) {
                const required = {barracks: 2, hospital: 4, wall: 5, market: 6, academy: 20}[building];
                if (required) assert.ok(counts.headquarter >= required, `${role} ${building} needs HQ ${required}`);
            }
            counts[building] = (counts[building] || 0) + 1;
            const max = {barracks: 25, hospital: 10, wall: 20, market: 25, rally_point: 5, academy: 1}[building] || 30;
            assert.ok(counts[building] <= max, `${role} ${building} exceeds ${max}`);
        }
        assert.equal(counts.warehouse, 30);
        assert.ok(counts.farm >= 25);
        assert.ok(counts.timber_camp >= 24);
        assert.ok(first[role].indexOf('warehouse') < first[role].indexOf('barracks'));
        assert.ok(first[role].indexOf('farm') < first[role].indexOf('barracks'));
    }
    const count = (role, building) => first[role].filter(item => item === building).length;
    assert.equal(count('Offensive', 'barracks'), 25);
    assert.equal(count('Offensive', 'academy'), 1);
    assert.equal(count('Defensive', 'wall'), 20);
    assert.equal(count('Defensive', 'hospital'), 10);
    assert.equal(count('Resource', 'timber_camp'), 30);
    assert.equal(count('Resource', 'barracks'), 5);
    for (const legacy of ['Essential', 'Full Village', 'Essential Without Wall', 'Full Wall', 'Full Farm']) assert.ok(Array.isArray(first[legacy]));
});

test('any saved sequence matches complete village label names with stable overlap precedence', () => {
    const groups = labels();
    groups.groups[20].name = '  starter farm ';
    groups.groups[40].name = 'Zeta';
    const library = {Zeta: ['wall'], 'Starter Farm': ['farm'], Essential: []};
    assert.deepEqual(plain(policy.resolve(config, 2, groups, library)), {sequence: 'Starter Farm', source: 'label', groupId: 20});
    const reversed = {...groups, getGroups: () => Object.values(groups.groups).reverse()};
    assert.equal(policy.resolve(config, 2, reversed, Object.fromEntries(Object.entries(library).reverse())).sequence, 'Starter Farm');
    assert.equal(policy.resolve({...config, label_sequence_mappings: [{group_id: 40, sequence: 'Zeta'}]}, 2, groups, library).sequence, 'Zeta');
    assert.equal(policy.resolve({...config, manual_sequence_override: true}, 2, groups, library).source, 'manual');
    groups.groups[20].name = 'Starter Farm extra';
    assert.equal(policy.resolve(config, 1, groups, library).sequence, 'Essential');
    groups.groups[20].name = 'Starter Farm';
    groups.groups[5] = {id: 5, name: 'STARTER FARM'};
    groups.membership[5] = [2];
    assert.equal(policy.resolve(config, 2, groups, library).groupId, 5);
    assert.equal(policy.resolve(config, 2, groups, {...library, 'Starter Farm': null}).sequence, 'Zeta');
});
