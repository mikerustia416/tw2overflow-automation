define('two/depositPlanner', [
    'two/Settings',
    'two/depositPlanner/settings/map',
    'two/depositPlanner/policy',
    'two/depositPlanner/adapter',
    'Lockr',
    'queues/EventQueue'
], function (Settings, map, policy, adapter, Lockr, events) {
    const KEYS = {pending: 'deposit_planner_pending', samples: 'deposit_planner_samples', cycle: 'deposit_planner_cycle', revision: 'deposit_planner_board_revision', timing: 'deposit_planner_timing'};
    let initialized = false;
    let running = false;
    let settings;
    let config;
    let info;
    let lastInfoAt = 0;
    let pending;
    let samples = [];
    let timings = [];
    let activeTiming;
    let ownedStart;
    let cycle;
    let boardRevision = 0;
    let wake;
    let plan = {action: 'wait', reason: 'Open the planner to refresh deposit data', jobs: []};
    let status = 'Paused';
    let poll;
    let deferred;
    let generation = 0;
    let takeoverUntil = 0;
    let refreshing = false;
    let refreshTimeout;
    let forecastKey;
    let forecastCache;
    const publish = () => events.trigger('two_deposit_planner_updated');
    const storePending = () => Lockr.set(KEYS.pending, pending || null);

    const refresh = function () {
        if (!refreshing && routeProvider.RESOURCE_DEPOSIT_GET_INFO) {
            refreshing = true;
            clearTimeout(refreshTimeout);
            refreshTimeout = setTimeout(() => {
                refreshing = false;
            }, 5000);
            socketService.emit(routeProvider.RESOURCE_DEPOSIT_GET_INFO, {});
        }
    };
    const schedule = function () {
        if (!running || deferred) {
            return;
        }
        const token = generation;
        deferred = setTimeout(() => {
            deferred = null;
            if (running && token === generation) {
                execute();
            }
        }, 300);
    };
    const reconcile = function (state) {
        if (!pending) {
            return true;
        }
        const idMatches = job => job && String(job.id) === String(pending.jobId);
        const all = state.jobs.concat(state.collectible, state.current || []);
        const startConfirmed = pending.action === 'start' && (idMatches(state.current) || state.collectible.some(idMatches));
        const collectionConfirmed = pending.action === 'collect' && !all.some(idMatches)
            && (pending.ack || state.cycleId === pending.cycleId && state.progress > pending.progress);
        const runningPreserved = pending.runningJobId === undefined || state.collectible.concat(state.current || []).some(job => String(job.id) === String(pending.runningJobId)
            && Number.isFinite(job.completedAt) && Math.abs(job.completedAt - pending.runningCompletedAt) <= 1)
            || state.cycleId === pending.cycleId && state.progress > pending.progress;
        const rerollConfirmed = pending.action === 'reroll' && runningPreserved && (pending.rerollAck || adapter.boardKey(state) !== pending.boardKey)
            && (pending.itemDebited || state.itemCount < pending.itemCount);
        if (startConfirmed && pending === ownedStart && pending.context === state.context && running && !config.preview_only) {
            const job = idMatches(state.current) ? state.current : state.collectible.find(idMatches);
            const delay = job.completedAt - job.duration - pending.sentAt;
            activeTiming = Number.isFinite(delay) && delay >= -1 && delay <= 30
                ? {jobId: pending.jobId, context: state.context, cycleId: state.cycleId, startDelay: Math.max(0, delay), completedAt: job.completedAt} : null;
        }
        if (collectionConfirmed && activeTiming && String(activeTiming.jobId) === String(pending.jobId)) {
            const delay = activeTiming.startDelay + state.now - activeTiming.completedAt;
            if (running && !config.preview_only && activeTiming.context === state.context && activeTiming.cycleId === state.cycleId
                && Number.isFinite(delay) && delay >= 0 && delay <= 300) {
                timings.push({context: state.context, at: state.now, delay});
                timings = timings.filter(entry => entry.at >= state.now - 30 * 86400).slice(-60);
                Lockr.set(KEYS.timing, timings);
            }
            activeTiming = null;
        }
        if (startConfirmed || collectionConfirmed || rerollConfirmed) {
            pending = null;
            storePending();
            return true;
        }
        if (running && pending.action === 'reroll' && !runningPreserved) {
            planner.stop('Running errand changed during an item reroll; check the game before resolving the guard');
        }
        if (running && state.now - pending.sentAt >= 30) {
            planner.stop('Pending ' + pending.action + ' needs a game check; automatic retry blocked');
        }
        return false;
    };
    const armWake = function (state) {
        clearTimeout(wake);
        if (!running) {
            return;
        }
        const candidates = [state.errandsReset + 1, state.milestonesReset + 1];
        if (state.current) {
            candidates.push(state.current.completedAt + config.action_delay);
        }
        if (pending) {
            candidates.push(pending.sentAt + 30);
        }
        if (takeoverUntil > state.now) {
            candidates.push(takeoverUntil + 0.1);
        }
        const next = Math.min(...candidates.filter(timestamp => timestamp > state.now));
        if (Number.isFinite(next)) {
            wake = setTimeout(() => {
                wake = null;
                refresh();
                schedule();
            }, Math.max(100, (next - state.now) * 1000));
        }
    };
    const preview = function () {
        try {
            if (!policy.validSettings(config, map)) {
                throw new Error('Invalid planner settings');
            }
            let state = adapter.snapshot(info, config, cycle.spent);
            if (cycle.reset !== state.cycleId) {
                // A corrected future timestamp must not replenish the daily budget.
                if (cycle.reset && adapter.toClientSeconds(cycle.reset) <= state.now) {
                    cycle.spent = 0;
                }
                cycle.reset = state.cycleId;
                Lockr.set(KEYS.cycle, cycle);
                state = {...state, rerollsUsed: cycle.spent};
            }
            if (state.jobs.length === 6 && !state.current && !state.collectible.length && state.jobs.every(policy.validJob)) {
                const key = JSON.stringify([adapter.boardKey(state), state.context, state.cycleId, state.errandsReset, boardRevision]);
                if (!samples.some(sample => sample.key === key)) {
                    samples.push({key, context: state.context, at: state.now,
                        jobs: state.jobs.map(job => ({id: job.id, duration: job.duration, amount: job.amount}))});
                    samples = samples.filter(sample => sample.at >= state.now - 30 * 86400).slice(-60);
                    Lockr.set(KEYS.samples, samples);
                }
            }
            reconcile(state);
            const timing = policy.timingEstimate(timings, state, config);
            const effectiveConfig = {...config, action_delay: timing.effectiveDelay};
            const key = JSON.stringify([state.jobs,
                state.current,
                state.collectible,
                state.progress,
                state.target,
                state.milestones,
                state.runningRerollAllowed,
                state.errandsReset,
                state.milestonesReset,
                state.itemCount,
                state.rerollsUsed,
                state.context,
                Math.floor(state.now),
                effectiveConfig,
                samples.length]);
            plan = policy.plan(state, effectiveConfig, samples, function () {
                if (key !== forecastKey) {
                    forecastCache = policy.forecast(state, effectiveConfig, samples);
                    forecastKey = key;
                }
                return forecastCache;
            });
            plan.timing = timing;
            armWake(state);
            if (pending) {
                plan = {...plan, action: 'pending', reason: 'Waiting for game confirmation of ' + pending.action};
            }
            publish();
            return plan;
        } catch (error) {
            plan = {action: 'unavailable', reason: error.message, jobs: []};
            publish();
            return plan;
        }
    };
    const send = function (action, state, job) {
        if (!running || config.preview_only || pending) {
            return;
        }
        let route;
        let payload;
        if (action === 'reroll') {
            if (!config.auto_reroll || policy.budgetFor(state, config) < 1 || !state.itemId || state.current && !policy.canRerollRunning(state, config) || state.collectible.length) {
                return;
            }
            // The premium reroll route spends Crowns. Only use the inventory item.
            route = routeProvider.PREMIUM_USE_ITEM;
            payload = {village_id: modelDataService.getSelectedVillage().getId(), item_id: state.itemId};
        } else if (action === 'start') {
            route = routeProvider.RESOURCE_DEPOSIT_START_JOB;
            payload = {job_id: job.id};
        } else {
            route = routeProvider.RESOURCE_DEPOSIT_COLLECT;
            payload = {job_id: job.id, village_id: modelDataService.getSelectedVillage().getId()};
        }
        if (!route) {
            planner.stop('Required game route unavailable');
            return;
        }
        pending = {action, jobId: job && job.id, itemId: state.itemId, itemCount: state.itemCount,
            boardKey: adapter.boardKey(state), progress: state.progress, cycleId: state.cycleId, context: state.context, runningJobId: action === 'reroll' && state.current ? state.current.id : undefined,
            runningCompletedAt: action === 'reroll' && state.current ? state.current.completedAt : undefined, sentAt: Date.now() / 1000};
        // Reserve the item budget before emitting, including uncertain responses.
        if (action === 'reroll') {
            cycle.spent++;
            Lockr.set(KEYS.cycle, cycle);
        }
        storePending();
        status = 'Awaiting ' + action + ' confirmation';
        const entry = pending;
        if (action === 'start') {
            ownedStart = entry;
        }
        socketService.emit(route, payload, reply => {
            if (pending !== entry) {
                return;
            }
            if (reply && reply.error) {
                planner.stop('Game rejected ' + action + '; inspect the pending guard');
            }
            refresh();
            schedule();
        });
        preview();
    };
    const execute = function () {
        if (!running) {
            return;
        }
        const next = preview();
        if (!running) {
            return;
        }
        if (next.action === 'unavailable' || next.action === 'refresh' || Date.now() / 1000 - lastInfoAt > config.poll_seconds + 5) {
            status = next.reason;
            refresh();
            return;
        }
        if (pending || Date.now() / 1000 < takeoverUntil) {
            status = pending ? 'Waiting for game confirmation' : 'Waiting for Collector handover';
            return;
        }
        status = config.preview_only ? 'Running — preview only' : 'Running — ' + next.reason;
        if (config.preview_only) {
            publish();
            return;
        }
        if (next.action === 'target' && !config.hold_after_target && next.state.collectible.length) {
            send('collect', next.state, next.state.collectible[0]);
        } else if (['start', 'collect', 'reroll'].includes(next.action)) {
            if (next.action === 'reroll' && !config.auto_reroll) {
                status = 'Item reroll recommended; automatic rerolls are disabled';
            } else {
                send(next.action, next.state, next.job);
            }
        }
        publish();
    };
    const onInfo = function (data) {
        refreshing = false;
        clearTimeout(refreshTimeout);
        if (data && data.time_next_reset && data.time_new_milestones) {
            info = {time_next_reset: data.time_next_reset, time_new_milestones: data.time_new_milestones};
            lastInfoAt = Date.now() / 1000;
            forecastKey = null;
        }
        preview();
        schedule();
    };
    const planner = {
        init: function () {
            if (initialized) {
                return;
            }
            initialized = true;
            timings = Lockr.get(KEYS.timing, []);
            timings = Array.isArray(timings) ? timings.filter(entry => entry && typeof entry.context === 'string') : [];
            pending = Lockr.get(KEYS.pending, null);
            samples = Lockr.get(KEYS.samples, []);
            if (!Array.isArray(samples)) {
                samples = [];
            }
            samples = samples.filter(sample => sample && Array.isArray(sample.jobs));
            boardRevision = Number(Lockr.get(KEYS.revision, 0)) || 0;
            cycle = Lockr.get(KEYS.cycle, {reset: null, spent: 0});
            if (!cycle || !Number.isInteger(cycle.spent) || cycle.spent < 0) {
                cycle = {reset: null, spent: 20};
            }
            settings = new Settings({settingsMap: map, storageKey: 'deposit_planner_settings', onChange: function () {
                const resume = running;
                if (resume) {
                    planner.stop();
                }
                config = settings.getAll();
                forecastKey = null;
                if (resume) {
                    planner.start();
                } else {
                    preview();
                }
            }});
            config = settings.getAll();
            $rootScope.$on(eventTypeProvider.RESOURCE_DEPOSIT_INFO, (event, data) => onInfo(data));
            for (const name of ['RESOURCE_DEPOSIT_JOBS_REROLLED',
                'RESOURCE_DEPOSIT_JOB_STARTED',
                'RESOURCE_DEPOSIT_JOB_COLLECTED',
                'RESOURCE_DEPOSIT_JOB_COLLECTIBLE',
                'INVENTORY_ITEM_CHANGED']) {
                if (!eventTypeProvider[name]) {
                    continue;
                }
                $rootScope.$on(eventTypeProvider[name], function (event, data) {
                    if (name === 'RESOURCE_DEPOSIT_JOBS_REROLLED') {
                        boardRevision++;
                        Lockr.set(KEYS.revision, boardRevision);
                        if (pending && pending.action === 'reroll') {
                            pending.rerollAck = true;
                            storePending();
                        }
                    }
                    if (pending && data) {
                        if (name === 'RESOURCE_DEPOSIT_JOB_COLLECTED' && pending.action === 'collect'
                            && String(data.job_id) === String(pending.jobId)) {
                            pending.ack = true;
                        }
                        if (name === 'INVENTORY_ITEM_CHANGED' && pending.action === 'reroll'
                            && data.type === 'resource_deposit_reroll' && String(data.id) === String(pending.itemId)
                            && Number(data.amount) < pending.itemCount) {
                            pending.itemDebited = true;
                        }
                        storePending();
                    }
                    forecastKey = null;
                    if (name !== 'RESOURCE_DEPOSIT_JOB_COLLECTIBLE') {
                        refresh();
                    }
                    schedule();
                });
            }
            for (const name of ['EFFECT_CHANGED', 'EFFECT_EXPIRED', 'EFFECT_EFFECT']) {
                if (eventTypeProvider[name]) {
                    $rootScope.$on(eventTypeProvider[name], () => {
                        forecastKey = null; refresh(); schedule();
                    });
                }
            }
            $rootScope.$on('auto_collector_started', function () {
                if (running && !config.preview_only) {
                    planner.stop('Paused because Collector took control of the deposit');
                }
            });
            refresh();
        },
        start: function () {
            if (!initialized || running || !policy.validSettings(config, map)
                || !modelDataService.getWorldConfig().isResourceDepositEnabled()) {
                return false;
            }
            running = true;
            generation++;
            if (!config.preview_only) {
                takeoverUntil = Date.now() / 1000 + 3;
                events.trigger('two_deposit_planner_controls_deposit');
            }
            status = config.preview_only ? 'Running — preview only' : 'Running';
            events.trigger('two_deposit_planner_start');
            // Fresh data is mandatory after every start and reload.
            lastInfoAt = 0;
            refresh();
            poll = setInterval(() => {
                refresh(); execute();
            }, config.poll_seconds * 1000);
            schedule();
            publish();
            return true;
        },
        stop: function (reason) {
            running = false;
            activeTiming = null;
            ownedStart = null;
            generation++;
            clearInterval(poll);
            clearTimeout(deferred);
            clearTimeout(wake);
            deferred = null;
            status = reason || 'Paused';
            events.trigger('two_deposit_planner_stop');
            publish();
        },
        resolvePending: function () {
            if (running) {
                return false;
            }
            pending = null;
            storePending();
            forecastKey = null;
            refresh();
            preview();
            return true;
        },
        isRunning: () => running,
        isInitialized: () => initialized,
        getSettings: () => settings,
        getPlan: () => plan,
        getStatus: () => status,
        getPending: () => pending,
        refresh,
        preview
    };
    return planner;
});
