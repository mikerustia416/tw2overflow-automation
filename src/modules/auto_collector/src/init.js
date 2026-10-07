require([
    'two/ready',
    'two/autoCollector',
    'two/autoCollector/ui',
    'Lockr',
    'two/moduleState',
    'two/autoCollector/secondVillage',
    'two/autoCollector/events'
], function (ready, autoCollector, ui, Lockr, restoreModuleState) {
    ready(function () {
        if (autoCollector.isInitialized()) {
            return;
        }
        autoCollector.init();
        autoCollector.secondVillage.init();
        ui();
        const legacyActive = Lockr.get('auto_collector_active', false) === true;
        restoreModuleState(autoCollector, 'auto_collector_active', eventTypeProvider.AUTO_COLLECTOR_STARTED, eventTypeProvider.AUTO_COLLECTOR_STOPPED);
        restoreModuleState(autoCollector.secondVillage, 'auto_collector_second_village_active', eventTypeProvider.AUTO_COLLECTOR_SECONDVILLAGE_STARTED, eventTypeProvider.AUTO_COLLECTOR_SECONDVILLAGE_STOPPED, legacyActive);
    }, ['initial_village', 'world_config']);
});
