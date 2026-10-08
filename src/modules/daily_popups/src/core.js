define('two/dailyPopups', [
    'two/Settings',
    'two/dailyPopups/settings/map',
    'queues/EventQueue',
    'helper/time'
], function (Settings, settingsMap, eventQueue, time) {
    const START = 'two_daily_popups_start';
    const STOP = 'two_daily_popups_stop';
    const STATUS = 'two_daily_popups_status';
    const DAILY = 'ModalDailyLoginBonusController';
    const ADVERT = 'ModalInterstitialController';
    const watching = 'Watching for daily rewards and adverts';
    const attempted = new WeakMap();
    let initialized = false;
    let running = false;
    let settings;
    let intervalId;
    let checkId;
    let pending;
    const status = {message: 'Paused', claimsRequested: 0, advertsDismissed: 0};

    const update = function (message) {
        status.message = message;
        eventQueue.trigger(STATUS);
    };

    const available = function (button) {
        return button && button.isConnected && !button.disabled
            && button.getAttribute('aria-disabled') !== 'true'
            && !button.classList.contains('btn-grey') && button.getClientRects().length > 0;
    };

    const controls = function (root, expression) {
        return Array.from(root.querySelectorAll('[ng-click]')).filter(function (button) {
            return button.getAttribute('ng-click').replace(/;\s*$/, '').trim() === expression && available(button);
        });
    };

    const schedule = function () {
        if (!running) {
            return;
        }
        clearTimeout(checkId);
        checkId = setTimeout(check, 250);
    };

    const isDismissPrompt = function (modal) {
        const scope = modal.scope;
        const translate = key => $filter('i18n')(key, $rootScope.loc.ale, 'modal_interstitial');
        return modal.templateName === 'modal_attention' && scope
            && typeof scope.submit === 'function' && typeof scope.cancel === 'function'
            && scope.submitText === translate('dismiss') && scope.cancelText === translate('cancel')
            && scope.text === translate('text') && scope.title === translate('attention');
    };

    const click = function (button, scope, type, modal) {
        const before = windowManagerService.getModals().slice();
        attempted.set(scope, type);
        pending = {scope, type, modal, since: time.gameTime(), confirmation: null, submitted: false};
        if (type === 'claim') {
            status.claimsRequested++;
        }
        update(type === 'claim' ? 'Waiting for daily reward confirmation'
            : type === 'select' ? 'Selecting today\'s reward' : 'Closing advert');
        try {
            button.click();
            if (type === 'advert' && !scope.interstitial.accept_on_view) {
                // The native advert controller creates its Dismiss prompt
                // synchronously on destruction. Bind only that new window.
                pending.confirmation = windowManagerService.getModals().find(function (item) {
                    return !before.includes(item) && isDismissPrompt(item);
                }) || null;
                pending.needsConfirmation = true;
            }
        } catch (error) {
            pending.failed = true;
            update('Popup action failed; check the game manually');
        }
        schedule();
    };

    const checkPending = function (modals) {
        if (!pending) {
            return false;
        }
        const action = pending;
        if (action.type === 'select' && action.scope.selectedDay === action.scope.currentDay) {
            attempted.delete(action.scope);
            pending = null;
            return false;
        }
        if (action.failed && modals.includes(action.modal)) {
            return true;
        }
        if (action.confirmation && modals.includes(action.confirmation)) {
            if (!action.submitted) {
                if (!settings.get('close_ads') || action.failed) {
                    return true;
                }
                if (modals[0] !== action.confirmation) {
                    return true;
                }
                const button = controls(action.confirmation.rootnode, 'submit($event)')[0];
                if (!button || !isDismissPrompt(action.confirmation)) {
                    return true;
                }
                action.submitted = true;
                update('Dismissing advert');
                try {
                    button.click();
                } catch (error) {
                    action.failed = true;
                    update('Advert dismissal failed; check the game manually');
                }
                schedule();
                return true;
            }
            if (modals.includes(action.confirmation)) {
                update('Waiting for advert dismissal');
                return true;
            }
        } else if (action.needsConfirmation && !action.confirmation) {
            update('Advert needs manual dismissal; no matching confirmation found');
            pending = null;
            return true;
        } else if (modals.includes(action.modal)) {
            update(time.gameTime() - action.since >= 10000
                ? 'Popup still open; check the game manually' : status.message);
            return true;
        }
        if (action.type === 'advert' && !action.failed
            && (!action.confirmation || action.submitted)) {
            status.advertsDismissed++;
        }
        pending = null;
        update(watching);
        return false;
    };

    const check = function () {
        if (!running) {
            return;
        }
        // ng-click invokes $apply; defer until the current digest has finished.
        if ($rootScope.$$phase) {
            schedule();
            return;
        }
        const modals = windowManagerService.getModals();
        if (checkPending(modals) || !modals.length) {
            return;
        }
        const modal = modals[0];
        const root = modal.rootnode;
        if (!root || !root.isConnected || !root.getClientRects().length) {
            return;
        }
        if (modal.templateName === 'modal_daily_login_bonus' && settings.get('claim_daily')) {
            const panel = root.querySelector('[ng-controller="' + DAILY + '"]');
            const scope = panel && angular.element(panel).scope();
            if (!scope || scope.$$destroyed || !scope.data || ![false, 0].includes(scope.data.reward_collected)
                || !Number.isInteger(scope.currentDay) || scope.currentDay < 1
                || scope.currentDay !== scope.data.login_chain || !Array.isArray(scope.rewards)
                || scope.currentDay > scope.rewards.length || attempted.has(scope)) {
                return;
            }
            if (scope.selectedDay !== scope.currentDay) {
                const today = controls(panel, 'selectDay(n + 1)').find(function (button) {
                    const row = angular.element(button).scope();
                    return row && row.n + 1 === scope.currentDay;
                });
                if (today) {
                    click(today, scope, 'select', modal);
                }
                return;
            }
            const reward = controls(panel, 'claimReward()')[0];
            if (reward) {
                click(reward, scope, 'claim', modal);
            }
        } else if (modal.templateName === 'modal_interstitial' && settings.get('close_ads')) {
            const panel = root.querySelector('[ng-controller="' + ADVERT + '"]');
            const scope = panel && angular.element(panel).scope();
            const promotion = scope && scope.interstitial;
            if (!scope || scope.$$destroyed || attempted.has(scope) || !promotion
                || !['cashShop', 'cashShopPackageTab', 'itemShop', 'inventory', 'options', 'uri', 'none'].includes(promotion.cta_type)) {
                return;
            }
            const close = controls(panel, 'closeWindow()')[0];
            if (close) {
                click(close, scope, 'advert', modal);
            }
        }
    };

    const tracker = {
        init: function () {
            if (initialized) {
                return false;
            }
            settings = new Settings({settingsMap, storageKey: 'daily_popups_settings'});
            settings.store();
            settings.onChange(schedule);
            [eventTypeProvider.WINDOW_OPENED,
                eventTypeProvider.WINDOW_CLOSED,
                eventTypeProvider.INTERSTITIALS_RECEIVED].filter(Boolean).forEach(function (event) {
                $rootScope.$on(event, schedule);
            });
            initialized = true;
        },
        start: function () {
            if (!initialized || running) {
                return false;
            }
            running = true;
            update(watching);
            intervalId = setInterval(check, 2000);
            eventQueue.trigger(START);
            check();
        },
        stop: function () {
            if (!running) {
                return false;
            }
            running = false;
            clearInterval(intervalId);
            clearTimeout(checkId);
            update('Paused');
            eventQueue.trigger(STOP);
        },
        getSettings: () => settings,
        getStatus: () => angular.copy(status),
        isInitialized: () => initialized,
        isRunning: () => running
    };
    return tracker;
});
