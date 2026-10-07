require(['two/ready', 'two/___spy_recruiter_id', 'two/___spy_recruiter_id/ui', 'two/___spy_recruiter_id/events', 'two/moduleState'], function (ready, module, ui, moduleEvents, restoreModuleState) {
    ready(function () {
        if (!module.isInitialized()) {
            module.init();
            ui();
            restoreModuleState(module, 'spy_recruiter_active', eventTypeProvider.___spy_recruiter_id_START, eventTypeProvider.___spy_recruiter_id_STOP);
        }
    }, ['all_villages_ready', 'world_config']);
});
