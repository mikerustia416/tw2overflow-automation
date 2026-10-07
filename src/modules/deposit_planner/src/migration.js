define('two/depositPlanner/migrate', ['Lockr'], function (Lockr) {
    return function () {
        if (Lockr.get('deposit_planner_unified', false)) {
            return;
        }
        const saved = Lockr.get('deposit_planner_settings', {});
        const active = Lockr.get('deposit_planner_active', null);
        const legacyActive = Lockr.get('auto_collector_active', false) === true;
        // A running legacy preview must not become an automatic game session.
        const resume = active === true ? saved.preview_only === false : active === false ? false : legacyActive;
        if (active === null && legacyActive) {
            // Collector previously spent no reroll items, even if a draft planner did.
            saved.auto_reroll = false;
        }
        delete saved.preview_only;
        Lockr.set('deposit_planner_settings', saved);
        Lockr.set('deposit_planner_active', resume);
        if (Lockr.get('auto_collector_second_village_active', null) === null) {
            Lockr.set('auto_collector_second_village_active', legacyActive);
        }
        Lockr.set('auto_collector_active', false);
        Lockr.set('deposit_planner_unified', true);
    };
});
