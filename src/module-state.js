// Retire saved preview switches without turning an old preview session into orders.
define('two/migratePreviewSettings', ['Lockr'], function (Lockr) {
    return function (settingsKey, activeKey) {
        const saved = Lockr.get(settingsKey, {});
        let changed = false;
        if (hasOwn.call(saved, 'preview_only')) {
            if (saved.preview_only === true && Lockr.get(activeKey, false) === true) {
                Lockr.set(activeKey, false);
            }
            delete saved.preview_only;
            changed = true;
        }
        for (const profile of Object.values(saved.village_profiles || {})) {
            if (hasOwn.call(profile, 'preview_only')) {
                delete profile.preview_only;
                changed = true;
            }
        }
        if (changed) {
            Lockr.set(settingsKey, saved);
        }
    };
});

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
