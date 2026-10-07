define('two/autoCollector/secondVillage', [
    'two/autoCollector',
    'two/utils',
    'queues/EventQueue',
    'helper/time',
    'models/SecondVillageModel'
], function (
    autoCollector,
    utils,
    eventQueue,
    $timeHelper,
    SecondVillageModel
) {
    let initialized = false;
    let running = false;
    let allFinished = false;
    let generation = 0;
    let timer;
    const secondVillageService = injector.get('secondVillageService');

    const getRunningJob = function (jobs) {
        const now = Date.now();

        for (const id in jobs) {
            if (jobs[id].time_started && jobs[id].time_completed) {
                if (now < $timeHelper.server2ClientTime(jobs[id].time_completed)) {
                    return jobs[id];
                }
            }
        }

        return false;
    };

    const getCollectibleJob = function (jobs) {
        const now = Date.now();

        for (const id in jobs) {
            if (jobs[id].time_started && jobs[id].time_completed) {
                if ((now >= $timeHelper.server2ClientTime(jobs[id].time_completed)) && !jobs[id].collected) {
                    return id;
                }
            }
        }

        return false;
    };

    const finalizeJob = function (jobId) {
        socketService.emit(routeProvider.SECOND_VILLAGE_COLLECT_JOB_REWARD, {
            village_id: modelDataService.getSelectedVillage().getId(),
            job_id: jobId
        });
    };

    const startJob = function (job, callback) {
        socketService.emit(routeProvider.SECOND_VILLAGE_START_JOB, {
            village_id: modelDataService.getSelectedVillage().getId(),
            job_id: job.id
        }, callback);
    };

    const getFirstJob = function (jobs) {
        let jobId = false;

        utils.each(jobs, function (id) {
            jobId = id;
            return false;
        });

        return jobId;
    };

    const updateSecondVillageInfo = function (callback) {
        const token = generation;
        socketService.emit(routeProvider.SECOND_VILLAGE_GET_INFO, {}, function (data) {
            if (!running || token !== generation) {
                return;
            }
            if (secondVillageService.hasFinishedLastJob(data.jobs)) {
                allFinished = true;
                socketService.emit(routeProvider.SECOND_VILLAGE_FINISH_VILLAGE);
                secondVillageCollector.stop();
            } else{
                const model = new SecondVillageModel(data);
                modelDataService.getSelectedCharacter().setSecondVillage(model);
                callback();
            }
        });
    };

    const updateAndAnalyse = function () {
        if (running) {
            updateSecondVillageInfo(analyse);
        }
    };

    const analyse = function () {
        const secondVillage = modelDataService.getSelectedCharacter().getSecondVillage();

        if (!running || !secondVillage || !secondVillage.isAvailable()) {
            return false;
        }

        const current = getRunningJob(secondVillage.data.jobs);

        if (current) {
            const completed = $timeHelper.server2ClientTime(current.time_completed);
            const nextRun = completed - Date.now() + 1000;

            clearTimeout(timer);
            timer = setTimeout(updateAndAnalyse, nextRun);

            return false;
        }

        const collectible = getCollectibleJob(secondVillage.data.jobs);
        
        if (collectible) {
            return finalizeJob(collectible);
        }

        const currentDayJobs = secondVillageService.getCurrentDayJobs(secondVillage.data.jobs, secondVillage.data.day);
        const collectedJobs = secondVillageService.getCollectedJobs(secondVillage.data.jobs);
        const resources = modelDataService.getSelectedVillage().getResources().getResources();
        const availableJobs = secondVillageService.getAvailableJobs(currentDayJobs, collectedJobs, resources, []);

        if (availableJobs) {
            const firstJob = getFirstJob(availableJobs);

            const token = generation;
            startJob(firstJob, function () {
                if (!running || token !== generation) {
                    return;
                }
                clearTimeout(timer);
                const job = availableJobs[firstJob];

                if (job) {
                    timer = setTimeout(updateAndAnalyse, (job.duration * 1000) + 1000);
                } else {
                    timer = setTimeout(updateAndAnalyse, 60 * 1000);
                }

            });
        }
    };

    const secondVillageCollector = {};

    secondVillageCollector.start = function () {
        if (!initialized || running) {
            return false;
        }

        if (allFinished) {
            socketService.emit(routeProvider.SECOND_VILLAGE_FINISH_VILLAGE);
            secondVillageCollector.stop();
            return false;
        }

        running = true;
        generation++;
        eventQueue.trigger(eventTypeProvider.AUTO_COLLECTOR_SECONDVILLAGE_STARTED);
        updateAndAnalyse();
        return true;
    };

    secondVillageCollector.stop = function () {
        if (!initialized) {
            return false;
        }

        running = false;
        generation++;
        clearTimeout(timer);
        eventQueue.trigger(eventTypeProvider.AUTO_COLLECTOR_SECONDVILLAGE_STOPPED);
    };

    secondVillageCollector.isRunning = function () {
        return running;
    };

    secondVillageCollector.isInitialized = function () {
        return initialized;
    };

    secondVillageCollector.init = function () {
        if (initialized || !secondVillageService.isFeatureActive()) {
            return false;
        }

        initialized = true;

        socketService.emit(routeProvider.SECOND_VILLAGE_GET_INFO, {}, function (data) {
            if (secondVillageService.hasFinishedLastJob(data.jobs)) {
                allFinished = true;
            } else {
                $rootScope.$on(eventTypeProvider.SECOND_VILLAGE_VILLAGE_CREATED, updateAndAnalyse);
                $rootScope.$on(eventTypeProvider.SECOND_VILLAGE_JOB_COLLECTED, updateAndAnalyse);
            }
        });
    };

    autoCollector.secondVillage = secondVillageCollector;
});
