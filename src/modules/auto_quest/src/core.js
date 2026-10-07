define('two/autoQuest', [
    'two/Settings',
    'two/autoQuest/settings',
    'two/autoQuest/settings/map',
    'queues/EventQueue',
    'two/autoQuest/events'
], function (Settings, SETTINGS, SETTINGS_MAP, eventQueue) {
    let initialized = false;
    let running = false;
    let settings;
    let localSettings;
    let intervalId;
    let windowCheckId;
    let actionTimeoutId;
    let pendingAction;

    const isAvailable = function (button) {
        return !button.disabled && button.getAttribute('aria-disabled') !== 'true'
            && !button.classList.contains('btn-grey') && button.getClientRects().length > 0;
    };

    const questModelFor = function (button) {
        const scope = angular.element(button).scope();
        return scope && scope.data && scope.data.questModel;
    };

    const questRows = function () {
        return Array.from(document.querySelectorAll('[ng-controller="ModalQuestLineController"] [ng-click*="selectQuest"]'))
            .filter(button => /^\s*selectQuest\(\$index\)\s*;?\s*$/.test(button.getAttribute('ng-click')));
    };

    const isReadyTask = function (button) {
        return isAvailable(button) && !button.classList.contains('selected')
            && !!button.querySelector('.icon-44x44-quest-ready-to-finish')
            && !button.querySelector('.icon-44x44-quest-finished');
    };

    const isClaimable = function (button) {
        if (!isAvailable(button)) {
            return false;
        }

        const questModel = questModelFor(button);
        return questModel && typeof questModel.isFinishable === 'function'
            ? questModel.isFinishable() && !(typeof questModel.isClosed === 'function' && questModel.isClosed())
            : button.classList.contains('btn-green');
    };

    const scheduleCheck = function (delay = 1000) {
        clearTimeout(windowCheckId);
        windowCheckId = setTimeout(checkAndFinishQuests, delay);
    };

    const act = function (button, type) {
        clearTimeout(actionTimeoutId);
        pendingAction = {button, type, questModel: type === 'claim' ? questModelFor(button) : null};
        // Wait for the game to acknowledge a claim before attempting it again.
        actionTimeoutId = setTimeout(function () {
            pendingAction = null;
        }, 10000);
        button.click();
        scheduleCheck();
    };

    const checkAndFinishQuests = function () {
        if (!running || !localSettings[SETTINGS.ENABLED]) {
            return;
        }
        // Native clicks invoke Angular's ng-click $apply. Run after the current
        // digest rather than nesting another $apply inside the Start handler.
        if ($rootScope.$$phase) {
            scheduleCheck(0);
            return;
        }
        if (pendingAction && pendingAction.type === 'claim'
            && (!pendingAction.button.isConnected || !isClaimable(pendingAction.button))) {
            clearTimeout(actionTimeoutId);
            pendingAction = null;
        }
        const tasks = questRows();
        if (pendingAction && ((pendingAction.type === 'open' && tasks.length)
            || (pendingAction.type === 'select' && (!pendingAction.button.isConnected
                || pendingAction.button.classList.contains('selected'))))) {
            clearTimeout(actionTimeoutId);
            pendingAction = null;
        }

        const finishButton = Array.from(document.querySelectorAll('[ng-click*="finishQuest"]')).find(function (button) {
            return /^\s*finishQuest\(\)\s*;?\s*$/.test(button.getAttribute('ng-click')) && isClaimable(button);
        });

        if (finishButton) {
            if (pendingAction && pendingAction.type === 'claim' && pendingAction.button === finishButton
                && pendingAction.questModel === questModelFor(finishButton)) {
                return;
            }
            return act(finishButton, 'claim');
        }

        // Selecting the exclamation-mark task updates data.questModel and
        // reveals its reward. Never select unfinished or already closed tasks.
        const readyTask = tasks.find(isReadyTask);
        if (readyTask) {
            if (!pendingAction) {
                act(readyTask, 'select');
            }
            return;
        }
        // An open panel with no claimable/ready tasks can be closed without
        // reopening a different toolbar line while this one is displayed.
        if (tasks.length) {
            const closeButton = Array.from(document.querySelectorAll(
                '[ng-controller="ModalQuestLineController"] [ng-click="closeWindow()"]'
            )).find(isAvailable);
            if (closeButton && !pendingAction) {
                act(closeButton, 'close');
            }
            return;
        }

        const questLine = Array.from(document.querySelectorAll('.quest-line-finishable[ng-click], .quest-line-unread[ng-click]')).find(function (button) {
            return /^\s*openQuestLineModal\(questLineModel\)\s*;?\s*$/.test(button.getAttribute('ng-click')) && isAvailable(button);
        });
        if (questLine && !pendingAction) {
            act(questLine, 'open');
        } else if (!questLine && (!pendingAction || pendingAction.type !== 'open')) {
            clearTimeout(actionTimeoutId);
            pendingAction = null;
            const closeButton = Array.from(document.querySelectorAll(
                '[ng-controller="ModalQuestLineController"] [ng-click="closeWindow()"]'
            )).find(isAvailable);
            if (closeButton) {
                act(closeButton, 'close');
            }
        }
    };

    const stopChecker = function () {
        clearInterval(intervalId);
        clearTimeout(windowCheckId);
        clearTimeout(actionTimeoutId);
        pendingAction = null;
        intervalId = null;
        windowCheckId = null;
    };

    const startChecker = function () {
        const configuredInterval = localSettings[SETTINGS.CHECK_INTERVAL];
        const interval = Number.isFinite(configuredInterval)
            ? Math.min(300000, Math.max(5000, configuredInterval)) : 30000;
        intervalId = setInterval(checkAndFinishQuests, interval);
        checkAndFinishQuests();
    };

    const autoQuest = {};

    autoQuest.init = function () {
        if (initialized) {
            return false;
        }

        settings = new Settings({
            settingsMap: SETTINGS_MAP,
            storageKey: 'auto_quest_settings'
        });
        settings.store();
        localSettings = settings.getAll();

        settings.onChange(function () {
            const restart = running;
            if (restart) {
                autoQuest.stop();
            }
            localSettings = settings.getAll();
            if (restart) {
                autoQuest.start();
            }
        });

        $rootScope.$on(eventTypeProvider.WINDOW_OPENED, function () {
            if (running) {
                scheduleCheck();
            }
        });
        initialized = true;
    };

    autoQuest.start = function () {
        if (!initialized || running) {
            return false;
        }

        running = true;
        startChecker();
        eventQueue.trigger(eventTypeProvider.AUTO_QUEST_START);
    };

    autoQuest.stop = function () {
        if (!running) {
            return false;
        }

        running = false;
        stopChecker();
        eventQueue.trigger(eventTypeProvider.AUTO_QUEST_STOP);
    };

    autoQuest.getSettings = function () {
        return settings;
    };

    autoQuest.isInitialized = function () {
        return initialized;
    };

    autoQuest.isRunning = function () {
        return running;
    };

    return autoQuest;
});
