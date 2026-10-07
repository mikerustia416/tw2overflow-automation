require([
    'two/ready',
    'two/autoCollector/secondVillage',
    'two/autoCollector/ui',
    'Lockr',
    'two/moduleState',
    'two/autoCollector/events'
], function (ready, secondVillage, ui, Lockr, restoreModuleState) {
    ready(function () {
        if (secondVillage.isInitialized()) {
            return;
        }
        const legacyActive = Lockr.get('auto_collector_active', false) === true;
        // Capture the old shared preference before Deposit Planner retires it.
        if (Lockr.get('auto_collector_second_village_active', null) === null) {
            Lockr.set('auto_collector_second_village_active', legacyActive);
        }
        secondVillage.init();
        if (secondVillage.isInitialized()) {
            ui();
        }
        restoreModuleState(secondVillage, 'auto_collector_second_village_active', eventTypeProvider.AUTO_COLLECTOR_SECONDVILLAGE_STARTED, eventTypeProvider.AUTO_COLLECTOR_SECONDVILLAGE_STOPPED);
    }, ['initial_village', 'world_config']);
});
