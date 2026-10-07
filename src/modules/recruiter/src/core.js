define('two/recruiter', [
    'two/Settings',
    'two/villageSettings',
    'two/recruiter/settings/map',
    'two/recruiter/policy',
    'two/resourceBudget',
    'two/ready',
    'queues/EventQueue',
    'Lockr',
    'helper/time'
], function (Settings, villageSettings, settingsMap, policy, resourceBudget, ready, eventQueue, Lockr, time) {
    let initialized = false;
    let running = false;
    let settings;
    let config;
    let timer;
    let version = 0;
    let pending;
    let pendingKey;
    let plans = [];
    const resources = ['wood', 'clay', 'iron', 'food'];
    const timers = new Map();
    const reservations = new Map();
    const publish = () => eventQueue.trigger('two_recruiter_updated');
    const unitData = () => modelDataService.getGameData().getUnitsObject();
    const buildingData = () => modelDataService.getGameData().getBuildings();
    const valid = () => policy.validSettings(config, settingsMap, unitData(), buildingData());

    const villages = function () {
        const player = modelDataService.getSelectedCharacter();
        const groups = modelDataService.getGroupList();
        const ids = config.enabled_groups.length
            ? [...new Set(config.enabled_groups.flatMap(id => groups.getGroupVillageIds(id)))]
            : Object.keys(player.getVillages());
        return ids.map(id => player.getVillage(id)).filter(Boolean);
    };

    const villageConfig = villageId => villageSettings(settings, villageId, ['preview_only', 'check_interval', 'enabled_groups']).getAll();

    const snapshot = function (village, config = villageConfig(village.getId())) {
        buildingService.compute(village);
        const resourceModel = village.getResources();
        const computed = resourceModel.getComputed();
        const updatedAt = typeof resourceModel.getLastUpdate === 'function'
            ? time.server2ClientTime(resourceModel.getLastUpdate()) : NaN;
        const stock = Object.fromEntries(resources.map(type => [type, computed[type] && computed[type].currentStock]));
        const data = village.getBuildingData();
        const barracks = data.getDataForBuilding('barracks');
        const queue = village.getRecruitingQueue('barracks');
        const jobs = queue && (typeof queue.getQueue === 'function' ? queue.getQueue() : queue.jobs);
        const buildingCosts = {wood: 0, clay: 0, iron: 0, food: 0};
        const buildingQueue = village.buildingQueue;
        if (config.protect_buildings.length && (!buildingQueue || typeof buildingQueue.getQueue !== 'function')) {
            throw new Error('Building queue unavailable');
        }
        const buildingJobs = buildingQueue ? buildingQueue.getQueue() : [];
        for (const name of new Set(config.protect_buildings)) {
            // A queued upgrade is already paid; protect its following level once it completes.
            if (buildingJobs.some(job => job.building === name)) {
                continue;
            }
            const building = data.getDataForBuilding(name);
            if (building && building.level >= Number(buildingData()[name].max_level)) {
                continue;
            }
            const cost = building && building.nextLevelCosts;
            for (const type of resources) {
                if (!cost || !Number.isFinite(Number(cost[type])) || Number(cost[type]) < 0) {
                    throw new Error('Next building costs unavailable');
                }
                buildingCosts[type] += Number(cost[type]);
            }
        }
        return {stock, updatedAt, buildingCosts, barracksLevel: barracks && barracks.level,
            jobs: Array.isArray(jobs) ? jobs.map(job => job.data || job) : null,
            units: village.getUnitInfo().getUnits()};
    };

    const reconcile = function (village, state) {
        const entry = pending[village.getId()];
        if (!entry) {
            return !resourceBudget.isBusy(village);
        }
        // Socket callbacks can omit the job; the authoritative queue/event also confirms it.
        const matches = (state.jobs || []).filter(job => {
            const id = job.job_id || job.id;
            if (entry.jobId) {
                return String(id) === String(entry.jobId);
            }
            if (job.unit_type !== entry.unit || Number(job.amount) !== Number(entry.amount)) {
                return false;
            }
            if (Array.isArray(entry.beforeJobs)) {
                return !entry.beforeJobs.includes(String(id));
            }
            // Older persisted guards have no queue baseline. Match their actual start time.
            const startedAt = time.server2ClientTime(job.start_time);
            return Number.isFinite(startedAt) && Math.abs(startedAt - entry.sentAt) <= 5000;
        });
        if (matches.length === 1) {
            entry.jobId = matches[0].job_id || matches[0].id;
            entry.queueObserved = true;
            Lockr.set(pendingKey, pending);
        }
        // Production can replace a small debit before the next poll. A newer server
        // resource snapshot is authoritative even when the computed stock grew again.
        const fresh = Number.isFinite(state.updatedAt) && state.updatedAt > entry.sentAt;
        const debited = resources.every(type => !entry.cost[type]
            || state.stock[type] <= entry.before[type] - entry.cost[type]);
        if (entry.queueObserved && (fresh || debited)) {
            delete pending[village.getId()];
            Lockr.set(pendingKey, pending);
            clearTimeout(timers.get(village.getId()));
            timers.delete(village.getId());
            const reservation = reservations.get(village.getId());
            if (reservation) {
                resourceBudget.reject(village, reservation);
                reservations.delete(village.getId());
            }
            return !resourceBudget.isBusy(village);
        }
        return false;
    };

    const cycle = function () {
        if (!running) {
            return;
        }
        plans = [];
        if (!valid()) {
            recruiter.stop('Invalid recruitment settings');
            return;
        }
        for (const village of villages()) {
            if (!running) {
                break;
            }
            try {
                const config = villageConfig(village.getId());
                if (!policy.validSettings(config, settingsMap, unitData(), buildingData())) {
                    plans.push({villageId: village.getId(), reason: 'Invalid village recruitment settings', orders: []});
                    continue;
                }
                if (!config.enabled) {
                    plans.push({villageId: village.getId(), reason: 'Recruitment disabled for this village', orders: []});
                    continue;
                }
                const state = snapshot(village, config);
                const plan = policy.plan(state, config, unitData());
                plan.villageId = village.getId();
                plans.push(plan);
                if (!config.preview_only && !reconcile(village, state)) {
                    plan.reason = 'Waiting for an earlier spend to appear in game data';
                    if (pending[village.getId()] && Date.now() - pending[village.getId()].sentAt >= 30000) {
                        recruiter.stop('Pending recruitment needs a queue/resource check');
                        break;
                    }
                    continue;
                }
                if (running && !config.preview_only && plan.orders.length) {
                    // One batch per village/cycle; next cycle replans against fresh game data.
                    send(village, state, plan.orders[0]);
                }
            } catch (error) {
                plans.push({villageId: village.getId(), reason: error.message, orders: []});
            }
        }
        publish();
    };

    const send = function (village, state, order) {
        if (!routeProvider.BARRACKS_RECRUIT) {
            recruiter.stop('Recruitment route unavailable');
            return;
        }
        const reservation = resourceBudget.begin(village, order.cost);
        if (!reservation) {
            return;
        }
        reservations.set(village.getId(), reservation);
        const entry = {beforeJobs: (state.jobs || []).map(job => String(job.job_id || job.id)), before: state.stock, cost: order.cost, sentAt: Date.now(), unit: order.unit_type, amount: order.amount};
        pending[village.getId()] = entry;
        Lockr.set(pendingKey, pending);
        timers.set(village.getId(), setTimeout(() => {
            try {
                if (!reconcile(village, snapshot(village)) && running && !config.preview_only) {
                    recruiter.stop('Recruitment acknowledgement or resource update missing; inspect the game queue');
                }
            } catch (error) {
                recruiter.stop(error.message);
            }
        }, 30000));
        // Keep uncertain reservations on stop/restart and reload. Never automatically retry.
        socketService.emit(routeProvider.BARRACKS_RECRUIT, {
            village_id: village.getId(), unit_type: order.unit_type, amount: order.amount
        }, data => {
            if (pending[village.getId()] !== entry) {
                return;
            }
            if (data && data.error) {
                delete pending[village.getId()];
                Lockr.set(pendingKey, pending);
                resourceBudget.reject(village, reservation);
                clearTimeout(timers.get(village.getId()));
                timers.delete(village.getId());
                recruiter.stop('Recruitment rejected by the server');
                return;
            }
            const job = data && (data.job || data);
            if (job && job.job_id && Number(job.village_id) === Number(village.getId())
                && job.unit_type === order.unit_type && job.amount === order.amount) {
                entry.jobId = job.job_id;
                Lockr.set(pendingKey, pending);
                resourceBudget.acknowledge(village, reservation);
            }
            publish();
        });
    };

    const recruiter = {
        status: 'Stopped',
        init: function () {
            if (initialized) {
                return;
            }
            initialized = true;
            const player = modelDataService.getSelectedCharacter();
            const suffix = `${player.getWorldId()}_${player.getId()}`;
            pendingKey = `recruiter_pending_${suffix}`;
            pending = Lockr.get(pendingKey, {});
            if (eventTypeProvider.BARRACKS_RECRUIT_JOB_CREATED) {
                $rootScope.$on(eventTypeProvider.BARRACKS_RECRUIT_JOB_CREATED, (event, job) => {
                    if (!job) {
                        return;
                    }
                    const entry = pending[job.village_id];
                    if (entry && job.job_id && job.unit_type === entry.unit
                        && Number(job.amount) === Number(entry.amount)
                        && (!entry.beforeJobs || !entry.beforeJobs.includes(String(job.job_id)))) {
                        entry.jobId = job.job_id;
                        const village = modelDataService.getSelectedCharacter().getVillage(job.village_id);
                        if (village) {
                            reconcile(village, snapshot(village));
                        }
                        Lockr.set(pendingKey, pending);
                        publish();
                    }
                });
            }
            settings = new Settings({settingsMap, storageKey: `recruiter_settings_${suffix}`});
            config = settings.getAll();
            settings.onChange(() => {
                const restart = running;
                if (restart) {
                    recruiter.stop();
                }
                config = settings.getAll();
                if (restart) {
                    recruiter.start();
                }
            });
        },
        start: function () {
            if (running || !valid()) {
                return false;
            }
            running = true;
            eventQueue.trigger('two_recruiter_start');
            recruiter.status = config.preview_only ? 'Previewing recruitment' : 'Recruiting';
            const token = ++version;
            ready(() => {
                if (!running || token !== version) {
                    return;
                }
                cycle();
                if (running && token === version) {
                    timer = setInterval(cycle, config.check_interval);
                }
            }, 'all_villages_ready');
            publish();
            return true;
        },
        stop: function (reason = 'Stopped') {
            running = false;
            version++;
            clearInterval(timer);
            recruiter.status = reason;
            eventQueue.trigger('two_recruiter_stop');
            publish();
        },
        isRunning: () => running,
        isInitialized: () => initialized,
        getSettings: villageId => villageSettings(settings, villageId, ['preview_only', 'check_interval', 'enabled_groups']),
        resolvePending: function (villageId) {
            if (running) {
                return false;
            }
            delete pending[villageId];
            Lockr.set(pendingKey, pending);
            resourceBudget.clear(villageId);
            reservations.delete(Number(villageId));
            clearTimeout(timers.get(Number(villageId)));
            timers.delete(Number(villageId));
            recruiter.status = 'Guard cleared after manual check; start again';
            publish();
            return true;
        },
        getPlans: () => plans,
        getPending: () => pending
    };
    return recruiter;
});
