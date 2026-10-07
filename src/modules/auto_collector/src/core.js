define('two/autoCollector', [
    'queues/EventQueue',
    'helper/time',
    'two/debug',
    'Lockr'
], function (
    eventQueue,
    timeHelper,
    setupDebug,
    Lockr
) {
    let initialized = false;
    let running = false;

    const debug = setupDebug('auto_collector');

    /**
     * Permite que o evento RESOURCE_DEPOSIT_JOB_COLLECTIBLE seja executado
     * apenas uma vez.
     */
    let recall = true;

    /**
     * Next automatic reroll setTimeout ID.
     */
    let nextUpdateId = null;
    let nextMilestoneId = null;

    /**
     * Inicia um trabalho.
     *
     * @param {Object} job - Dados do trabalho
     */
    const startJob = function (job) {
        debug(1, 'start job id %s', job.id);
        debug(2, 'job details %o', job);

        socketService.emit(routeProvider.RESOURCE_DEPOSIT_START_JOB, {
            job_id: job.id
        });
    };

    /**
     * Coleta um trabalho.
     *
     * @param {Object} job - Dados do trabalho
     */
    const finalizeJob = function (job) {
        debug(1, 'finalize job id %s', job.id);
        debug(2, 'job details %o', job);

        socketService.emit(routeProvider.RESOURCE_DEPOSIT_COLLECT, {
            job_id: job.id,
            village_id: modelDataService.getSelectedVillage().getId()
        });
    };

    /**
     * Força a atualização das informações do depósito.
     */
    const updateDepositInfo = function () {
        debug(1, 'update update deposit info');

        socketService.emit(routeProvider.RESOURCE_DEPOSIT_GET_INFO, {});
    };

    /**
     * Faz a analise dos trabalhos sempre que um evento relacionado ao depósito
     * é disparado.
     */
    const analyse = function () {
        debug(1, 'analyse');

        if (!running || Lockr.get('deposit_planner_pending', null)) {
            return false;
        }

        const data = modelDataService.getSelectedCharacter().getResourceDeposit();

        if (!data) {
            return false;
        }

        if (data.getCurrentJob()) {
            return false;
        }

        const collectible = data.getCollectibleJobs();

        if (collectible && collectible.length) {
            return finalizeJob(collectible.shift());
        }

        const ready = data.getReadyJobs();

        if (ready && ready.length) {
            return startJob(getFastestJob(ready));
        }
    };

    /**
     * Obtem o trabalho de menor duração.
     *
     * @param {Array} jobs - Lista de trabalhos prontos para serem iniciados.
     */
    const getFastestJob = function (jobs) {
        debug(2, 'get fastest job within %o', jobs);

        const sorted = jobs.sort(function (a, b) {
            return a.duration - b.duration;
        });

        return sorted[0];
    };

    /**
     * Atualiza o timeout para que seja forçado a atualização das informações
     * do depósito quando for resetado.
     * Motivo: só é chamado automaticamente quando um milestone é resetado,
     * e não o diário.
     * 
     * @param {Object} data - Os dados recebidos de RESOURCE_DEPOSIT_INFO
     */
    const rerollUpdater = function (data) {
        debug(1, 'reroll updater');

        if (data.time_next_reset) {
            clearTimeout(nextUpdateId);
            const resetTime = timeHelper.server2ClientTime(data.time_next_reset) - timeHelper.gameTime();
            nextUpdateId = setTimeout(updateDepositInfo, resetTime);
        }

        if (data.time_new_milestones) {
            clearTimeout(nextMilestoneId);
            const resetTime = timeHelper.server2ClientTime(data.time_new_milestones) - timeHelper.gameTime();
            nextMilestoneId = setTimeout(updateDepositInfo, resetTime);
        }
    };

    /**
     * Métodos públicos do AutoCollector.
     *
     * @type {Object}
     */
    const autoCollector = {};

    /**
     * Inicializa o AutoDepois, configura os eventos.
     */
    autoCollector.init = function () {
        if (initialized) {
            return false;
        }
        initialized = true;
        $rootScope.$on('two_deposit_planner_controls_deposit', function () {
            if (running) {
                autoCollector.stop();
            }
        });

        if (!modelDataService.getWorldConfig().isResourceDepositEnabled()) {
            return false;
        }

        $rootScope.$on(eventTypeProvider.RESOURCE_DEPOSIT_JOB_COLLECTIBLE, function () {
            if (!recall || !running) {
                return false;
            }

            recall = false;

            setTimeout(function () {
                recall = true;
                analyse();
            }, 1500);
        });

        $rootScope.$on(eventTypeProvider.RESOURCE_DEPOSIT_JOBS_REROLLED, analyse);
        $rootScope.$on(eventTypeProvider.RESOURCE_DEPOSIT_JOB_COLLECTED, analyse);
        $rootScope.$on(eventTypeProvider.RESOURCE_DEPOSIT_INFO, function (event, data) {
            if (!data.x && !data.y) {
                if (running) {
                    autoCollector.stop();
                }

                return;
            }

            analyse();
            rerollUpdater(data);
        });
    };

    /**
     * Inicia a analise dos trabalhos.
     */
    autoCollector.start = function () {
        if (!initialized || running || !modelDataService.getWorldConfig().isResourceDepositEnabled()) {
            return false;
        }
        running = true;
        eventQueue.trigger(eventTypeProvider.AUTO_COLLECTOR_STARTED);
        socketService.emit(routeProvider.RESOURCE_DEPOSIT_GET_INFO, {});
        return true;
    };

    /**
     * Para a analise dos trabalhos.
     */
    autoCollector.stop = function () {
        running = false;
        clearTimeout(nextUpdateId);
        clearTimeout(nextMilestoneId);
        eventQueue.trigger(eventTypeProvider.AUTO_COLLECTOR_STOPPED);
    };

    /**
     * Retorna se o modulo está em funcionamento.
     */
    autoCollector.isRunning = function () {
        return running;
    };

    /**
     * Retorna se o modulo está inicializado.
     */
    autoCollector.isInitialized = function () {
        return initialized;
    };

    return autoCollector;
});
