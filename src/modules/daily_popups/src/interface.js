define('two/dailyPopups/ui', [
    'two/ui',
    'two/dailyPopups',
    'two/EventScope',
    'queues/EventQueue'
], function (ui, tracker, EventScope, eventQueue) {
    let button;
    const refreshButton = function () {
        button.classList.toggle('btn-red', tracker.isRunning());
        button.classList.toggle('btn-orange', !tracker.isRunning());
    };
    const buildWindow = function () {
        const scope = $rootScope.$new();
        const settings = tracker.getSettings();
        scope.claimDaily = settings.get('claim_daily');
        scope.closeAds = settings.get('close_ads');
        const refresh = function () {
            scope.$evalAsync(function () {
                scope.running = tracker.isRunning();
                scope.status = tracker.getStatus();
            });
        };
        scope.switchState = function () {
            if (tracker.isRunning()) {
                tracker.stop();
            } else {
                tracker.start();
            }
        };
        scope.saveSettings = function () {
            settings.setAll({claim_daily: !!scope.claimDaily, close_ads: !!scope.closeAds});
            scope.saved = true;
        };
        const events = new EventScope('twoverflow_daily_popups_window');
        ['two_daily_popups_start', 'two_daily_popups_stop', 'two_daily_popups_status'].forEach(function (event) {
            events.register(event, refresh);
        });
        scope.$on('$destroy', function () {
            events.destroy();
        });
        refresh();
        windowManagerService.getScreenWithInjectedScope('!twoverflow_daily_popups_window', scope);
    };
    return function () {
        if (button) {
            return false;
        }
        ui.addTemplate('twoverflow_daily_popups_window', `___daily_popups_html_main`);
        button = ui.addMenuButton('Daily Popups', 21);
        button.addEventListener('click', buildWindow);
        eventQueue.register('two_daily_popups_start', refreshButton);
        eventQueue.register('two_daily_popups_stop', refreshButton);
        refreshButton();
    };
});
