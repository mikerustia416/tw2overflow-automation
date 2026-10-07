require(['two/ready', 'two/commandQueue', 'two/commandQueue/ui', 'two/commandQueue/events', 'two/moduleState'], function (ready, commandQueue, ui, moduleEvents, restoreModuleState) {
    ready(function () {
        if (commandQueue.initialized) {
            return;
        }
        commandQueue.init();
        ui();
        // Migrate the previous automatic startup only when no state has been saved.
        // An explicit saved pause always wins, even with pending commands.
        restoreModuleState({start: () => commandQueue.start(true), isRunning: () => commandQueue.isRunning()},
            'command_queue_active',
            eventTypeProvider.COMMAND_QUEUE_START,
            eventTypeProvider.COMMAND_QUEUE_STOP,
            commandQueue.getWaitingCommands().length > 0);
    }, ['map', 'world_config']);
});
