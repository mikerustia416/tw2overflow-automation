const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const copy = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture (options = {}) {
    const definitions = new Map();
    const modules = new Map();
    const storage = new Map(options.storageEntries || []);
    const listeners = new Map();
    const timers = new Map();
    const requests = [];
    const deferredDetails = [];
    const deferredVillages = [];
    let clock = 1000000;
    let timerId = 0;
    const targets = copy(options.targets || [{id: 100, x: 1, y: 0, points: 100, character_id: null}]);
    const freshTargets = copy(options.freshTargets || targets);
    const units = options.units || {spear: {in_town: 100}};
    const presets = options.presets || {1: {id: 1, units: {spear: 5}, fieldTime: 60}};
    const localIncoming = options.localIncoming || [];
    const villageIds = options.villageIds || [1];
    const villages = Object.fromEntries(villageIds.map((id, i) => [id, {
        readyState: {own: options.localReady !== false},
        getId: () => id,
        getPosition: () => ({x: i * 10, y: 0}),
        getUnitInfo: () => ({getUnits: () => units}),
        getCommandListModel: () => ({getOutgoingCommands: () => options.outgoing || []}),
        getResources: () => ({
            getComputed: () => Object.fromEntries(['wood', 'clay', 'iron'].map(type => [type, {currentStock: 0}])),
            getMaxStorage: () => 1000
        })
    }]));
    const player = {
        getId: () => 7,
        getWorldId: () => 101,
        getVillage: id => villages[id],
        getVillages: () => villages
    };
    const events = {
        COMMAND_SENT: 'command_sent', MESSAGE_ERROR: 'message_error', REPORT_NEW: 'report_new',
        ARMY_PRESET_UPDATE: 'preset_update', ARMY_PRESET_DELETED: 'preset_deleted',
        GROUPS_VILLAGE_LINKED: 'group_linked', GROUPS_VILLAGE_UNLINKED: 'group_unlinked', GROUPS_DESTROYED: 'group_destroyed'
    };
    const routes = {SEND_PRESET: {type: 'send'}, SEND_CUSTOM_ARMY: {type: 'custom'}, ASSIGN_PRESETS: {type: 'assign'}, MAP_GET_VILLAGE_DETAILS: {type: 'details'}};
    const rootScope = {
        loc: {ale: 'en'},
        $on: (event, handler) => {
            if (!listeners.has(event)) listeners.set(event, []);
            listeners.get(event).push(handler);
        },
        $broadcast: (event, data) => {
            for (const handler of listeners.get(event) || []) handler(null, data);
        }
    };
    const queueListeners = new Map();
    const eventQueue = options.separateEventQueue ? {
        register: (event, handler) => {
            if (!queueListeners.has(event)) queueListeners.set(event, []);
            queueListeners.get(event).push(handler);
        },
        trigger: (event, data) => {
            for (const handler of queueListeners.get(event) || []) handler(event, data || {});
        }
    } : {trigger: rootScope.$broadcast, register: rootScope.$on};
    const lockr = {
        get: (key, fallback) => copy(storage.has(key) ? storage.get(key) : fallback),
        set: (key, value) => storage.set(key, copy(value))
    };
    const context = vm.createContext({
        console,
        noop: () => {}, hasOwn: Object.prototype.hasOwnProperty,
        angular: {copy, merge: (unused, defaults, values) => ({...copy(defaults), ...copy(values)}),
            equals: (a, b) => JSON.stringify(a) === JSON.stringify(b), extend: Object.assign,
            isObject: value => value !== null && typeof value === 'object'},
        $rootScope: rootScope, eventTypeProvider: events, routeProvider: routes,
        $filter: () => key => key,
        modelDataService: {
            getSelectedCharacter: () => player,
            getVillages: () => villages,
            getGameData: () => ({getUnitsObject: () => options.unitData || {spear: {load: 25}}}),
            getGroupList: () => ({getGroups: () => ({}), getGroupVillageIds: () => []}),
            getPresetList: () => ({getPresets: () => presets, getPresetsByVillageId: () => presets})
        },
        villageService: {ensureVillageDataLoaded: (id, callback) => {
            if (options.deferVillage) deferredVillages.push(callback);
            else callback();
        }},
        armyService: {
            calculateTravelTime: preset => preset.fieldTime || 60,
            getTravelTimeForDistance: (preset, fieldTime, distance) => fieldTime * distance
        },
        resourceService: {updateMaxStorage: () => {}},
        villageInfoService: {getCommands: () => localIncoming},
        socketService: {emit: (route, data, callback) => {
            requests.push({route: route.type, data: copy(data)});
            if ((route === routes.SEND_PRESET || route === routes.SEND_CUSTOM_ARMY) && options.autoAck !== false) {
                queueMicrotask(() => rootScope.$broadcast(events.COMMAND_SENT, {
                    origin: {id: data.start_village}, target: {id: data.target_village}, direction: 'forward', type: 'attack'
                }));
            } else if (route === routes.MAP_GET_VILLAGE_DETAILS) {
                const reply = () => callback({commands: {own: options.serverIncoming || []}});
                if (options.deferDetails) deferredDetails.push(reply);
                else reply();
            } else if (callback) callback({});
        }},
        setTimeout: (fn, delay) => {
            const id = ++timerId;
            timers.set(id, {fn, date: clock + delay});
            return id;
        },
        clearTimeout: id => timers.delete(id),
        setInterval: (fn, interval) => {
            const id = ++timerId;
            timers.set(id, {fn, date: clock + interval, interval});
            return id;
        },
        clearInterval: id => timers.delete(id),
        define: (name, deps, factory) => {
            if (typeof deps === 'function') { factory = deps; deps = []; }
            definitions.set(name, {deps, factory});
        }
    });
    vm.runInContext('Number.prototype.between = function (min, max) { return this >= min && this <= max; };', context);
    const get = name => {
        if (modules.has(name)) return modules.get(name);
        const {deps, factory} = definitions.get(name) || {};
        if (!factory) throw new Error(`Missing fixture module ${name}`);
        const value = factory(...deps.map(get));
        modules.set(name, value);
        return value;
    };
    for (const file of ['src/libs/numbered.js', 'src/libs/human-interval.js', 'src/settings.js',
        'src/modules/farm_overflow/src/settings.js', 'src/modules/farm_overflow/src/types.js',
        'src/modules/farm_overflow/src/events.js', 'src/modules/farm_overflow/src/policy.js',
        'src/modules/farm_overflow/src/auto-presets.js', 'src/modules/farm_overflow/src/core.js']) {
        vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, {filename: file});
    }
    modules.set('Lockr', lockr);
    modules.set('two/utils', {
        each: (object, fn) => { for (const [key, value] of Object.entries(object)) if (fn(value, key) === false) break; },
        notif: () => {}
    });
    modules.set('two/debug', () => () => {});
    modules.set('helper/math', {actualDistance: (a, b) => Math.hypot(a.x - b.x, a.y - b.y)});
    modules.set('helper/time', {gameTime: () => clock});
    modules.set('two/mapData', {load: callback => callback(targets)});
    modules.set('two/ready', callback => callback());
    modules.set('queues/EventQueue', eventQueue);
    modules.set('conf/commandTypes', {TYPES: {ATTACK: 'attack'}});
    modules.set('conf/village', {READY_STATES: {OWN_COMMANDS: 'own'}});
    modules.set('conf/resourceTypes', {WOOD: 'wood', CLAY: 'clay', IRON: 'iron'});
    modules.set('struct/MapData', {
        getTownAt: (x, y) => freshTargets.find(t => t.x === x && t.y === y),
        getTownAtAsync: (x, y, callback) => callback(freshTargets.find(t => t.x === x && t.y === y)),
        loadTownData: () => {}
    });
    storage.set('farm_overflow_settings', {presets: Object.keys(presets).map(Number), target_order_variation: 0,
        ...storage.get('farm_overflow_settings'), ...options.settings});
    get('two/farmOverflow/events');
    const farm = get('two/farmOverflow');
    if (!options.deferFarmInit) farm.init();

    const settle = async () => { for (let i = 0; i < 4; i++) await flush(); };
    const tick = async milliseconds => {
        const until = clock + milliseconds;
        for (;;) {
            const due = [...timers.entries()].filter(([, value]) => value.date <= until).sort((a, b) => a[1].date - b[1].date)[0];
            if (!due) break;
            const [id, timer] = due;
            clock = timer.date;
            timers.delete(id);
            if (timer.interval) timers.set(id, {...timer, date: clock + timer.interval});
            timer.fn();
            await settle();
        }
        clock = until;
        await settle();
    };
    return {farm, get, targets, freshTargets, presets, units, villages, requests, storage, rootScope, events, deferredDetails, timers,
        context, setModule: (name, value) => modules.set(name, value),
        loadSource: file => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, {filename: file}),
        deferredVillages, settle, tick, sends: () => requests.filter(request => request.route === 'send')};
}

module.exports = {fixture};
