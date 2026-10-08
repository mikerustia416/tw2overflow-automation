const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/libs/lockr.js'), 'utf8');
const key = name => '7_twOverflow_en1-' + name;
const encode = data => JSON.stringify({data});

function fixture (options = {}) {
    const legacy = new Map(options.legacy || []);
    const privateData = options.privateData || new Map();
    const writes = [];
    const removals = [];
    let store;
    const localStorage = {
        get length () { return legacy.size; },
        key: index => [...legacy.keys()][index] ?? null,
        getItem: name => legacy.has(name) ? legacy.get(name) : null,
        setItem: () => { throw new Error('New page storage writes are forbidden'); },
        removeItem: name => {
            removals.push(name);
            if (options.removeError) throw new Error('Removal failed');
            if (!options.ignoreRemoval) legacy.delete(name);
        }
    };
    const context = {
        URLSearchParams, location: {search: options.search || '?world=en1&character_id=7'}, localStorage,
        GM_getValue: name => {
            if (options.readError) throw new Error('Private read failed');
            return privateData.get(name);
        },
        GM_setValue: (name, raw) => {
            writes.push(name);
            if (options.writeError) throw new Error('Private write failed');
            if (!options.ignoreWrite) privateData.set(name, raw);
            if (options.onWrite) options.onWrite({name, raw, legacy, privateData});
        },
        define: (name, factory) => { assert.equal(name, 'Lockr'); store = factory(); }
    };
    if (options.missingGrants) delete context.GM_setValue;
    const boot = () => vm.runInNewContext(source, context);
    return {legacy, privateData, localStorage, writes, removals, boot, context, get store () { return store; }};
}

const plain = value => JSON.parse(JSON.stringify(value));

test('private storage round-trips settings, false states, logs and pending guards across reload', () => {
    const f = fixture();
    f.boot();
    const values = {
        settings: {reserve: 100, preview: false, villages: [1, 2]}, active: false,
        logs: [{time: 123, message: 'planned'}], pending: {village: 1, sent: 123}, zero: 0, empty: '', nil: null
    };
    for (const [name, value] of Object.entries(values)) f.store.set(name, value);
    const reload = fixture({privateData: f.privateData});
    reload.boot();
    for (const [name, value] of Object.entries(values)) assert.deepEqual(plain(reload.store.get(name)), value);
    assert.equal(reload.store.get('absent', 'fallback'), 'fallback');
    assert.equal(f.legacy.size, 0);
});

test('first boot migrates every owned namespace, including inactive modules, and preserves unrelated storage', () => {
    const entries = [[key('settings'), encode({preview: true})], [key('active'), encode(true)],
        [key('pending'), encode({sent: true})], ['8_twOverflow_de2-old_logs', encode([1])],
        ['game_settings', 'keep'], ['7_twOverflow_', 'keep'], ['other_twOverflow_en1-key', 'keep']];
    const f = fixture({legacy: entries});
    f.boot();
    for (const [name, raw] of entries.slice(0, 4)) {
        assert.equal(f.privateData.get(name), raw);
        assert.equal(f.legacy.has(name), false);
    }
    assert.deepEqual([...f.legacy], entries.slice(4));
    assert.deepEqual(plain(f.store.get('pending')), {sent: true});
});

test('existing private settings win and conflicting browser values are backed up before removal', () => {
    const old = encode({reserve: 50});
    const current = encode({reserve: 100});
    const f = fixture({legacy: [[key('settings'), old]], privateData: new Map([[key('settings'), current]])});
    f.boot();
    assert.equal(f.privateData.get('tw2overflow:legacy-backup:' + key('settings')), old);
    assert.deepEqual(plain(f.store.get('settings')), {reserve: 100});
    assert.equal(f.legacy.size, 0);
});

test('identical private data is retained without rewriting it during legacy cleanup', () => {
    const raw = encode(false);
    const f = fixture({legacy: [[key('active'), raw]], privateData: new Map([[key('active'), raw]])});
    f.boot();
    assert.equal(f.store.get('active'), false);
    assert.deepEqual(f.writes, []);
    assert.equal(f.legacy.size, 0);
});

for (const [name, options] of Object.entries({
    missing_grants: {missingGrants: true}, rejected_write: {writeError: true},
    rejected_read: {readError: true}, unconfirmed_copy: {ignoreWrite: true},
    rejected_removal: {removeError: true}, unconfirmed_removal: {ignoreRemoval: true}
})) {
    test(name + ' stops startup and retains the legacy pending guard', () => {
        const raw = encode({pending: true});
        const f = fixture({...options, legacy: [[key('pending'), raw]]});
        assert.throws(f.boot);
        assert.equal(f.legacy.get(key('pending')), raw);
        assert.equal(f.store, undefined);
    });
}

test('failed backup does not delete conflicting legacy data or overwrite current private settings', () => {
    const old = encode(50);
    const current = encode(100);
    const f = fixture({ignoreWrite: true, legacy: [[key('reserve'), old]], privateData: new Map([[key('reserve'), current]])});
    assert.throws(f.boot, /verify private storage/);
    assert.equal(f.legacy.get(key('reserve')), old);
    assert.equal(f.privateData.get(key('reserve')), current);
});

test('migration detects an older copy changing a browser entry before deletion', () => {
    const changed = encode({pending: 'new'});
    const f = fixture({legacy: [[key('pending'), encode({pending: 'old'})]],
        onWrite: ({legacy}) => legacy.set(key('pending'), changed)});
    assert.throws(f.boot, /browser storage changed/);
    assert.equal(f.legacy.get(key('pending')), changed);
    assert.deepEqual(f.removals, []);
});

test('migration detects private data changing before deletion', () => {
    const raw = encode(true);
    const f = fixture({legacy: [[key('active'), raw]],
        onWrite: ({name, privateData}) => privateData.set(name, encode(false))});
    assert.throws(f.boot, /verify private storage/);
    assert.equal(f.legacy.get(key('active')), raw);
});

test('failed new writes throw and never fall back to browser storage', () => {
    const f = fixture({ignoreWrite: true});
    f.boot();
    assert.throws(() => f.store.set('active', true), /verify private storage/);
    assert.equal(f.legacy.size, 0);
});

test('world and character namespaces remain separate; URL parameter order does not matter', () => {
    const privateData = new Map();
    for (const [search, value] of [['?character_id=7&world=en1', 1], ['?world=en2&character_id=7', 2], ['?world=en1&character_id=8', 3]]) {
        const f = fixture({privateData, search});
        f.boot();
        f.store.set('reserve', value);
        assert.equal(f.store.get('reserve'), value);
    }
    assert.equal(privateData.size, 3);
    assert.equal(privateData.get(key('reserve')), encode(1));
});

test('legacy raw strings, nulls and wrappers retain previous read behavior', () => {
    const f = fixture({legacy: [[key('raw'), 'unwrapped text'], [key('nil'), 'null'],
        [key('empty'), ''], [key('false'), encode(false)], [key('object'), encode({x: 1})]]});
    f.boot();
    assert.equal(f.store.get('raw'), 'unwrapped text');
    assert.equal(f.store.get('nil', 'missing'), 'missing');
    assert.equal(f.store.get('empty', 'missing'), 'missing');
    assert.equal(f.store.get('false'), false);
    assert.deepEqual(plain(f.store.get('object')), {x: 1});
});

test('explicit noPrefix legacy reads migrate only the requested entry; boolean options keep legacy prefix semantics', () => {
    const f = fixture({legacy: [['explicit', encode(4)], ['game', 'keep']]});
    f.boot();
    assert.equal(f.store.get('explicit', 0, {noPrefix: true}), 4);
    f.store.set('value', 9, true);
    assert.equal(f.privateData.get(key('value')), encode(9));
    assert.deepEqual([...f.legacy], [['game', 'keep']]);
});

test('private AMD adapter hides Lockr and preserves dependency positions and factory context', () => {
    const definitions = new Map();
    const requests = [];
    const browser = {injector: {get: () => ({})}, angular: {}, require: (dependencies, callback) => {
        requests.push(Array.from(dependencies));
        callback.call({tag: 'require-context'}, ...dependencies.map(name => name));
    },
        define: (name, dependencies, factory) => definitions.set(name, {dependencies, factory})};
    const f = fixture();
    const context = {...f.context, window: browser, unsafeWindow: browser, setTimeout: () => {}};
    const header = fs.readFileSync(path.join(root, 'src/header.js'), 'utf8');
    vm.runInNewContext(header + '\n' + source + `
        define('two/private-test', ['first', 'Lockr', 'second'], function (first, storage, second) {
            storage.set('test', {first, second});
            return {first, second, context: this.tag, stored: storage.get('test')};
        });
        define('normal', ['first'], function (first) { return first; });
        require(['first', 'Lockr', 'second'], function (first, storage, second) {
            storage.set('require-test', {first, second, context: this.tag});
        });
        if (require('Lockr').get('require-test').context !== 'require-context') {
            throw new Error('Private require must preserve its callback context');
        }
    });`, context);
    assert.equal(definitions.has('Lockr'), false);
    const entry = definitions.get('two/private-test');
    assert.deepEqual(Array.from(entry.dependencies), ['first', 'second']);
    assert.deepEqual(plain(entry.factory.call({tag: 'context'}, 'a', 'b')),
        {first: 'a', second: 'b', context: 'context', stored: {first: 'a', second: 'b'}});
    assert.equal(definitions.get('normal').factory('c'), 'c');
    assert.equal(browser.GM_getValue, undefined);
    assert.equal(browser.GM_setValue, undefined);
    assert.equal(browser.Lockr, undefined);
    assert.deepEqual(requests, [['first', 'second']]);
    assert.deepEqual(JSON.parse(f.privateData.get(key('require-test'))),
        {data: {first: 'first', second: 'second', context: 'require-context'}});
});

function bundledFixture (options = {}) {
    const f = fixture(options);
    const definitions = new Map();
    const requests = [];
    const browser = {injector: {get: () => ({})}, angular: {},
        define: (name, dependencies) => definitions.set(name, Array.isArray(dependencies) ? Array.from(dependencies) : []),
        require: dependencies => requests.push(...dependencies)};
    const context = {...f.context, window: browser, unsafeWindow: browser, console,
        setTimeout: () => {}, setInterval: () => {}};
    const artifact = fs.readFileSync(path.join(root, 'userscript/tw2overflow-farming.user.js'), 'utf8');
    return {...f, definitions, requests, run: () => vm.runInNewContext(artifact, context)};
}

test('installable bundle migrates guards before game module startup and exposes no storage module or dependency', () => {
    const raw = encode({village: 7, pending: true});
    const f = bundledFixture({legacy: [[key('pending'), raw], ['native_game', 'untouched']]});
    f.run();
    assert.equal(f.privateData.get(key('pending')), raw);
    assert.deepEqual([...f.legacy], [['native_game', 'untouched']]);
    assert.equal(f.definitions.has('Lockr'), false);
    assert.ok(f.definitions.has('two/Settings'));
    assert.ok(f.requests.length > 0);
    assert.equal(f.requests.includes('Lockr'), false);
    assert.ok([...f.definitions.values()].every(deps => !deps.includes('Lockr')));
});

test('installable bundle never registers or starts game modules when migration fails', () => {
    const raw = encode({village: 7, pending: true});
    const f = bundledFixture({legacy: [[key('pending'), raw]], ignoreWrite: true});
    assert.throws(f.run, /verify private storage/);
    assert.equal(f.legacy.get(key('pending')), raw);
    assert.equal(f.definitions.size, 0);
    assert.deepEqual(f.requests, []);
});
