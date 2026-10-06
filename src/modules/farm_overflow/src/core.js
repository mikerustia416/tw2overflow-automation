define('two/farmOverflow', [
    'two/Settings',
    'two/farmOverflow/types/errors',
    'two/farmOverflow/types/status',
    'two/farmOverflow/settings',
    'two/farmOverflow/settings/map',
    'two/farmOverflow/settings/updates',
    'two/farmOverflow/types/farmerBehavior',
    'two/farmOverflow/types/targetBehavior',
    'two/farmOverflow/types/logs',
    'two/mapData',
    'two/utils',
    'two/ready',
    'helper/math',
    'helper/time',
    'queues/EventQueue',
    'conf/commandTypes',
    'conf/village',
    'conf/resourceTypes',
    'struct/MapData',
    'Lockr',
    'two/debug',
    'two/farmOverflow/policy',
    'two/farmOverflow/autoPresets'
], function (
    Settings,
    ERROR_TYPES,
    STATUS,
    SETTINGS,
    SETTINGS_MAP,
    UPDATES,
    FARMER_BEHAVIOR,
    TARGET_BEHAVIOR,
    LOG_TYPES,
    twoMapData,
    utils,
    ready,
    math,
    timeHelper,
    eventQueue,
    COMMAND_TYPES,
    VILLAGE_CONFIG,
    RESOURCE_TYPES,
    $mapData,
    Lockr,
    setupDebug,
    policy,
    autoPresets
) {
    let initialized = false;
    let running = false;
    let settings;
    let localSettings;
    const farmers = [];
    let logs = [];
    let includedVillages = [];
    let ignoredVillages = [];
    let onlyVillages = [];
    let selectedPresets = [];
    let activeFarmer = false;
    let sendingCommand = false;
    let currentTarget = false;
    let farmerIndex = 0;
    let cycleTimer = null;
    let stepDelayTimer = null;
    let commandExpireTimer = null;
    let exceptionLogs;
    const tempVillageReports = {};
    let $player;
    let unitsData;
    let persistentRunningLastCheck = timeHelper.gameTime();
    let persistentRunningTimer = null;
    let nextCycleDate = null;
    let runVersion = 0;
    let targetCooldowns = {};
    let cooldownStorageKey;
    const PERSISTENT_RUNNING_CHECK_INTERVAL = 30 * 1000;
    const VILLAGE_COMMAND_LIMIT = 50;
    const MINIMUM_FARMER_CYCLE_INTERVAL = 1000; // ms
    const MINIMUM_ATTACK_INTERVAL = 1000; // ms
    const STEP_EXPIRE_TIME = 30 * 1000;
    const CYCLE_BEGIN = 'cycle_begin';
    const IGNORE_UPDATES = 'ignore_update';
    const STORAGE_KEYS = {
        LOGS: 'farm_overflow_logs',
        SETTINGS: 'farm_overflow_settings',
        EXCEPTION_LOGS: 'farm_overflow_exception_logs'
    };
    const RESOURCES = [
        RESOURCE_TYPES.WOOD,
        RESOURCE_TYPES.CLAY,
        RESOURCE_TYPES.IRON
    ];

    const debug = setupDebug('farm_overflow');

    const villageFilters = {
        distance: function (target) {
            return !Number.isFinite(target.distance) || !target.distance.between(
                localSettings[SETTINGS.MIN_DISTANCE],
                localSettings[SETTINGS.MAX_DISTANCE]
            );
        },
        ownPlayer: function (target) {
            return Number(target.character_id) === Number($player.getId());
        },
        included: function (target) {
            return !policy.isBarbarian(target) && !includedVillages.includes(target.id);
        },
        barbarian: function (target) {
            return localSettings[SETTINGS.BARBARIANS_ONLY] && !policy.isBarbarian(target);
        },
        ignored: function (target) {
            return ignoredVillages.includes(target.id);
        },
        points: function (points) {
            return !points.between(
                localSettings[SETTINGS.MIN_POINTS],
                localSettings[SETTINGS.MAX_POINTS]
            );
        }
    };

    const targetFilters = [
        villageFilters.distance,
        villageFilters.ownPlayer,
        villageFilters.included,
        villageFilters.ignored,
        villageFilters.barbarian
    ];

    const calcDistances = function (targets, origin) {
        return targets.map(function (target) {
            return {...target, distance: math.actualDistance(origin, target)};
        });
    };

    const filterTargets = function (targets) {
        const seen = new Set();
        return targets.filter(function (target) {
            if (seen.has(target.id)) {
                return false;
            }

            seen.add(target.id);
            return targetFilters.every(function (fn) {
                return !fn(target);
            });
        });
    };

    const sortTargets = function (targets) {
        return targets.sort(function (a, b) {
            return a.distance - b.distance;
        });
    };

    const arrayUnique = function (array) {
        return array.sort().filter(function (item, pos, ary) {
            return !pos || item != ary[pos - 1];
        });
    };

    const reloadTimers = function () {
        if (!running) {
            return;
        }

        if (stepDelayTimer) {
            stopTimers();
            activeFarmer.targetStep({
                delay: true
            });
        } else if (cycleTimer) {
            stopTimers();

            eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_CYCLE_BEGIN);

            farmerIndex = 0;
            farmerStep();
        }
    };

    const updateIncludedVillage = function () {
        const groupsInclude = localSettings[SETTINGS.GROUP_INCLUDE];

        includedVillages = [];

        groupsInclude.forEach(function (groupId) {
            const groupVillages = modelDataService.getGroupList().getGroupVillageIds(groupId);
            includedVillages = includedVillages.concat(groupVillages);
        });

        includedVillages = arrayUnique(includedVillages);
    };

    const updateIgnoredVillage = function () {
        const groupIgnored = localSettings[SETTINGS.GROUP_IGNORE];
        ignoredVillages = modelDataService.getGroupList().getGroupVillageIds(groupIgnored);
    };

    const updateOnlyVillage = function () {
        const groupsOnly = localSettings[SETTINGS.GROUP_ONLY];

        onlyVillages = [];

        groupsOnly.forEach(function (groupId) {
            let groupVillages = modelDataService.getGroupList().getGroupVillageIds(groupId);
            groupVillages = groupVillages.filter(function (villageId) {
                return !!$player.getVillage(villageId);
            });

            onlyVillages = onlyVillages.concat(groupVillages);
        });

        onlyVillages = arrayUnique(onlyVillages);
    };

    const updateExceptionLogs = function () {
        const exceptionVillages = ignoredVillages.concat(includedVillages);
        let modified = false;

        exceptionVillages.forEach(function (villageId) {
            if (!hasOwn.call(exceptionLogs, villageId)) { 
                exceptionLogs[villageId] = {
                    time: timeHelper.gameTime(),
                    report: false
                };
                modified = true;
            }
        });

        utils.each(exceptionLogs, function (time, villageId) {
            villageId = parseInt(villageId, 10);
            
            if (!exceptionVillages.includes(villageId)) {
                delete exceptionLogs[villageId];
                modified = true;
            }
        });

        if (modified) {
            Lockr.set(STORAGE_KEYS.EXCEPTION_LOGS, exceptionLogs);
            eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_EXCEPTION_LOGS_UPDATED);
        }
    };

    const updateGroupVillages = function () {
        updateIncludedVillage();
        updateIgnoredVillage();
        updateOnlyVillage();
        updateExceptionLogs();

        debug(1, 'includedVillages %o', includedVillages);
        debug(1, 'ignoredVillages %o', ignoredVillages);
        debug(1, 'onlyVillages %o', onlyVillages);

        eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_EXCEPTION_VILLAGES_UPDATED);
    };

    const villageGroupLink = function (event, data) {
        debug(1, 'group village linked: %d', data.group_id);

        const groupsInclude = localSettings[SETTINGS.GROUP_INCLUDE];
        const groupIgnore = localSettings[SETTINGS.GROUP_IGNORE];
        const groupsOnly = localSettings[SETTINGS.GROUP_ONLY];
        const isOwnVillage = $player.getVillage(data.village_id);
        let farmerListUpdated = false;

        updateGroupVillages();

        if (groupIgnore === data.group_id) {
            if (isOwnVillage) {
                removeFarmer(data.village_id);
                farmerListUpdated = true;
            } else {
                removeTarget(data.village_id);

                addLog(LOG_TYPES.IGNORED_VILLAGE, {
                    villageId: data.village_id
                });
                addExceptionLog(data.village_id);
            }
        }

        if (groupsInclude.includes(data.group_id) && !isOwnVillage) {
            reloadTargets();

            addLog(LOG_TYPES.INCLUDED_VILLAGE, {
                villageId: data.village_id
            });
            addExceptionLog(data.village_id);
        }

        if (groupsOnly.includes(data.group_id) && isOwnVillage) {
            const farmer = createFarmer(data.village_id);
            farmer.init().then(function () {
                if (running) {
                    farmer.start();
                }
            });

            farmerListUpdated = true;
        }

        if (farmerListUpdated) {
            eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_FARMER_VILLAGES_UPDATED);
        }
    };

    const villageGroupUnlink = function (event, data) {
        debug(1, 'group village unlinked: %d', data.group_id);

        const groupsInclude = localSettings[SETTINGS.GROUP_INCLUDE];
        const groupIgnore = localSettings[SETTINGS.GROUP_IGNORE];
        const groupsOnly = localSettings[SETTINGS.GROUP_ONLY];
        const isOwnVillage = $player.getVillage(data.village_id);
        let farmerListUpdated = false;

        updateGroupVillages();

        if (groupIgnore === data.group_id) {
            if (isOwnVillage) {
                const farmer = createFarmer(data.village_id);
                farmer.init().then(function () {
                    if (running) {
                        farmer.start();
                    }
                });

                farmerListUpdated = true;
            } else {
                reloadTargets();

                addLog(LOG_TYPES.IGNORED_VILLAGE_REMOVED, {
                    villageId: data.village_id
                });
            }
        }

        if (groupsInclude.includes(data.group_id) && !isOwnVillage) {
            reloadTargets();

            addLog(LOG_TYPES.INCLUDED_VILLAGE_REMOVED, {
                villageId: data.village_id
            });
        }

        if (groupsOnly.includes(data.group_id) && isOwnVillage) {
            removeFarmer(data.village_id);
            farmerListUpdated = true;
        }

        if (farmerListUpdated) {
            eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_FARMER_VILLAGES_UPDATED);
        }
    };

    const validGroups = function (_flag) {
        const gameGroups = modelDataService.getGroupList().getGroups();
        const groupIgnore = localSettings[SETTINGS.GROUP_IGNORE];

        const groupsOnly = localSettings[SETTINGS.GROUP_ONLY];
        const groupsInclude = localSettings[SETTINGS.GROUP_INCLUDE];
        const validedGroupIgnore = hasOwn.call(gameGroups, groupIgnore) ? groupIgnore : settings.getDefault(SETTINGS.GROUP_IGNORE);
        const validedGroupsOnly = groupsOnly.filter(groupId => hasOwn.call(gameGroups, groupId));
        const validedGroupsInclude = groupsInclude.filter(groupId => hasOwn.call(gameGroups, groupId));

        settings.setAll({
            [SETTINGS.GROUP_IGNORE]: validedGroupIgnore,
            [SETTINGS.GROUP_ONLY]: validedGroupsOnly,
            [SETTINGS.GROUP_INCLUDE]: validedGroupsInclude
        }, _flag);
    };

    const removedGroupListener = function () {
        validGroups();
        updateGroupVillages();

        flushFarmers();
        reloadTargets();
        createFarmers();
    };

    const processPresets = function () {
        selectedPresets = [];
        const playerPresets = modelDataService.getPresetList().getPresets();
        const activePresets = localSettings[SETTINGS.PRESETS];

        activePresets.forEach(function (presetId) {
            if (!hasOwn.call(playerPresets, presetId)) {
                return;
            }

            const preset = {...playerPresets[presetId]};
            preset.load = getPresetHaul(preset);
            preset.travelTime = armyService.calculateTravelTime(preset, {
                barbarian: false,
                officers: false
            });

            selectedPresets.push(preset);
        });

        selectedPresets = selectedPresets.sort(function (a, b) {
            return a.travelTime - b.travelTime || b.load - a.load;
        });

        debug(1, 'selected presets %o', selectedPresets.map(preset => preset.id));
        debug(2, 'selected presets detailed %o', selectedPresets);
    };

    const ignoreVillage = function (villageId) {
        const groupIgnore = localSettings[SETTINGS.GROUP_IGNORE];

        if (!groupIgnore) {
            return false;
        }

        socketService.emit(routeProvider.GROUPS_LINK_VILLAGE, {
            group_id: groupIgnore,
            village_id: villageId
        });

        return true;
    };

    const presetListener = function () {
        processPresets();

        if (!selectedPresets.length && !localSettings[SETTINGS.AUTO_PRESETS]) {
            eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_STOP, {
                reason: ERROR_TYPES.NO_PRESETS
            });

            if (running) {
                farmOverflow.stop();
            }
        }
    };

    const reportListener = function (event, data) {
        if (data.type !== COMMAND_TYPES.TYPES.ATTACK || !isTarget(data.target_village_id)) {
            return;
        }

        const hadLoss = data.result === 2 || data.result === 3;
        const cooldown = hadLoss ? localSettings[SETTINGS.LOSS_COOLDOWN]
            : data.haul === 'none' ? localSettings[SETTINGS.EMPTY_HAUL_COOLDOWN] : 0;

        if (Number.isFinite(cooldown) && cooldown > 0) {
            targetCooldowns[data.target_village_id] = timeHelper.gameTime() + cooldown;
            Lockr.set(cooldownStorageKey, targetCooldowns);
        }

        // 1 = nocasualties
        // 2 = casualties
        // 3 = defeat
        if (hadLoss && localSettings[SETTINGS.IGNORE_ON_LOSS] && localSettings[SETTINGS.GROUP_IGNORE]) {
            tempVillageReports[data.target_village_id] = {
                haul: data.haul,
                id: data.id,
                result: data.result,
                title: data.title
            };

            ignoreVillage(data.target_village_id);
        }
    };

    const commandSentListener = function (event, data) {
        if (!running || !sendingCommand || !activeFarmer || !currentTarget) {
            return;
        }

        if (data.origin.id !== activeFarmer.getId()) {
            return;
        }

        if (data.target.id !== currentTarget.id) {
            return;
        }

        if (data.direction === 'forward' && data.type === COMMAND_TYPES.TYPES.ATTACK) {
            activeFarmer.commandSent(data);
        }
    };

    const commandErrorListener = function (event, data) {
        if (!activeFarmer || !sendingCommand || !currentTarget) {
            return;
        }

        if (data.cause === routeProvider.SEND_PRESET.type) {
            activeFarmer.commandError(data);
        }
    };

    const getPresetHaul = function (preset) {
        let haul = 0;

        utils.each(preset.units, function (unitAmount, unitName) {
            if (unitAmount) {
                haul += unitsData[unitName].load * unitAmount;
            }
        });

        return haul;
    };

    const addExceptionLog = function (villageId) {
        exceptionLogs[villageId] = {
            time: timeHelper.gameTime(),
            report: tempVillageReports[villageId] || false
        };

        delete tempVillageReports[villageId];

        Lockr.set(STORAGE_KEYS.EXCEPTION_LOGS, exceptionLogs);
        eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_EXCEPTION_LOGS_UPDATED);
    };

    const addLog = function (type, data = {}) {
        if (typeof type !== 'string') {
            return false;
        }

        if (!angular.isObject(data)) {
            data = {};
        }

        data.time = timeHelper.gameTime();
        data.type = type;

        logs.unshift(data);
        trimAndSaveLogs();

        return true;
    };

    const trimAndSaveLogs = function () {
        const limit = localSettings[SETTINGS.LOGS_LIMIT];

        if (logs.length > limit) {
            logs.splice(logs.length - limit, logs.length);
        }

        Lockr.set(STORAGE_KEYS.LOGS, logs);
        eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_LOGS_UPDATED);
    };

    const targetIsFree = function (thisFarmerIsAttacking, otherFarmerIsAttacking) {
        const farmerBehavior = localSettings[SETTINGS.FARMER_BEHAVIOR];
        const targetBehavior = localSettings[SETTINGS.TARGET_BEHAVIOR];

        return (!thisFarmerIsAttacking || farmerBehavior === FARMER_BEHAVIOR.ALLOW_MULTIPLE_ATTACK_EACH_TARGET)
            && (!otherFarmerIsAttacking || targetBehavior === TARGET_BEHAVIOR.TARGETS_ALLOW_MULTIPLE_FARMERS);
    };

    const enableRequiredPresets = function (villageId, callback) {
        const villagePresets = modelDataService.getPresetList().getPresetsByVillageId(villageId);
        const missingPresets = [];

        selectedPresets.forEach(function (preset) {
            if (!hasOwn.call(villagePresets, preset.id)) {
                missingPresets.push(preset.id);
            }
        });

        if (missingPresets.length) {
            // include already enabled presets because you can't only enable
            // missing ones, you need to emit all you want enabled.
            for (const id in villagePresets) {
                if (hasOwn.call(villagePresets, id)) {
                    missingPresets.push(id);
                }
            }

            socketService.emit(routeProvider.ASSIGN_PRESETS, {
                village_id: villageId,
                preset_ids: missingPresets
            }, callback);

            return;
        }

        callback();
    };

    const persistentRunningStart = function () {
        const cycleInterval = getCycleInterval();
        const attackInterval = getAttackInterval();
        const timeLimit = cycleInterval + (cycleInterval / 2) + attackInterval
            + localSettings[SETTINGS.CYCLE_JITTER] + localSettings[SETTINGS.ATTACK_JITTER] + STEP_EXPIRE_TIME;

        persistentRunningTimer = setInterval(function () {
            const now = timeHelper.gameTime();

            if (now - persistentRunningLastCheck > timeLimit) {
                farmOverflow.stop(STATUS.EXPIRED_STEP);
            }
        }, PERSISTENT_RUNNING_CHECK_INTERVAL);
    };

    const persistentRunningStop = function () {
        clearInterval(persistentRunningTimer);
    };

    const persistentRunningUpdate = function () {
        persistentRunningLastCheck = timeHelper.gameTime();
    };

    const stopTimers = function () {
        clearTimeout(cycleTimer);
        clearTimeout(stepDelayTimer);
        clearTimeout(commandExpireTimer);

        cycleTimer = null;
        stepDelayTimer = null;
        commandExpireTimer = null;
    };

    const getCycleInterval = function () {
        return Math.max(MINIMUM_FARMER_CYCLE_INTERVAL, localSettings[SETTINGS.FARMER_CYCLE_INTERVAL]);
    };

    const getAttackInterval = function () {
        return Math.max(MINIMUM_ATTACK_INTERVAL, localSettings[SETTINGS.ATTACK_INTERVAL]);
    };

    const getPresetChoice = function (farmer, target) {
        const distance = math.actualDistance(farmer.village.getPosition(), target);
        const generated = policy.isBarbarian(target) ? farmer.generatedPresets || [] : [];
        return policy.choosePreset(selectedPresets.concat(generated), farmer.village.getUnitInfo().getUnits(), unitsData, function (preset) {
            const fieldTime = armyService.calculateTravelTime(preset, {
                barbarian: policy.isBarbarian(target),
                officers: true,
                effects: true
            });
            return armyService.getTravelTimeForDistance(preset, fieldTime, distance, COMMAND_TYPES.TYPES.ATTACK);
        }, {
            optimize: localSettings[SETTINGS.OPTIMIZE_HAUL],
            reservePercent: localSettings[SETTINGS.UNIT_RESERVE_PERCENT],
            expectedLoot: localSettings[SETTINGS.ESTIMATED_TARGET_LOOT],
            maxTravelMs: localSettings[SETTINGS.MAX_TRAVEL_TIME]
        });
    };

    const storageIsFull = function (village) {
        resourceService.updateMaxStorage(village);
        const resources = village.getResources();
        const computed = resources.getComputed();
        const maximum = resources.getMaxStorage();
        return RESOURCES.every(type => computed[type].currentStock >= maximum);
    };

    function incomingCommandsFilter (command) {
        const type = command.type || command.data.type;
        return command.startCharacterId === $player.getId() && command.data.direction === 'forward'
            && (!type || type === COMMAND_TYPES.TYPES.ATTACK);
    }

    const Farmer = function (villageId) {
        this.villageId = villageId;
        this.village = $player.getVillage(villageId);

        if (!this.village) {
            throw new Error(`new Farmer -> Village ${villageId} doesn't exist.`);
        }

        this.index = 0;
        this.running = false;
        this.initialized = false;
        this.targets = false;
        this.onCycleEndFn = noop;
        this.status = STATUS.WAITING_CYCLE;
        this.stepVersion = 0;
        this.attacksThisCycle = 0;
        this.generatedPresets = [];
    };

    Farmer.prototype.init = function () {
        const loadPromises = [];

        if (!this.isInitialized()) {
            loadPromises.push(new Promise((resolve) => {
                if (this.isInitialized()) {
                    return resolve();
                }

                villageService.ensureVillageDataLoaded(this.villageId, resolve);
            }));

            loadPromises.push(new Promise((resolve) => {
                if (this.isInitialized()) {
                    return resolve();
                }

                this.loadTargets(() => {
                    eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_INSTANCE_READY, {
                        villageId: this.villageId
                    });
                    resolve();
                });
            }));
        }

        return Promise.all(loadPromises).then(() => {
            this.initialized = true;
        });
    };

    Farmer.prototype.start = function () {
        persistentRunningUpdate();

        if (!running || this.running) {
            return false;
        }

        if (!this.initialized) {
            eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_INSTANCE_ERROR_NOT_READY, {
                villageId: this.villageId
            });
            return false;
        }

        if (!this.targets.length) {
            eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_INSTANCE_ERROR_NO_TARGETS, {
                villageId: this.villageId
            });
            return false;
        }

        activeFarmer = this;
        this.running = true;
        this.index = 0;
        this.attacksThisCycle = 0;
        this.generatedPresets = this.buildAutoPresets();
        this.targets = policy.orderTargets(this.targets, target => {
            const choice = getPresetChoice(this, target);
            return choice.score || 1 / Math.max(1, target.distance);
        }, localSettings[SETTINGS.TARGET_ORDER_VARIATION]);
        eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_INSTANCE_START, {
            villageId: this.villageId
        });

        this.targetStep({delay: false});
        return true;
    };

    Farmer.prototype.buildAutoPresets = function () {
        return localSettings[SETTINGS.AUTO_PRESETS] ? autoPresets(this.villageId, this.targets || [], this.village.getUnitInfo().getUnits(), unitsData, {
            unitNames: localSettings[SETTINGS.AUTO_PRESET_UNITS],
            minimum: localSettings[SETTINGS.AUTO_PRESET_MIN_UNITS],
            maximum: localSettings[SETTINGS.AUTO_PRESET_MAX_UNITS],
            carry: localSettings[SETTINGS.AUTO_PRESET_CARRY],
            reservePercent: localSettings[SETTINGS.UNIT_RESERVE_PERCENT],
            attackLimit: localSettings[SETTINGS.MAX_ATTACKS_PER_CYCLE],
            commandSlots: Math.max(1, VILLAGE_COMMAND_LIMIT - localSettings[SETTINGS.PRESERVE_COMMAND_SLOTS]
                    - this.village.getCommandListModel().getOutgoingCommands(true, true).length)
        }) : [];
    };

    Farmer.prototype.stop = function (reason) {
        this.running = false;
        this.stepVersion++;

        debug(1, 'stop farmer village %d', this.villageId);

        eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_INSTANCE_STOP, {
            villageId: this.villageId,
            reason: reason
        });

        if (reason === ERROR_TYPES.USER_STOP) {
            this.setStatus(STATUS.USER_STOP);
        } else if (reason) {
            this.setStatus(reason);
        }

        stopTimers();

        this.onCycleEndFn(reason);
        this.onCycleEndFn = noop;
    };

    function stepFactory (id, handler) {
        return function () {
            const promise = new Promise(function (resolve, reject) {
                handler(resolve, reject);
            });

            const stepStart = Date.now();

            promise.catch(noop).finally(function () {
                const stepEnd = Date.now();
                const elapsedTime = stepEnd - stepStart;
                debug(3, '%s took %d', id, elapsedTime);
            });

            return promise;
        };
    }

    Farmer.prototype.targetStep = async function (options = {}) {
        if (!running || !this.running) {
            return false;
        }

        const stepVersion = ++this.stepVersion;
        const isActive = () => running && this.running && activeFarmer === this && stepVersion === this.stepVersion;
        const attackDelay = options.delay
            ? policy.boundedDelay(getAttackInterval(), localSettings[SETTINGS.ATTACK_JITTER], MINIMUM_ATTACK_INTERVAL) : 0;

        debug(1, 'start target step %d', this.villageId);

        persistentRunningUpdate();

        let selectedPreset = false;
        let selectedChoice;
        let target;
        let incomingAttacks = [];
        let checkedLocalCommands = false;
        let otherFarmerIsAttacking;
        let thisFarmerIsAttacking;

        const delayStep = stepFactory('delayStep', (resolve, reject) => {
            if (options.delay) {
                stepDelayTimer = setTimeout(() => {
                    stepDelayTimer = null;

                    if (!isActive()) {
                        return reject(STATUS.USER_STOP);
                    }

                    resolve();
                }, attackDelay);
            } else {
                resolve();
            }
        });

        const checkCommandLimit = stepFactory('checkCommandLimit', (resolve, reject) => {
            const villageCommands = this.village.getCommandListModel().getOutgoingCommands(true, true);
            const limit = VILLAGE_COMMAND_LIMIT - localSettings[SETTINGS.PRESERVE_COMMAND_SLOTS];

            if (this.attacksThisCycle >= localSettings[SETTINGS.MAX_ATTACKS_PER_CYCLE]) {
                reject(STATUS.CYCLE_ATTACK_LIMIT);
            } else if (villageCommands.length >= limit) {
                reject(STATUS.COMMAND_LIMIT);
            } else {
                resolve();
            }
        });

        const checkStorage = stepFactory('checkStorage', (resolve, reject) => {
            if (localSettings[SETTINGS.IGNORE_FULL_STORAGE] && storageIsFull(this.village)) {
                return reject(STATUS.FULL_STORAGE);
            }

            resolve();
        });

        const selectTarget = stepFactory('selectTarget', (resolve, reject) => {
            if (!this.targets.length) {
                return reject(STATUS.NO_TARGETS);
            }

            if (this.index > this.targets.length || !this.targets[this.index]) {
                return reject(STATUS.TARGET_CYCLE_END);
            }

            target = this.targets[this.index];

            resolve();
        });

        const checkTarget = stepFactory('checkTarget', (resolve, reject) => {
            if (targetCooldowns[target.id] > timeHelper.gameTime()) {
                return reject(STATUS.TARGET_COOLDOWN);
            }

            const checkTargetHandler = (data) => {
                if (!isActive()) {
                    reject(STATUS.USER_STOP);
                } else if (!data || data.id !== target.id || !Number.isFinite(data.points)) {
                    reject(STATUS.COMMAND_ERROR);
                } else if (villageFilters.points(data.points)) {
                    return reject(STATUS.NOT_ALLOWED_POINTS);
                } else if (villageFilters.barbarian(data) || villageFilters.ownPlayer(data)
                    || villageFilters.included(data) || villageFilters.ignored(data)) {
                    reject(STATUS.ABANDONED_CONQUERED);
                } else if (data.attack_protection) {
                    reject(STATUS.PROTECTED_VILLAGE);
                } else {
                    target = {...target, ...data};
                    resolve();
                }
            };

            const data = $mapData.getTownAt(target.x, target.y);

            if (data) {
                checkTargetHandler(data);
            } else {
                $mapData.getTownAtAsync(target.x, target.y, checkTargetHandler);
            }
        });

        const checkPresets = stepFactory('checkPresets', (resolve, reject) => {
            if (localSettings[SETTINGS.PREVIEW_ONLY]) {
                return resolve();
            }

            enableRequiredPresets(this.villageId, () => {
                if (isActive()) {
                    resolve();
                } else {
                    reject(STATUS.USER_STOP);
                }
            });
        });

        const selectPreset = stepFactory('selectPreset', (resolve, reject) => {
            selectedChoice = getPresetChoice(this, target);

            if (!selectedChoice.preset) {
                return reject(selectedChoice.reason === 'time_limit' ? STATUS.TIME_LIMIT : STATUS.NO_UNITS);
            }

            selectedPreset = selectedChoice.preset;
            resolve();
        });

        const checkLocalCommands = stepFactory('checkLocalCommands', (resolve, reject) => {
            const characterVillages = Object.values(modelDataService.getVillages());
            const allOwnCommandsReady = characterVillages.every(village => village.readyState[VILLAGE_CONFIG.READY_STATES.OWN_COMMANDS]);

            if (allOwnCommandsReady) {
                checkedLocalCommands = true;

                const x = villageInfoService.getCommands(target.id);
                const incomingCommands = x.filter(incomingCommandsFilter);
                incomingAttacks = incomingCommands;

                otherFarmerIsAttacking = incomingCommands.some((command) => command.startVillageId !== this.villageId);
                thisFarmerIsAttacking = incomingCommands.some((command) => command.startVillageId === this.villageId);

                if (!targetIsFree(thisFarmerIsAttacking, otherFarmerIsAttacking)) {
                    return reject(STATUS.BUSY_TARGET);
                }
            }

            resolve();
        });

        const checkLoadedCommands = stepFactory('checkLoadedCommands', (resolve, reject) => {
            if (checkedLocalCommands) {
                return resolve();
            }

            socketService.emit(routeProvider.MAP_GET_VILLAGE_DETAILS, {
                my_village_id: this.villageId,
                village_id: target.id,
                num_reports: 0
            }, (data) => {
                if (!isActive()) {
                    return reject(STATUS.USER_STOP);
                }

                if (!data || !data.commands || !Array.isArray(data.commands.own)) {
                    return reject(STATUS.COMMAND_ERROR);
                }

                incomingAttacks = data.commands.own.filter((command) => command.type === COMMAND_TYPES.TYPES.ATTACK && command.direction === 'forward');
                otherFarmerIsAttacking = incomingAttacks.some((command) => command.start_village_id !== this.villageId);
                thisFarmerIsAttacking = incomingAttacks.some((command) => command.start_village_id === this.villageId);

                if (!targetIsFree(thisFarmerIsAttacking, otherFarmerIsAttacking)) {
                    debug(2, 'rejected by checkLoadedCommands');
                    return reject(STATUS.BUSY_TARGET);
                }

                resolve();
            });
        });

        const minimumInterval = stepFactory('minimumInterval', (resolve, reject) => {
            if (!thisFarmerIsAttacking && !otherFarmerIsAttacking) {
                return resolve();
            }

            const arrival = timeHelper.gameTime() / 1000 + selectedChoice.travelSeconds;
            const attackCollision = policy.arrivalIsBusy(arrival, incomingAttacks, localSettings[SETTINGS.MULTIPLE_ATTACKS_INTERVAL]);

            if (attackCollision) {
                debug(2, 'rejected by minimumInterval');
                return reject(STATUS.BUSY_TARGET);
            }

            resolve();
        });

        const prepareAttack = () => {
            if (!isActive()) {
                return false;
            }

            // Recheck mutable state immediately before issuing a command.
            const latest = $mapData.getTownAt(target.x, target.y);

            if (!latest || latest.id !== target.id || villageFilters.barbarian(latest)
                || villageFilters.ownPlayer(latest) || villageFilters.included(latest) || villageFilters.ignored(latest)) {
                throw STATUS.ABANDONED_CONQUERED;
            }

            if (latest.attack_protection) {
                throw STATUS.PROTECTED_VILLAGE;
            }

            if (!Number.isFinite(latest.points) || villageFilters.points(latest.points)) {
                throw STATUS.NOT_ALLOWED_POINTS;
            }

            if (targetCooldowns[target.id] > timeHelper.gameTime()) {
                throw STATUS.TARGET_COOLDOWN;
            }

            selectedChoice = getPresetChoice(this, {...target, ...latest});

            if (!selectedChoice.preset || selectedChoice.preset.id !== selectedPreset.id) {
                throw STATUS.NO_UNITS;
            }

            const commands = this.village.getCommandListModel().getOutgoingCommands(true, true);

            if (commands.length >= VILLAGE_COMMAND_LIMIT - localSettings[SETTINGS.PRESERVE_COMMAND_SLOTS]) {
                throw STATUS.COMMAND_LIMIT;
            }

            if (localSettings[SETTINGS.IGNORE_FULL_STORAGE] && storageIsFull(this.village)) {
                throw STATUS.FULL_STORAGE;
            }

            if (policy.arrivalIsBusy(timeHelper.gameTime() / 1000 + selectedChoice.travelSeconds,
                incomingAttacks,
                localSettings[SETTINGS.MULTIPLE_ATTACKS_INTERVAL])) {
                throw STATUS.BUSY_TARGET;
            }

            clearTimeout(commandExpireTimer);
            commandExpireTimer = null;
            this.index++;
            this.attacksThisCycle++;

            if (localSettings[SETTINGS.PREVIEW_ONLY]) {
                this.setStatus(STATUS.PREVIEW);
                addLog(LOG_TYPES.PLANNED_VILLAGE, {
                    targetId: target.id,
                    originId: this.villageId,
                    presetId: selectedPreset.id,
                    units: {...selectedPreset.units},
                    capacity: selectedChoice.haul,
                    travelSeconds: selectedChoice.travelSeconds,
                    ratePerHour: Math.round(selectedChoice.score * 3600),
                    usingLootEstimate: localSettings[SETTINGS.ESTIMATED_TARGET_LOOT] > 0
                });
                this.targetStep({delay: true});
                return;
            }

            this.setStatus(STATUS.ATTACKING);

            sendingCommand = true;
            currentTarget = target;

            debug(2, 'sending attack to %d from %d', target.id, this.villageId);

            commandExpireTimer = setTimeout(() => {
                if (isActive() && sendingCommand) {
                    // An unacknowledged send must not be retried automatically.
                    farmOverflow.stop(STATUS.COMMAND_TIMEOUT);
                }
            }, STEP_EXPIRE_TIME);

            if (selectedPreset.generated) {
                if (!routeProvider.SEND_CUSTOM_ARMY) {
                    farmOverflow.stop(STATUS.COMMAND_ERROR);
                    return;
                }
                socketService.emit(routeProvider.SEND_CUSTOM_ARMY, {
                    start_village: this.villageId,
                    target_village: target.id,
                    units: selectedPreset.units,
                    officers: {},
                    icon: 0,
                    catapult_target: false,
                    type: COMMAND_TYPES.TYPES.ATTACK
                });
                return;
            }
            socketService.emit(routeProvider.SEND_PRESET, {
                start_village: this.villageId,
                target_village: target.id,
                army_preset_id: selectedPreset.id,
                type: COMMAND_TYPES.TYPES.ATTACK
            });
        };

        const stepStatus = (status) => {
            if (!isActive()) {
                return;
            }

            stopTimers();

            debug(1, 'target step finished "%s"', status);

            eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_INSTANCE_STEP_STATUS, {
                villageId: this.villageId,
                error: status
            });

            switch (status) {
                case STATUS.TIME_LIMIT:
                case STATUS.BUSY_TARGET:
                case STATUS.ABANDONED_CONQUERED:
                case STATUS.PROTECTED_VILLAGE: {
                    this.index++;
                    this.setStatus(status);
                    this.targetStep(options);
                    break;
                }
                case STATUS.TARGET_COOLDOWN: {
                    this.index++;
                    this.setStatus(status);
                    this.targetStep(options);
                    break;
                }
                case STATUS.USER_STOP: {
                    this.setStatus(status);
                    break;
                }
                case STATUS.NOT_ALLOWED_POINTS: {
                    this.index++;
                    this.setStatus(status);
                    removeTarget(target.id);
                    this.targetStep(options);
                    break;
                }
                case STATUS.NO_UNITS:
                case STATUS.NO_TARGETS:
                case STATUS.FULL_STORAGE:
                case STATUS.COMMAND_LIMIT: {
                    this.index++;
                    this.setStatus(status);
                    this.stop(status);
                    break;
                }
                case STATUS.CYCLE_ATTACK_LIMIT: {
                    this.index = 0;
                    this.setStatus(status);
                    this.stop(status);
                    break;
                }
                case STATUS.TARGET_CYCLE_END: {
                    this.index = 0;
                    this.setStatus(status);
                    this.stop(status);
                    break;
                }
                case STATUS.EXPIRED_STEP: {
                    this.index++;
                    this.setStatus(status);
                    this.targetStep({delay: true});
                    break;
                }
                default: {
                    this.index++;
                    this.setStatus(STATUS.UNKNOWN);
                    this.stop(STATUS.UNKNOWN);
                    break;
                }
            }
        };

        const activeStep = (step) => () => {
            if (!isActive()) {
                throw STATUS.USER_STOP;
            }

            return step();
        };

        const attackPromise = new Promise((resolve, reject) => {
            delayStep()
                .then(activeStep(checkCommandLimit))
                .then(activeStep(checkStorage))
                .then(activeStep(selectTarget))
                .then(activeStep(checkTarget))
                .then(activeStep(checkPresets))
                .then(activeStep(selectPreset))
                .then(activeStep(checkLocalCommands))
                .then(activeStep(checkLoadedCommands))
                .then(activeStep(minimumInterval))
                .then(resolve)
                .catch(reject);
        });

        const expirePromise = new Promise((resolve, reject) => {    
            commandExpireTimer = setTimeout(() => {
                if (isActive()) {
                    reject(STATUS.EXPIRED_STEP);
                }
            }, STEP_EXPIRE_TIME + attackDelay);
        });

        Promise.race([
            attackPromise,
            expirePromise
        ])
            .then(prepareAttack)
            .catch(stepStatus);
    };

    Farmer.prototype.setStatus = function (newStatus) {
        this.status = newStatus;
    };

    Farmer.prototype.getStatus = function () {
        return this.status || STATUS.UNKNOWN;
    };

    Farmer.prototype.commandSent = function (data) {
        sendingCommand = false;
        currentTarget = false;

        stopTimers();

        addLog(LOG_TYPES.ATTACKED_VILLAGE, {
            targetId: data.target.id
        });

        this.targetStep({
            delay: true
        });
    };

    Farmer.prototype.commandError = function () {
        sendingCommand = false;
        currentTarget = false;

        this.stop(STATUS.COMMAND_ERROR);
    };

    Farmer.prototype.onCycleEnd = function (handler) {
        this.onCycleEndFn = handler;
    };

    Farmer.prototype.loadTargets = function (callback) {
        const pos = this.village.getPosition();

        twoMapData.load((loadedTargets) => {
            this.targets = calcDistances(loadedTargets, pos);
            this.targets = filterTargets(this.targets, pos);
            this.targets = sortTargets(this.targets);
            this.targets = this.targets.slice(0, localSettings[SETTINGS.TARGET_LIMIT]);

            if (typeof callback === 'function') {
                callback(this.targets);
            }

            debug(2, 'village %d targets %o', this.villageId, this.targets.map(village => village.id));
            debug(3, 'village %d detailed targets %o', this.villageId, this.targets);

            // make sure villages area are pre-loaded
            for (const target of this.targets) {
                $mapData.loadTownData(target.x, target.y, 1, 1);
            }
        });
    };

    Farmer.prototype.getTargets = function () {
        return this.targets;
    };

    Farmer.prototype.getIndex = function () {
        return this.index;
    };

    Farmer.prototype.getVillage = function () {
        return this.village;
    };

    Farmer.prototype.isRunning = function () {
        return this.running;
    };

    Farmer.prototype.isInitialized = function () {
        return this.initialized;
    };

    Farmer.prototype.removeTarget = function (targetId) {
        if (typeof targetId !== 'number' || !this.targets) {
            return false;
        }

        const removedBeforeIndex = this.targets.slice(0, this.index).filter(target => target.id === targetId).length;
        this.targets = this.targets.filter(function (target) {
            return target.id !== targetId;
        });
        this.index = Math.max(0, this.index - removedBeforeIndex);

        return true;
    };

    Farmer.prototype.getId = function () {
        return this.villageId;
    };

    const createFarmer = function (villageId) {
        const groupsOnly = localSettings[SETTINGS.GROUP_ONLY];

        villageId = parseInt(villageId, 10);

        if (groupsOnly.length && !onlyVillages.includes(villageId)) {
            return false;
        }

        if (ignoredVillages.includes(villageId)) {
            return false;
        }

        let farmer = farmOverflow.getFarmer(villageId);

        if (!farmer) {
            farmer = new Farmer(villageId);
            farmers.push(farmer);
        }

        return farmer;
    };

    const createFarmers = function () {
        utils.each($player.getVillages(), function (village, villageId) {
            createFarmer(villageId);
        });

        eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_FARMER_VILLAGES_UPDATED);
    };

    /**
     * Clean farmer instances by removing villages based on
     * groups-only, only-villages and ignore-villages group filters.
     */
    const flushFarmers = function () {
        const groupsOnly = localSettings[SETTINGS.GROUP_ONLY];
        const removeIds = [];

        farmers.forEach(function (farmer) {
            const villageId = farmer.getId();

            if (groupsOnly.length && !onlyVillages.includes(villageId)) {
                removeIds.push(villageId);
            } else if (ignoredVillages.includes(villageId)) {
                removeIds.push(villageId);
            }
        });

        if (removeIds.length) {
            removeIds.forEach(function (removeId) {
                removeFarmer(removeId);
            });

            eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_FARMER_VILLAGES_UPDATED);
        }
    };

    const removeFarmer = function (farmerId) {
        for (let i = 0; i < farmers.length; i++) {
            if (farmers[i].getId() === farmerId) {
                farmers[i].stop(ERROR_TYPES.KILL_FARMER);
                farmers.splice(i, i + 1);

                return true;
            }
        }

        return false;
    };

    const farmerStep = function (status) {
        if (!running) {
            return;
        }

        persistentRunningUpdate();

        if (!farmers.length) {
            debug(1, 'farmerStep: no active farmers');
            activeFarmer = false;
        } else if (farmerIndex >= farmers.length) {
            debug(1, 'farmerStep: cycle end');
            farmerIndex = 0;
            activeFarmer = false;
        } else {
            activeFarmer = farmers[farmerIndex];
        }

        if (activeFarmer) {
            activeFarmer.onCycleEnd(function (reason) {
                if (running && reason !== ERROR_TYPES.USER_STOP) {
                    debug(1, 'farmerStep: farmer finished, select next farmer');
                    farmerIndex++;
                    farmerStep();
                }
            });

            if (status === CYCLE_BEGIN) {
                debug(1, 'farmerStep: cycle start');
                nextCycleDate = null;
                eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_CYCLE_BEGIN);
            }

            if (!activeFarmer.start()) {
                farmerIndex++;
                farmerStep();
            }
        } else {
            const cycleDelay = policy.boundedDelay(getCycleInterval(), localSettings[SETTINGS.CYCLE_JITTER], MINIMUM_FARMER_CYCLE_INTERVAL);
            nextCycleDate = timeHelper.gameTime() + cycleDelay;
            eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_CYCLE_END);

            cycleTimer = setTimeout(function () {
                cycleTimer = null;
                farmerIndex = 0;
                nextCycleDate = null;
                eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_CYCLE_BEGIN);
                farmerStep();
            }, cycleDelay);
        }
    };

    const isTarget = function (targetId) {
        for (let i = 0; i < farmers.length; i++) {
            const farmer = farmers[i];
            const targets = farmer.getTargets() || [];

            for (let j = 0; j < targets.length; j++) {
                const target = targets[j];

                if (target.id === targetId) {
                    return true;
                }
            }
        }

        return false;
    };

    const removeTarget = function (targetId) {
        farmers.forEach(function (farmer) {
            farmer.removeTarget(targetId);
        });
    };

    const reloadTargets = function () {
        twoMapData.load(function () {
            farmers.forEach(function (farmer) {
                farmer.loadTargets();
            });
        }, true);
    };

    const farmOverflow = {};

    farmOverflow.previewAutoPresets = function () {
        return Promise.all(farmers.map(farmer => new Promise(resolve => {
            villageService.ensureVillageDataLoaded(farmer.villageId, () => farmer.loadTargets(() => {
                resolve(farmer.buildAutoPresets().map(preset => ({
                    villageId: farmer.villageId,
                    name: preset.name,
                    units: preset.units,
                    nearbyTargets: preset.nearbyTargets,
                    capacity: getPresetHaul(preset)
                })));
            }));
        }))).then(plans => [].concat(...plans));
    };

    farmOverflow.init = function () {
        debug(1, 'initialized');

        initialized = true;
        logs = Lockr.get(STORAGE_KEYS.LOGS, []);
        exceptionLogs = Lockr.get(STORAGE_KEYS.EXCEPTION_LOGS, {});
        $player = modelDataService.getSelectedCharacter();
        unitsData = modelDataService.getGameData().getUnitsObject();
        cooldownStorageKey = `farm_overflow_cooldowns_${$player.getWorldId()}_${$player.getId()}`;
        targetCooldowns = Lockr.get(cooldownStorageKey, {});

        for (const [id, until] of Object.entries(targetCooldowns)) {
            if (!Number.isFinite(until) || until <= timeHelper.gameTime()) {
                delete targetCooldowns[id];
            }
        }

        settings = new Settings({
            settingsMap: SETTINGS_MAP,
            storageKey: STORAGE_KEYS.SETTINGS
        });

        // Earlier versions stored the target-count text input without parsing it.
        const legacyTargetLimit = settings.getRaw(SETTINGS.TARGET_LIMIT);

        if (typeof legacyTargetLimit === 'string' && legacyTargetLimit.trim() !== ''
            && Number.isInteger(Number(legacyTargetLimit))) {
            settings.set(SETTINGS.TARGET_LIMIT, Number(legacyTargetLimit));
        }

        settings.onChange(function (changes, updates, _flag) {
            debug(1, 'settings changes: %o updates: %o', changes, updates);

            localSettings = settings.getAll();

            if (_flag === IGNORE_UPDATES) {
                return;
            }

            if (running) {
                farmOverflow.stop();
            }

            if (updates[UPDATES.PRESET]) {
                processPresets();
            }

            if (updates[UPDATES.GROUPS]) {
                updateGroupVillages();
            }

            if (updates[UPDATES.TARGETS]) {
                reloadTargets();
            }

            if (updates[UPDATES.VILLAGES]) {
                flushFarmers();
                createFarmers();
            }

            if (updates[UPDATES.LOGS]) {
                trimAndSaveLogs();
            }

            if (updates[UPDATES.INTERVAL_TIMERS]) {
                reloadTimers();
            }
        });

        localSettings = settings.getAll();
        debug(1, 'settings %O', localSettings);

        validGroups(IGNORE_UPDATES);
        updateGroupVillages();
        createFarmers();

        ready(function () {
            processPresets();
        }, 'presets');

        ready(function () {
            farmers.forEach(function (farmer) {
                farmer.loadTargets();
            });
        }, 'minimap_data');

        $rootScope.$on(eventTypeProvider.ARMY_PRESET_UPDATE, presetListener);
        $rootScope.$on(eventTypeProvider.ARMY_PRESET_DELETED, presetListener);
        $rootScope.$on(eventTypeProvider.GROUPS_VILLAGE_LINKED, villageGroupLink);
        $rootScope.$on(eventTypeProvider.GROUPS_VILLAGE_UNLINKED, villageGroupUnlink);
        $rootScope.$on(eventTypeProvider.GROUPS_DESTROYED, removedGroupListener);
        $rootScope.$on(eventTypeProvider.COMMAND_SENT, commandSentListener);
        $rootScope.$on(eventTypeProvider.MESSAGE_ERROR, commandErrorListener);
        $rootScope.$on(eventTypeProvider.REPORT_NEW, reportListener);
    };

    farmOverflow.start = function () {
        if (running) {
            debug(1, 'start: fail "%s"', ERROR_TYPES.ALREADY_RUNNING);
            return false;
        }

        const validSettings = Object.entries(SETTINGS_MAP).every(([id, map]) => {
            const value = localSettings[id];

            if (map.inputType === 'readable_time') {
                return Number.isFinite(value) && value >= 0 && value <= 7 * 24 * 60 * 60 * 1000;
            }

            if (map.inputType === 'number') {
                return Number.isInteger(value) && value >= map.min && value <= map.max;
            }

            if (map.inputType === 'checkbox') {
                return typeof value === 'boolean';
            }

            return true;
        });

        if (!validSettings || localSettings[SETTINGS.MAX_TRAVEL_TIME] <= 0
            || localSettings[SETTINGS.MIN_DISTANCE] > localSettings[SETTINGS.MAX_DISTANCE]
            || localSettings[SETTINGS.MIN_POINTS] > localSettings[SETTINGS.MAX_POINTS]
            || localSettings[SETTINGS.AUTO_PRESET_MIN_UNITS] > localSettings[SETTINGS.AUTO_PRESET_MAX_UNITS]
            || (localSettings[SETTINGS.AUTO_PRESETS] && (!Array.isArray(localSettings[SETTINGS.AUTO_PRESET_UNITS])
                || !localSettings[SETTINGS.AUTO_PRESET_UNITS].length
                || localSettings[SETTINGS.AUTO_PRESET_UNITS].some(name => !unitsData[name])))) {
            utils.notif('error', $filter('i18n')('invalid_farming_settings', $rootScope.loc.ale, 'farm_overflow'));
            return false;
        }

        if (!selectedPresets.length && !localSettings[SETTINGS.AUTO_PRESETS]) {
            debug(1, 'start: fail "%s"', ERROR_TYPES.NO_SELECTED_PRESET);

            eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_STOP, {
                reason: ERROR_TYPES.NO_PRESETS
            });

            return false;
        }

        running = true;
        const startedRun = ++runVersion;

        const readyFarmers = [];

        farmers.forEach(function (farmer) {
            readyFarmers.push(farmer.init());
        });

        if (!readyFarmers.length) {
            debug(1, 'start: fail "%s"', ERROR_TYPES.NO_PRESETS);
            running = false;
            return false;
        }

        Promise.all(readyFarmers).then(function () {
            if (!running || runVersion !== startedRun) {
                return;
            }

            debug(1, 'start: all farmers ready');
            farmerStep(CYCLE_BEGIN);
        }).catch(function () {
            if (running && runVersion === startedRun) {
                farmOverflow.stop(STATUS.UNKNOWN);
            }
        });

        persistentRunningUpdate();
        persistentRunningStart();

        eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_START);
        debug(1, 'start: success');

        addLog(LOG_TYPES.FARM_START);
    };

    farmOverflow.stop = function (reason = STATUS.USER_STOP) {
        running = false;
        runVersion++;
        sendingCommand = false;
        currentTarget = false;

        if (activeFarmer) {
            activeFarmer.stop(reason);

            eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_CYCLE_END, reason);
        }

        nextCycleDate = null;

        stopTimers();

        eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_STOP, {
            reason: reason
        });

        persistentRunningStop();

        if (reason === STATUS.USER_STOP) {
            addLog(LOG_TYPES.FARM_STOP);
        }
    };

    farmOverflow.getFarmer = function (farmerId) {
        return farmers.find(function (farmer) {
            return farmer.getId() === farmerId;
        });
    };

    farmOverflow.getFarmers = function () {
        return farmers;
    };

    farmOverflow.getSettings = function () {
        return settings;
    };

    farmOverflow.getExceptionVillages = function () {
        return {
            included: includedVillages,
            ignored: ignoredVillages
        };
    };

    farmOverflow.getExceptionLogs = function () {
        return exceptionLogs;
    };

    farmOverflow.isInitialized = function () {
        return initialized;
    };

    farmOverflow.isRunning = function () {
        return running;
    };

    farmOverflow.getLogs = function () {
        return logs;
    };

    farmOverflow.clearLogs = function () {
        logs = [];
        Lockr.set(STORAGE_KEYS.LOGS, logs);
        eventQueue.trigger(eventTypeProvider.FARM_OVERFLOW_LOGS_UPDATED);

        return logs;
    };

    farmOverflow.getNextCycleDate = function () {
        return nextCycleDate;
    };

    farmOverflow.getCycleInterval = getCycleInterval;

    return farmOverflow;
});
