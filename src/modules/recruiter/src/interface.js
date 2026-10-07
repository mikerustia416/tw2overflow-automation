define('two/recruiter/ui', [
    'two/ui', 'two/recruiter', 'two/recruiter/policy', 'two/Settings', 'two/EventScope', 'two/utils', 'humanInterval', 'queues/EventQueue'
], function (ui, recruiter, policy, Settings, EventScope, utils, humanInterval, eventQueue) {
    const labels = {
        preview_only: 'Preview only', check_interval: 'Check interval', spend_percent: 'Maximum share of spendable resources per cycle (%)',
        max_batch: 'Maximum soldiers per batch', max_queue_jobs: 'Maximum barracks queue jobs',
        preserve_wood: 'Wood savings', preserve_clay: 'Clay savings', preserve_iron: 'Iron savings', preserve_food: 'Free population to preserve',
        building_wood: 'Additional wood budget for buildings', building_clay: 'Additional clay budget for buildings',
        building_iron: 'Additional iron budget for buildings', building_food: 'Additional population budget for buildings'
    };
    return function () {
        const button = ui.addMenuButton('Recruiter', 50);
        const updateButton = function () {
            button.classList.toggle('btn-red', recruiter.isRunning());
            button.classList.toggle('btn-orange', !recruiter.isRunning());
        };
        eventQueue.register('two_recruiter_updated', updateButton);
        updateButton();
        ui.addTemplate('two_recruiter_window', `___recruiter_html_main`);
        ui.addStyle('___recruiter_css_style');
        button.addEventListener('click', function () {
            const scope = $rootScope.$new();
            const settings = recruiter.getSettings();
            const map = settings.settingsMap;
            const units = modelDataService.getGameData().getUnitsObject();
            const buildings = modelDataService.getGameData().getBuildings();
            settings.injectScope(scope);
            scope.labels = labels;
            scope.map = map;
            scope.controls = Object.keys(labels);
            scope.groups = Settings.encodeList(modelDataService.getGroupList().getGroups(), {disabled: false, type: 'groups'});
            scope.units = Object.entries(units).filter(([name, data]) => data.building === 'barracks')
                .map(([name]) => ({name, target: settings.get('targets')[name] || 0}));
            scope.buildings = Object.keys(buildings).map(name => ({name, enabled: settings.get('protect_buildings').includes(name)}));
            const update = function () {
                scope.running = recruiter.isRunning();
                scope.status = recruiter.status;
                scope.plans = recruiter.getPlans();
                scope.pending = recruiter.getPending();
                updateButton();
            };
            scope.save = function () {
                const values = settings.decode(scope.settings);
                values.targets = Object.fromEntries(scope.units.map(unit => [unit.name, unit.target]));
                values.protect_buildings = scope.buildings.filter(building => building.enabled).map(building => building.name);
                const parsed = {...values, check_interval: humanInterval(values.check_interval)};
                if (!policy.validSettings(parsed, map, units, buildings)) {
                    utils.notif('error', 'Use whole, non-negative troop counts and budgets. Check interval must be 10 seconds to 24 hours.');
                    return false;
                }
                settings.setAll(values);
                utils.notif('success', 'Recruiter settings saved');
                return true;
            };
            scope.toggle = function () {
                if (recruiter.isRunning()) {
                    recruiter.stop();
                } else if (scope.save()) {
                    if (!recruiter.start()) {
                        utils.notif('error', 'Recruiter could not start; check settings');
                    }
                }
                update();
            };
            scope.resolvePending = function (villageId) {
                const modal = $rootScope.$new();
                modal.title = 'Resolve pending recruitment';
                modal.text = 'Check the village barracks queue, owned troop totals, and resources in the game first. Clearing this guard allows another batch and may repeat an earlier order if game data is still stale.';
                modal.submitText = 'I checked the game; clear guard';
                modal.cancelText = 'Cancel';
                modal.submit = function () {
                    modal.closeWindow();
                    recruiter.resolvePending(villageId);
                    update();
                };
                modal.cancel = () => modal.closeWindow();
                windowManagerService.getModal('modal_attention', modal);
            };
            update();
            const events = new EventScope('two_recruiter_window', noop);
            events.register('two_recruiter_updated', () => scope.$evalAsync(() => {
                if (!scope.$$destroyed) {
                    update();
                }
            }));
            windowManagerService.getScreenWithInjectedScope('!two_recruiter_window', scope);
        });
    };
});
