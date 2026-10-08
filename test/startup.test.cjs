const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const root = path.join(__dirname, '..');

test('shared startup only initializes language; modules own their lifecycle', () => {
    let initialized = 0;
    vm.runInNewContext(fs.readFileSync(path.join(root, 'src/init.js'), 'utf8'), {
        require: (dependencies, callback) => {
            assert.deepEqual(Array.from(dependencies), ['two/language', 'two/ready']);
            callback({init: () => initialized++}, callback => callback());
        }
    });
    assert.equal(initialized, 1);
});

test('bundled startup and module dependencies include no missing two modules', () => {
    const definitions = new Map();
    const requests = [];
    const define = (name, dependencies) => {
        if (typeof name === 'string') definitions.set(name, Array.isArray(dependencies) ? Array.from(dependencies) : []);
    };
    define.amd = {};
    const browser = {injector: {get: () => ({})}, define,
        require: dependencies => requests.push(...Array.from(dependencies)), angular: {}};
    const context = {window: browser, unsafeWindow: browser, console, setTimeout: () => {}, setInterval: () => {},
        URLSearchParams, location: {search: '?world=en1&character_id=7'},
        localStorage: {length: 0}, GM_getValue: () => undefined, GM_setValue: () => {}};
    vm.runInNewContext(fs.readFileSync(path.resolve(root, process.env.TW2_TEST_USERSCRIPT || 'userscript/tw2overflow-farming.user.js'), 'utf8'), context);
    for (const name of ['two/farmOverflow', 'two/recruiter', 'two/autoQuest', 'two/dailyPopups', 'two/builderQueue', 'two/autoMinter', 'two/spy_recruiter', 'two/depositPlanner', 'two/commandQueue', 'two/autoCollector/secondVillage']) assert.ok(definitions.has(name), name);
    assert.equal(definitions.has('two/usage_report'), false);
    assert.equal(definitions.has('Lockr'), false);
    assert.equal(requests.includes('Lockr'), false);
    const dependencies = [...requests, ...Array.from(definitions.values()).flat()];
    assert.deepEqual([...new Set(dependencies.filter(name => name.startsWith('two/') && !definitions.has(name)))], []);
});
