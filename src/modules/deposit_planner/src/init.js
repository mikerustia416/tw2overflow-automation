require(['two/ready', 'two/depositPlanner', 'two/depositPlanner/ui', 'two/moduleState', 'two/depositPlanner/migrate'], function (ready, planner, ui, restoreModuleState, migrate) {
    ready(function () {
        if (!planner.isInitialized()) {
            migrate();
            planner.init();
            ui();
            restoreModuleState(planner, 'deposit_planner_active', 'two_deposit_planner_start', 'two_deposit_planner_stop');
        }
    }, ['initial_village', 'world_config']);
});
