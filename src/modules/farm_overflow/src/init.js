require([
    'two/ready',
    'two/farmOverflow',
    'two/farmOverflow/ui',
    'two/moduleState',
    'two/farmOverflow/events'
], function (
    ready,
    farmOverflow,
    farmOverflowInterface,
    restoreModuleState
) {
    if (farmOverflow.isInitialized()) {
        return false;
    }

    ready(function () {
        farmOverflow.init();
        farmOverflowInterface();
        restoreModuleState(farmOverflow, 'farm_overflow_active', eventTypeProvider.FARM_OVERFLOW_START, eventTypeProvider.FARM_OVERFLOW_STOP);
    }, ['map', 'presets']);
});
