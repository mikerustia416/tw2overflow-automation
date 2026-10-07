require(['two/ready', 'two/depositPlanner', 'two/depositPlanner/ui', 'two/moduleState'], function (ready, planner, ui, restoreModuleState) {
    ready(function () {
        if (!planner.isInitialized()) {
            planner.init();
            ui();
            restoreModuleState(planner, 'deposit_planner_active', 'two_deposit_planner_start', 'two_deposit_planner_stop');
        }
    }, ['initial_village', 'world_config']);
});
