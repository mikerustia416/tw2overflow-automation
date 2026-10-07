require([
    'two/ready',
    'two/builderQueue',
    'two/builderQueue/ui',
    'two/moduleState',
    'two/builderQueue/events'
], function (
    ready,
    builderQueue,
    builderQueueInterface,
    restoreModuleState
) {
    if (builderQueue.isInitialized()) {
        return false;
    }

    ready(function () {
        builderQueue.init();
        builderQueueInterface();
        restoreModuleState(builderQueue, 'builder_queue_active', eventTypeProvider.BUILDER_QUEUE_START, eventTypeProvider.BUILDER_QUEUE_STOP);
    });
});
