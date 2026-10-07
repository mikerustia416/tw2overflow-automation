// Pure scheduling policy; the adapter below supplies game data in seconds.
define('two/builderQueue/planner', [], function () {
    const RESOURCES = ['wood', 'clay', 'iron'];
    const number = value => Number.isFinite(Number(value)) && value !== null && value !== '' ? Number(value) : NaN;
    const bounded = (value, fallback, min, max) => Math.min(max, Math.max(min, Number.isFinite(number(value)) ? number(value) : fallback));
    const affordable = (snapshot, building) => RESOURCES.every(type => {
        const stock = number(snapshot.stock[type]);
        const cost = number(building.cost[type]);
        return Number.isFinite(stock) && Number.isFinite(cost) && cost >= 0 && stock - (snapshot.reserves[type] || 0) >= cost;
    }) && (number(building.cost.food || 0) === 0 || number(snapshot.foodFree) >= number(building.cost.food));

    const waitFor = function (snapshot, building, spent = {}) {
        let wait = 0;
        for (const type of RESOURCES) {
            const cost = number(building.cost[type]);
            const stock = number(snapshot.stock[type]);
            if (!Number.isFinite(cost) || !Number.isFinite(stock)) {
                return NaN;
            }
            const deficit = cost + (snapshot.reserves[type] || 0) + (Number(spent[type]) || 0) - stock;
            if (deficit > 0) {
                if (number(snapshot.capacity) < cost + (snapshot.reserves[type] || 0)) {
                    return Infinity;
                }
                const rate = number(snapshot.production[type]);
                if (!Number.isFinite(rate) || rate < 0) {
                    return NaN;
                }
                if (rate === 0) {
                    return Infinity;
                }
                wait = Math.max(wait, deficit / rate);
            }
        }
        return wait;
    };

    const plan = function (snapshot, options = {}) {
        const counts = {};
        const limits = {};
        let main;
        const pending = [];
        for (const name of snapshot.sequence || []) {
            limits[name] = (limits[name] || 0) + 1;
            counts[name] = (counts[name] || 0) + 1;
            const building = snapshot.buildings[name];
            if (!building) {
                return {building: null, main: name, reason: 'Waiting for missing sequence building data.'};
            }
            if (counts[name] > building.level + (building.queued || 0)) {
                if (!main) {
                    main = name;
                }
                if (!pending.includes(name)) {
                    pending.push(name);
                }
            }
        }
        if (!main) {
            return {building: null, main: null, reason: 'Sequence targets reached or already queued.'};
        }
        const official = snapshot.buildings[main];
        const result = {building: null, main, mainLevel: official.level + (official.queued || 0) + 1,
            waitSeconds: waitFor(snapshot, official), detour: false};
        const feasible = name => snapshot.buildings[name] && snapshot.buildings[name].allowed
            && affordable(snapshot, snapshot.buildings[name]);
        const mainPossible = feasible(main);
        if (!options.dynamic) {
            if (mainPossible) {
                return {...result, building: main, reason: 'Next sequence upgrade is ready.'};
            }
            const farm = snapshot.types.farm;
            if (official.foodBlocked && options.prioritizeFarm && pending.includes(farm) && feasible(farm)) {
                return {...result, building: farm, detour: true, reason: 'Farm resolves the sequence population blocker.'};
            }
            return {...result, reason: 'Waiting for the next sequence upgrade.'};
        }

        const maxDelay = bounded(options.maxDelayMinutes, 15, 0, 1440) * 60;
        const waitThreshold = bounded(options.waitMinutes, 30, 1, 1440) * 60;
        const maxResourceLevel = bounded(options.resourceLevelLimit, 15, 0, 30);
        const maxResourceDetours = bounded(options.resourceDetourLimit, 2, 0, 10);
        const farm = snapshot.types.farm;
        const warehouse = snapshot.types.warehouse;
        const storageBlocked = RESOURCES.some(type => number(snapshot.capacity) > 0
            && number(official.cost[type]) + (snapshot.reserves[type] || 0) > number(snapshot.capacity));
        const populationLow = Number.isFinite(number(snapshot.foodFree))
            && number(snapshot.foodFree) < bounded(options.minimumFood, 50, 0, 10000);
        const fullness = bounded(options.warehousePercent, 90, 50, 100) / 100;
        const storageLow = number(snapshot.capacity) > 0 && RESOURCES.some(type => number(snapshot.stock[type]) >= snapshot.capacity * fullness);
        const candidates = [];
        for (const name of pending) {
            if (name === main || !feasible(name)) {
                continue;
            }
            const building = snapshot.buildings[name];
            // Queued population/storage improvements must finish before another is added.
            if ((name === farm || name === warehouse) && building.queued) {
                continue;
            }
            const resource = Object.keys(snapshot.types.resources || {}).find(type => snapshot.types.resources[type] === name);
            if (resource && (building.level + (building.queued || 0) >= Math.min(limits[name], maxResourceLevel)
                || (snapshot.resourceDetours || 0) >= maxResourceDetours)) {
                continue;
            }
            const repairsFood = name === farm && options.prioritizeFarm && official.foodBlocked;
            const repairsStorage = name === warehouse && options.prioritizeWarehouse && storageBlocked;
            const urgentFarm = name === farm && options.prioritizeFarm && populationLow;
            const urgentWarehouse = name === warehouse && options.prioritizeWarehouse && storageLow;
            const urgent = repairsFood || repairsStorage || urgentFarm || urgentWarehouse;
            if (!urgent && (mainPossible || !(result.waitSeconds >= waitThreshold))) {
                continue;
            }
            const afterWait = waitFor(snapshot, official, building.cost);
            const duration = number(building.durationSeconds);
            const queueSeconds = number(snapshot.queueSeconds);
            const baseStart = Math.max(result.waitSeconds, queueSeconds);
            const nextStart = Math.max(afterWait, queueSeconds + duration);
            const baseline = Number.isFinite(snapshot.mainBudgetSeconds) ? snapshot.mainBudgetSeconds : baseStart;
            const delay = nextStart - baseline;
            // Necessary repairs remove an impossible blocker. Other detours need a provable timing budget.
            if (!repairsFood && !repairsStorage && (!Number.isFinite(delay) || !Number.isFinite(duration)
                || duration < 0 || !Number.isFinite(queueSeconds) || queueSeconds < 0 || delay > maxDelay)) {
                continue;
            }
            let score = urgentWarehouse ? 400 : urgentFarm ? 350 : resource ? 200 : 100;
            if (repairsFood || repairsStorage) {
                score += 1000;
            }
            if (resource) {
                const rate = number(snapshot.production[resource]);
                const deficit = Math.max(0, number(official.cost[resource]) + (snapshot.reserves[resource] || 0) - snapshot.stock[resource]);
                score += Number.isFinite(rate) && rate > 0 ? Math.min(90, deficit / rate / 60) : 0;
                score -= building.level;
            }
            const reason = repairsFood ? 'Farm resolves the sequence population blocker.'
                : repairsStorage ? 'Warehouse makes the next sequence cost fit storage.'
                    : urgentWarehouse ? 'Warehouse protects near-full resource storage.'
                        : urgentFarm ? 'Farm increases low available population.'
                            : resource ? 'Resource upgrade uses a long wait to improve production.'
                                : 'Later sequence upgrade fits inside the long wait.';
            candidates.push({name, score, delay, reason, resource: !!resource});
        }
        candidates.sort((a, b) => b.score - a.score || a.delay - b.delay || pending.indexOf(a.name) - pending.indexOf(b.name));
        if (candidates.length) {
            const choice = candidates[0];
            return {...result, building: choice.name, detour: true, resourceDetour: choice.resource,
                extraDelaySeconds: Number.isFinite(choice.delay) ? Math.max(0, choice.delay) : null, reason: choice.reason};
        }
        if (mainPossible) {
            return {...result, building: main, reason: 'Next sequence upgrade is ready.'};
        }
        return {...result, reason: !Number.isFinite(number(snapshot.queueSeconds))
            ? 'Waiting for queued buildings; queue timing is unavailable, so optional detours are skipped.'
            : Number.isNaN(result.waitSeconds)
                ? 'Waiting for the sequence; production timing is unavailable, so optional detours are skipped.'
                : 'Waiting for the sequence; no affordable detour fits the configured limits.'};
    };

    return {plan, waitFor};
});


define('two/builderQueue', [
    'two/ready',
    'two/utils',
    'two/Settings',
    'two/villageSettings',
    'two/builderQueue/settings',
    'two/builderQueue/settings/map',
    'two/builderQueue/sequenceStatus',
    'conf/upgradeabilityStates',
    'conf/buildingTypes',
    'conf/locationTypes',
    'queues/EventQueue',
    'Lockr',
    'helper/time',
    'two/resourceBudget',
    'two/builderQueue/planner',
    'two/builderQueue/labelPolicy'
], function (
    ready,
    utils,
    Settings,
    villageSettings,
    SETTINGS,
    SETTINGS_MAP,
    SEQUENCE_STATUS,
    UPGRADEABILITY_STATES,
    BUILDING_TYPES,
    LOCATION_TYPES,
    eventQueue,
    Lockr,
    timeHelper,
    resourceBudget,
    planner,
    labelPolicy
) {
    const buildingService = injector.get('buildingService');
    const premiumActionService = injector.get('premiumActionService');
    const buildingQueueService = injector.get('buildingQueueService');
    let initialized = false;
    let running = false;
    let runVersion = 0;
    let intervalCheckId;
    let intervalInstantCheckId;
    const ANALYSES_PER_MINUTE = 1;
    const ANALYSES_PER_MINUTE_INSTANT_FINISH = 10;
    const VILLAGE_BUILDINGS = {};
    const LOGS_LIMIT = 500;
    let groupList;
    let $player;
    let logs;
    let sequencesAvail = true;
    let settings;
    let localSettings;
    const SHARED_SETTINGS = [SETTINGS.GROUP_VILLAGES, SETTINGS.BUILDING_SEQUENCES, SETTINGS.LABEL_MAPPINGS];
    const resourceDetours = new Map();
    const villageConfig = function (villageId) {
        const config = villageSettings(settings, villageId, SHARED_SETTINGS).getAll();
        const profile = localSettings[SETTINGS.VILLAGE_PROFILES] && localSettings[SETTINGS.VILLAGE_PROFILES][villageId];
        if (profile && Object.prototype.hasOwnProperty.call(profile, SETTINGS.ACTIVE_SEQUENCE)
            && !Object.prototype.hasOwnProperty.call(profile, SETTINGS.AUTO_SEQUENCE)
            && !Object.prototype.hasOwnProperty.call(profile, SETTINGS.MANUAL_OVERRIDE)) {
            config[SETTINGS.MANUAL_OVERRIDE] = true;
        }
        return config;
    };
    const resolveSequence = (config, villageId) => labelPolicy.resolve(config, villageId, groupList, config[SETTINGS.BUILDING_SEQUENCES]);
    const villageHasSequence = villageId => {
        const config = villageConfig(villageId);
        return config[SETTINGS.ENABLED] && Array.isArray(config[SETTINGS.BUILDING_SEQUENCES][resolveSequence(config, villageId).sequence]);
    };
    const hasSequence = config => Array.isArray(config[SETTINGS.BUILDING_SEQUENCES][config[SETTINGS.ACTIVE_SEQUENCE]]);
    const updateSequencesAvailable = function () {
        sequencesAvail = hasSequence(localSettings) || Object.keys($player.getVillages()).some(villageHasSequence);
    };
    const STORAGE_KEYS = {
        LOGS: 'builder_queue_log',
        SETTINGS: 'builder_queue_settings',
        DETOURS: 'builder_queue_resource_detours',
        PRESETS_VERSION: 'builder_queue_role_presets_version'
    };

    /**
     * Loop all player villages, check if ready and init the building analyse
     * for each village.
     */
    const analyseVillages = function () {
        const villageIds = getVillageIds();

        if (!sequencesAvail) {
            builderQueue.stop();
            return false;
        }

        villageIds.forEach(function (villageId) {
            const village = $player.getVillage(villageId);
            const readyState = village.checkReadyState();
            const queue = village.buildingQueue;
            const jobs = queue.getAmountJobs();

            if (jobs === queue.getUnlockedSlots()) {
                return false;
            }

            if (!readyState.buildingQueue || !readyState.buildings) {
                return false;
            }

            analyseVillageBuildings(village);
        });
    };

    const analyseVillagesInstantFinish = function () {
        const villageIds = getVillageIds();

        villageIds.forEach(function (villageId) {
            const village = $player.getVillage(villageId);
            const queue = village.buildingQueue;

            if (queue.getAmountJobs()) {
                const jobs = queue.getQueue();

                jobs.forEach(function (job) {
                    if (buildingQueueService.canBeFinishedForFree(job, village)) {
                        premiumActionService.instantBuild(job, LOCATION_TYPES.MASS_SCREEN, true, villageId);
                    }
                });
            }
        });
    };

    const initializeAllVillages = function () {
        const villageIds = getVillageIds();

        villageIds.forEach(function (villageId) {
            const village = $player.getVillage(villageId);

            if (!village.isInitialized()) {
                villageService.initializeVillage(village);
            }
        });
    };

    /**
     * Generate an Array with all player's village IDs.
     *
     * @return {Array}
     */
    const getVillageIds = function () {
        const groupVillages = localSettings[SETTINGS.GROUP_VILLAGES];
        let villages = [];

        if (groupVillages) {
            villages = groupList.getGroupVillageIds(groupVillages);
            villages = villages.filter(function (vid) {
                return $player.getVillage(vid);
            });
        } else {
            utils.each($player.getVillages(), function (village) {
                villages.push(village.getId());
            });
        }

        return [...new Set(villages)].filter(villageHasSequence);
    };

    /**
     * Loop all village buildings, start build job if available.
     *
     * @param {VillageModel} village
     */
    const analyseVillageBuildings = function (village) {
        if (!village || !getVillageIds().some(id => String(id) === String(village.getId())) || resourceBudget.isBusy(village)) {
            return false;
        }
        const queue = village.buildingQueue;
        const readyState = village.checkReadyState();
        if (!readyState.buildingQueue || !readyState.buildings || queue.getAmountJobs() >= queue.getUnlockedSlots()) {
            return false;
        }
        const decision = previewVillage(village);
        if (!decision.building) {
            return false;
        }
        // Recheck game feasibility and village reserves immediately before reserving resources.
        checkAndUpgradeBuilding(village, decision.building, function (jobAdded, data) {
            if (jobAdded && data.job) {
                if (decision.detour) {
                    const key = decision.sequence + ':' + decision.main + ':' + decision.mainLevel;
                    const prior = resourceDetours.get(village.getId());
                    const count = prior && prior.key === key ? prior.count : 0;
                    const deadline = prior && prior.key === key && Number.isFinite(prior.deadline) ? prior.deadline
                        : Number.isFinite(decision.waitSeconds) ? timeHelper.gameTime() + decision.waitSeconds * 1000 : null;
                    resourceDetours.set(village.getId(), {key, count: count + (decision.resourceDetour ? 1 : 0), deadline});
                    Lockr.set(STORAGE_KEYS.DETOURS, Object.fromEntries(resourceDetours));
                }
                eventQueue.trigger(eventTypeProvider.BUILDER_QUEUE_JOB_STARTED, data.job);
                addLog(village.getId(), data.job, decision.reason);
            }
        });
    };

    const previewVillage = function (village, draft) {
        const config = draft || villageConfig(village.getId());
        const resolved = resolveSequence(config, village.getId());
        const sequence = config[SETTINGS.BUILDING_SEQUENCES][resolved.sequence];
        const profileInfo = {sequence: resolved.sequence, sequenceSource: resolved.source, groupId: resolved.groupId};
        if (!Array.isArray(sequence) || !config[SETTINGS.ENABLED]) {
            return {...profileInfo, building: null, reason: !config[SETTINGS.ENABLED] ? 'Building disabled for this village.' : 'No valid sequence selected.'};
        }
        buildingService.compute(village);
        const snapshot = createSnapshot(village, sequence, config);
        const initial = planner.plan(snapshot, {dynamic: false});
        const key = resolved.sequence + ':' + initial.main + ':' + initial.mainLevel;
        const previous = resourceDetours.get(village.getId());
        snapshot.resourceDetours = previous && previous.key === key ? previous.count : 0;
        snapshot.mainBudgetSeconds = previous && previous.key === key && Number.isFinite(previous.deadline)
            ? (previous.deadline - timeHelper.gameTime()) / 1000 : NaN;
        const decision = planner.plan(snapshot, {
            dynamic: config[SETTINGS.DYNAMIC], prioritizeFarm: config[SETTINGS.PRIORIZE_FARM],
            prioritizeWarehouse: config[SETTINGS.PRIORIZE_WAREHOUSE], waitMinutes: config[SETTINGS.WAIT_MINUTES],
            maxDelayMinutes: config[SETTINGS.MAX_DELAY_MINUTES], minimumFood: config[SETTINGS.MINIMUM_FOOD],
            warehousePercent: config[SETTINGS.WAREHOUSE_PERCENT], resourceLevelLimit: config[SETTINGS.RESOURCE_LEVEL_LIMIT],
            resourceDetourLimit: config[SETTINGS.RESOURCE_DETOUR_LIMIT]
        });
        return {...decision, ...profileInfo};
    };

    const createSnapshot = function (village, sequence, config) {
        const resourceModel = village.getResources();
        const computed = resourceModel.getComputed();
        const queue = village.buildingQueue.getQueue();
        const levels = village.getBuildingData().getBuildingLevels();
        const gameBuildings = modelDataService.getGameData().getBuildings();
        const productionRates = typeof resourceModel.getProductionRates === 'function' ? resourceModel.getProductionRates() : {};
        const buildings = {};
        for (const name of new Set(sequence)) {
            const data = village.getBuildingData().getDataForBuilding(name);
            if (!data) {
                continue;
            }
            const queued = queue.filter(job => job.building === name).length;
            const nextLevel = (Number(levels[name]) || 0) + queued + 1;
            const gameCosts = gameBuildings[name] && gameBuildings[name].individual_level_costs
                && gameBuildings[name].individual_level_costs[nextLevel];
            buildings[name] = {
                level: Number(levels[name]) || 0, queued,
                cost: data.nextLevelCosts || {},
                durationSeconds: data.nextLevelCosts && data.nextLevelCosts.build_time !== undefined
                    ? Number(data.nextLevelCosts.build_time) : gameCosts ? Number(gameCosts.build_time) : NaN,
                allowed: data.upgradeability === UPGRADEABILITY_STATES.POSSIBLE,
                foodBlocked: data.upgradeability === UPGRADEABILITY_STATES.NOT_ENOUGH_FOOD
            };
        }
        return {
            sequence, buildings,
            stock: Object.fromEntries(['wood', 'clay', 'iron'].map(type => [type, computed[type] ? computed[type].currentStock : NaN])),
            reserves: {wood: config[SETTINGS.PRESERVE_WOOD], clay: config[SETTINGS.PRESERVE_CLAY], iron: config[SETTINGS.PRESERVE_IRON]},
            production: Object.fromEntries(['wood', 'clay', 'iron'].map(type => {
                const rate = typeof resourceModel.getProductionRateByType === 'function' ? resourceModel.getProductionRateByType(type) : productionRates[type];
                return [type, rate && rate.current !== undefined ? Number(rate.current) / 3600 : NaN];
            })),
            capacity: typeof resourceModel.getMaxStorage === 'function' ? resourceModel.getMaxStorage() : NaN,
            foodFree: computed.food ? computed.food.currentStock : NaN,
            queueSeconds: queue.length ? NaN : 0,
            types: {farm: BUILDING_TYPES.FARM, warehouse: BUILDING_TYPES.WAREHOUSE,
                resources: {wood: BUILDING_TYPES.TIMBER_CAMP, clay: BUILDING_TYPES.CLAY_PIT, iron: BUILDING_TYPES.IRON_MINE}}
        };
    };

    /**
     * Init a build job
     *
     * @param {VillageModel} village
     * @param {String} buildingName - Building to be build.
     * @param {Function} callback
     */
    const checkAndUpgradeBuilding = function (village, buildingName, callback) {
        if (checkBuildingUpgradeability(village, buildingName) === UPGRADEABILITY_STATES.POSSIBLE) {
            upgradeBuilding(village, buildingName, function (data) {
                callback(!!data.job, data);
            });
        } else {
            callback(false);
        }
    };

    const upgradeBuilding = function (village, buildingName, callback) {
        const cost = village.getBuildingData().getDataForBuilding(buildingName).nextLevelCosts;
        const reservation = resourceBudget.begin(village, cost);
        if (!reservation) {
            return;
        }
        socketService.emit(routeProvider.VILLAGE_UPGRADE_BUILDING, {
            building: buildingName,
            village_id: village.getId(),
            location: LOCATION_TYPES.MASS_SCREEN,
            premium: false
        }, function (data) {
            if (data && data.error) {
                resourceBudget.reject(village, reservation);
            } else if (data && data.job) {
                resourceBudget.acknowledge(village, reservation);
            }
            callback(data || {});
        });
    };

    /**
     * Can't just use the .upgradeability value because of the preserve resources setting.
     */
    const checkBuildingUpgradeability = function (village, buildingName) {
        const buildingData = village.getBuildingData().getDataForBuilding(buildingName);

        if (buildingData.upgradeability === UPGRADEABILITY_STATES.POSSIBLE) {
            const config = villageConfig(village.getId());
            const nextLevelCosts = buildingData.nextLevelCosts;
            const resources = village.getResources().getComputed();

            if (
                resources.clay.currentStock - config[SETTINGS.PRESERVE_CLAY] < nextLevelCosts.clay ||
                resources.iron.currentStock - config[SETTINGS.PRESERVE_IRON] < nextLevelCosts.iron ||
                resources.wood.currentStock - config[SETTINGS.PRESERVE_WOOD] < nextLevelCosts.wood
            ) {
                return UPGRADEABILITY_STATES.NOT_ENOUGH_RESOURCES;
            }
        }

        return buildingData.upgradeability;
    };

    /**
     * Check if the building sequence is valid by analysing if the
     * buildings exceed the maximum level.
     *
     * @param {Array} sequence
     * @return {Boolean}
     */
    const validSequence = function (sequence) {
        const buildingData = modelDataService.getGameData().getBuildings();
        const counts = {};

        for (let i = 0; i < sequence.length; i++) {
            const building = sequence[i];

            counts[building] = (counts[building] || 0) + 1;
            if (!buildingData[building] || counts[building] > buildingData[building].max_level) {
                return false;
            }
        }

        return true;
    };

    const addLog = function (villageId, jobData, reason) {
        const data = {
            time: timeHelper.gameTime(),
            villageId: villageId,
            building: jobData.building,
            level: jobData.level,
            reason: reason || 'Sequence upgrade.'
        };

        logs.unshift(data);

        if (logs.length > LOGS_LIMIT) {
            logs.splice(logs.length - LOGS_LIMIT, logs.length);
        }

        Lockr.set(STORAGE_KEYS.LOGS, logs);

        return true;
    };

    const builderQueue = {};

    builderQueue.start = function () {
        if (running) {
            return false;
        }
        if (!sequencesAvail) {
            eventQueue.trigger(eventTypeProvider.BUILDER_QUEUE_NO_SEQUENCES);
            return false;
        }

        running = true;
        const token = ++runVersion;
        intervalCheckId = setInterval(analyseVillages, 60000 / ANALYSES_PER_MINUTE);
        intervalInstantCheckId = setInterval(analyseVillagesInstantFinish, 60000 / ANALYSES_PER_MINUTE_INSTANT_FINISH);
        
        eventQueue.trigger(eventTypeProvider.BUILDER_QUEUE_START);

        ready(function () {
            if (!running || token !== runVersion) {
                return;
            }
            initializeAllVillages();
            analyseVillages();
            analyseVillagesInstantFinish();
        }, ['all_villages_ready']);
    };

    builderQueue.stop = function () {
        running = false;
        runVersion++;
        clearInterval(intervalCheckId);
        clearInterval(intervalInstantCheckId);
        eventQueue.trigger(eventTypeProvider.BUILDER_QUEUE_STOP);
    };

    builderQueue.isRunning = function () {
        return running;
    };

    builderQueue.isInitialized = function () {
        return initialized;
    };

    builderQueue.getSettings = function (villageId) {
        const view = villageSettings(settings, villageId, SHARED_SETTINGS);
        if (!villageId) {
            return view;
        }
        const set = view.set;
        const setAll = view.setAll;
        view.set = function (id, value, opt) {
            if (id === SETTINGS.ACTIVE_SEQUENCE) {
                return setAll.call(view, {[id]: value, [SETTINGS.MANUAL_OVERRIDE]: true, [SETTINGS.AUTO_SEQUENCE]: false}, opt);
            }
            return set.call(view, id, value, opt);
        };
        view.setAll = function (values, opt) {
            if (Object.prototype.hasOwnProperty.call(values, SETTINGS.ACTIVE_SEQUENCE)
                && !Object.prototype.hasOwnProperty.call(values, SETTINGS.AUTO_SEQUENCE)
                && !Object.prototype.hasOwnProperty.call(values, SETTINGS.MANUAL_OVERRIDE)) {
                values = {...values, [SETTINGS.MANUAL_OVERRIDE]: true, [SETTINGS.AUTO_SEQUENCE]: false};
            }
            return setAll.call(view, values, opt);
        };
        return view;
    };

    builderQueue.preview = function (villageId, draft) {
        const village = $player.getVillage(villageId);
        if (!village) {
            return {building: null, reason: 'Village is unavailable.'};
        }
        const readyState = village.checkReadyState();
        if (!readyState.buildingQueue || !readyState.buildings) {
            return {building: null, reason: 'Waiting for village building data.'};
        }
        const decision = previewVillage(village, draft);
        if (village.buildingQueue.getAmountJobs() >= village.buildingQueue.getUnlockedSlots()) {
            return {...decision, building: null, reason: 'All building queue slots are occupied.'};
        }
        if (resourceBudget.isBusy(village)) {
            return {...decision, building: null, reason: 'Waiting for another resource order to be confirmed.'};
        }
        return decision;
    };

    builderQueue.getLogs = function () {
        return logs;
    };

    builderQueue.clearLogs = function () {
        logs = [];
        Lockr.set(STORAGE_KEYS.LOGS, logs);
        eventQueue.trigger(eventTypeProvider.BUILDER_QUEUE_CLEAR_LOGS);
    };

    builderQueue.addBuildingSequence = function (id, sequence) {
        const sequences = settings.get(SETTINGS.BUILDING_SEQUENCES);

        if (id in sequences) {
            return SEQUENCE_STATUS.SEQUENCE_EXISTS;
        }

        if (!Array.isArray(sequence) || !validSequence(sequence)) {
            return SEQUENCE_STATUS.SEQUENCE_INVALID;
        }

        sequences[id] = sequence;
        settings.set(SETTINGS.BUILDING_SEQUENCES, sequences, {
            quiet: true
        });
        eventQueue.trigger(eventTypeProvider.BUILDER_QUEUE_BUILDING_SEQUENCES_ADDED, id);

        return SEQUENCE_STATUS.SEQUENCE_SAVED;
    };

    builderQueue.updateBuildingSequence = function (id, sequence) {
        const sequences = settings.get(SETTINGS.BUILDING_SEQUENCES);

        if (!(id in sequences)) {
            return SEQUENCE_STATUS.SEQUENCE_NO_EXISTS;
        }

        if (!Array.isArray(sequence) || !validSequence(sequence)) {
            return SEQUENCE_STATUS.SEQUENCE_INVALID;
        }

        sequences[id] = sequence;
        settings.set(SETTINGS.BUILDING_SEQUENCES, sequences, {
            quiet: true
        });
        eventQueue.trigger(eventTypeProvider.BUILDER_QUEUE_BUILDING_SEQUENCES_UPDATED, id);

        return SEQUENCE_STATUS.SEQUENCE_SAVED;
    };

    builderQueue.removeSequence = function (id) {
        const sequences = settings.get(SETTINGS.BUILDING_SEQUENCES);

        if (!(id in sequences)) {
            return SEQUENCE_STATUS.SEQUENCE_NO_EXISTS;
        }

        delete sequences[id];
        settings.set(SETTINGS.BUILDING_SEQUENCES, sequences, {
            quiet: true
        });
        eventQueue.trigger(eventTypeProvider.BUILDER_QUEUE_BUILDING_SEQUENCES_REMOVED, id);
    };

    builderQueue.init = function () {
        initialized = true;
        logs = Lockr.get(STORAGE_KEYS.LOGS, [], true);
        for (const [id, state] of Object.entries(Lockr.get(STORAGE_KEYS.DETOURS, {}))) {
            if (state && typeof state.key === 'string' && Number.isFinite(state.count) && state.count >= 0) {
                resourceDetours.set(Number(id), state);
            }
        }
        $player = modelDataService.getSelectedCharacter();
        groupList = modelDataService.getGroupList();
        
        settings = new Settings({
            settingsMap: SETTINGS_MAP,
            storageKey: STORAGE_KEYS.SETTINGS
        });

        // Preserve saved arrays atomically; Angular merge otherwise appends default steps to shorter edits.
        const stored = Lockr.get(STORAGE_KEYS.SETTINGS, {});
        if (stored[SETTINGS.BUILDING_SEQUENCES] && typeof stored[SETTINGS.BUILDING_SEQUENCES] === 'object') {
            const library = angular.copy(stored[SETTINGS.BUILDING_SEQUENCES]);
            if (Object.keys(library).length && Lockr.get(STORAGE_KEYS.PRESETS_VERSION, 0) < 1) {
                for (const role of ['Offensive', 'Defensive', 'Resource']) {
                    if (!(role in library) && Array.isArray(SETTINGS_MAP[SETTINGS.BUILDING_SEQUENCES].default[role])) {
                        library[role] = angular.copy(SETTINGS_MAP[SETTINGS.BUILDING_SEQUENCES].default[role]);
                    }
                }
            }
            settings.set(SETTINGS.BUILDING_SEQUENCES, library, {quiet: true});
        }
        Lockr.set(STORAGE_KEYS.PRESETS_VERSION, 1);
        const profiles = settings.getRaw(SETTINGS.VILLAGE_PROFILES);
        let profilesChanged = false;
        for (const profile of Object.values(profiles || {})) {
            if (profile && Object.prototype.hasOwnProperty.call(profile, SETTINGS.ACTIVE_SEQUENCE)
                && !Object.prototype.hasOwnProperty.call(profile, SETTINGS.AUTO_SEQUENCE)
                && !Object.prototype.hasOwnProperty.call(profile, SETTINGS.MANUAL_OVERRIDE)) {
                profile[SETTINGS.AUTO_SEQUENCE] = false;
                profile[SETTINGS.MANUAL_OVERRIDE] = true;
                profilesChanged = true;
            }
        }
        if (profilesChanged) {
            settings.set(SETTINGS.VILLAGE_PROFILES, profiles, {quiet: true});
        }

        settings.onChange(function (changes, updates, opt) {
            const restart = running;
            if (restart) {
                builderQueue.stop();
            }
            localSettings = settings.getAll();
            updateSequencesAvailable();

            if (restart) {
                builderQueue.start();
            }

            if (!opt.quiet) {
                eventQueue.trigger(eventTypeProvider.BUILDER_QUEUE_SETTINGS_CHANGE);
            }
        });

        localSettings = settings.getAll();

        for (const buildingName in BUILDING_TYPES) {
            VILLAGE_BUILDINGS[BUILDING_TYPES[buildingName]] = 0;
        }

        updateSequencesAvailable();
        [eventTypeProvider.GROUPS_UPDATED,
            eventTypeProvider.GROUPS_CREATED,
            eventTypeProvider.GROUPS_DESTROYED,
            eventTypeProvider.GROUPS_VILLAGE_LINKED,
            eventTypeProvider.GROUPS_VILLAGE_UNLINKED].filter(Boolean).forEach(type => {
            $rootScope.$on(type, function () {
                updateSequencesAvailable();
                if (running) {
                    analyseVillages();
                }
            });
        });

        $rootScope.$on(eventTypeProvider.BUILDING_LEVEL_CHANGED, function (event, data) {
            if (!running) {
                return false;
            }

            const token = runVersion;
            setTimeout(function () {
                if (!running || token !== runVersion) {
                    return;
                }
                const village = $player.getVillage(data.village_id);
                analyseVillageBuildings(village);
            }, 1000);
        });
    };

    return builderQueue;
});
