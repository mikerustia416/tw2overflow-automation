require(['two/ready', 'two/autoMinter', 'two/autoMinter/ui', 'two/autoMinter/events', 'two/moduleState'], function (ready, module, ui, moduleEvents, restoreModuleState) {
    ready(function () {
        if (!module.isInitialized()) {
            module.init();
            ui();
            restoreModuleState(module, 'auto_minter_active', eventTypeProvider.AUTO_MINTER_START, eventTypeProvider.AUTO_MINTER_STOP);
        }
    }, ['all_villages_ready', 'world_config']);
});
