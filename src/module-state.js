define('two/moduleState', [
    'Lockr',
    'queues/EventQueue'
], function (Lockr, eventQueue) {
    return function (module, storageKey, startEvent, stopEvent, defaultActive = false) {
        eventQueue.register(startEvent, function () {
            Lockr.set(storageKey, true);
        });
        eventQueue.register(stopEvent, function () {
            Lockr.set(storageKey, false);
        });

        if (Lockr.get(storageKey, defaultActive) === true) {
            module.start();
            // Validation can reject a saved run before a start/stop event is emitted.
            Lockr.set(storageKey, module.isRunning());
        }
    };
});
