define('two/depositPlanner/ui', [
    'two/ui', 'two/depositPlanner', 'two/depositPlanner/policy', 'two/EventScope', 'two/utils', 'queues/EventQueue'
], function (ui, planner, policy, EventScope, utils, events) {
    const labels = {
        preview_only: 'Preview only (no game actions)', auto_reroll: 'Allow automatic item rerolls',
        confidence_guard: 'Use cautious forecast bands for automatic rerolls',
        learn_action_delay: 'Learn start/collection overhead from confirmed errands',
        milestone_fallback: 'Plan a lower attainable milestone when the target is unlikely',
        min_gain_per_item: 'Minimum extra expected progress per reroll item',
        target: 'Target progress (0 = final milestone)', max_rerolls: 'Maximum rerolls per milestone cycle',
        reserve_items: 'Reroll items to keep', free_refresh_wait: 'Prefer a free refresh within (seconds)',
        deadline_buffer: 'Buffer before reset deadlines (seconds)', action_delay: 'Estimated start/collection overhead per errand (seconds)',
        success_percent: 'Desired forecast success (%)', min_improvement: 'Minimum gain to reroll now (percentage points)',
        min_samples: 'Complete observed boards required for forecasts', poll_seconds: 'Refresh interval (seconds)',
        hold_after_target: 'Hold completed errands after reaching the target'
    };
    return function () {
        if (!modelDataService.getWorldConfig().isResourceDepositEnabled()) {
            return;
        }
        const button = ui.addMenuButton('Deposit Planner', 51, 'Optimize deposit rewards, free resets and item rerolls');
        const updateButton = function () {
            button.classList.toggle('btn-red', planner.isRunning());
            button.classList.toggle('btn-orange', !planner.isRunning());
        };
        events.register('two_deposit_planner_updated', updateButton);
        updateButton();
        ui.addTemplate('two_deposit_planner_window', `___deposit_planner_html_main`);
        ui.addStyle('___deposit_planner_css_style');
        button.addEventListener('click', function () {
            const scope = $rootScope.$new();
            const settings = planner.getSettings();
            const map = settings.settingsMap;
            settings.injectScope(scope);
            scope.labels = labels;
            scope.map = map;
            scope.controls = Object.keys(labels);
            scope.seconds = function (seconds) {
                if (!Number.isFinite(seconds)) {
                    return 'Unknown';
                }
                const value = Math.max(0, Math.ceil(seconds));
                return Math.floor(value / 3600) + 'h ' + Math.floor(value % 3600 / 60) + 'm ' + value % 60 + 's';
            };
            scope.until = timestamp => Number.isFinite(timestamp) ? scope.seconds(timestamp - Date.now() / 1000) : 'Unknown';
            scope.date = timestamp => Number.isFinite(timestamp) ? new Date(timestamp * 1000).toLocaleString() : 'Not established';
            scope.percent = probability => Number.isFinite(probability) ? (probability * 100).toFixed(1) + '%' : 'Unknown';
            scope.localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            const update = function () {
                scope.running = planner.isRunning();
                scope.status = planner.getStatus();
                scope.plan = planner.getPlan();
                scope.pending = planner.getPending();
                const state = scope.plan.state;
                scope.state = state;
                scope.reward = state && state.milestones.find(item => item.target >= state.target);
                let eta = state ? state.now : Date.now() / 1000;
                scope.jobs = scope.plan.jobs.map(job => {
                    eta += job.duration + (scope.plan.timing ? scope.plan.timing.effectiveDelay : settings.get('action_delay'));
                    return {...job, eta};
                });
            };
            scope.settingErrors = {};
            scope.clearSettingError = id => {
                delete scope.settingErrors[id];
            };
            scope.save = function () {
                const values = settings.decode(scope.settings);
                const invalid = policy.invalidSettings(values, map);
                scope.settingErrors = Object.fromEntries(invalid.map(id => [id, map[id].inputType === 'checkbox'
                    ? labels[id] + ' must be on or off'
                    : labels[id] + ' must be a whole number between ' + map[id].min + ' and ' + map[id].max]));
                if (invalid.length) {
                    utils.notif('error', scope.settingErrors[invalid[0]]);
                    return false;
                }
                settings.setAll(values);
                update();
                utils.notif('success', 'Deposit Planner settings saved');
                return true;
            };
            scope.toggle = function () {
                if (planner.isRunning()) {
                    planner.stop();
                } else if (scope.save() && !planner.start()) {
                    utils.notif('error', 'Deposit Planner could not start; check settings and world availability');
                }
                update();
            };
            scope.refresh = () => planner.refresh();
            scope.resolvePending = function () {
                const modal = $rootScope.$new();
                modal.title = 'Resolve pending deposit action';
                modal.text = 'Check the active/completed errand, deposit progress and reroll inventory in the game first. Clearing this guard permits another action and can repeat an earlier request if game data is stale. The reserved reroll budget stays charged.';
                modal.submitText = 'I checked the game; clear guard';
                modal.cancelText = 'Cancel';
                modal.submit = function () {
                    modal.closeWindow(); planner.resolvePending(); update();
                };
                modal.cancel = () => modal.closeWindow();
                windowManagerService.getModal('modal_attention', modal);
            };
            const timer = setInterval(() => scope.$evalAsync(() => {
                if (!scope.$$destroyed) {
                    update();
                }
            }), 1000);
            const eventScope = new EventScope('two_deposit_planner_window', () => clearInterval(timer));
            eventScope.register('two_deposit_planner_updated', () => scope.$evalAsync(() => {
                if (!scope.$$destroyed) {
                    update();
                }
            }));
            scope.$on('$destroy', () => clearInterval(timer));
            update();
            windowManagerService.getScreenWithInjectedScope('!two_deposit_planner_window', scope);
            planner.refresh();
        });
    };
});
