define('two/autoQuest/ui', [
    'two/ui',
    'two/autoQuest',
    'two/autoQuest/settings',
    'two/EventScope',
    'two/utils',
    'queues/EventQueue',
    'humanInterval'
], function (interfaceOverflow, autoQuest, SETTINGS, EventScope, utils, eventQueue, humanInterval) {
    let settings;
    let $button;

    const init = function () {
        if ($button) {
            return false;
        }

        settings = autoQuest.getSettings();
        interfaceOverflow.addTemplate('twoverflow_auto_quest_window', `___auto_quest_html_main`);
        $button = interfaceOverflow.addMenuButton('Quest', 20);
        $button.addEventListener('click', buildWindow);

        eventQueue.register(eventTypeProvider.AUTO_QUEST_START, function () {
            $button.classList.remove('btn-orange');
            $button.classList.add('btn-red');
        });
        eventQueue.register(eventTypeProvider.AUTO_QUEST_STOP, function () {
            $button.classList.remove('btn-red');
            $button.classList.add('btn-orange');
        });
    };

    const buildWindow = function () {
        const scope = $rootScope.$new();
        scope.running = autoQuest.isRunning();
        scope.enabled = settings.getRaw(SETTINGS.ENABLED);
        scope.checkInterval = settings.getRaw(SETTINGS.CHECK_INTERVAL);

        scope.switchState = function () {
            if (autoQuest.isRunning()) {
                autoQuest.stop();
            } else {
                autoQuest.start();
            }
        };

        scope.saveSettings = function () {
            const interval = humanInterval(scope.checkInterval);
            if (!settings.valid('readable_time', scope.checkInterval)
                || !Number.isFinite(interval) || interval < 5000 || interval > 300000) {
                return utils.notif('error', $filter('i18n')('invalid_interval', $rootScope.loc.ale, 'auto_quest'));
            }

            settings.setAll({
                [SETTINGS.ENABLED]: scope.enabled,
                [SETTINGS.CHECK_INTERVAL]: scope.checkInterval
            });
            utils.notif('success', $filter('i18n')('settings_saved', $rootScope.loc.ale, 'common'));
        };

        const eventScope = new EventScope('twoverflow_auto_quest_window');
        eventScope.register(eventTypeProvider.AUTO_QUEST_START, function () {
            scope.$evalAsync(function () {
                scope.running = true;
            });
        });
        eventScope.register(eventTypeProvider.AUTO_QUEST_STOP, function () {
            scope.$evalAsync(function () {
                scope.running = false;
            });
        });
        scope.$on('$destroy', function () {
            eventScope.destroy();
        });

        windowManagerService.getScreenWithInjectedScope('!twoverflow_auto_quest_window', scope);
    };

    return init;
});
