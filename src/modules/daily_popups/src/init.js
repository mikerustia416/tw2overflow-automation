require(['two/ready', 'two/dailyPopups', 'two/dailyPopups/ui', 'two/moduleState'], function (ready, tracker, ui, restoreModuleState) {
    ready(function () {
        if (!tracker.isInitialized()) {
            tracker.init();
            ui();
            restoreModuleState(tracker, 'daily_popups_active', 'two_daily_popups_start', 'two_daily_popups_stop', true);
        }
    }, 'map');
});
