define('two/autoCollector/ui', [
    'two/ui', 'two/autoCollector/secondVillage', 'two/utils', 'queues/EventQueue'
], function (ui, secondVillage, utils, events) {
    let initialized = false;
    return function () {
        if (initialized || !secondVillage.isInitialized()) {
            return;
        }
        initialized = true;
        const button = ui.addMenuButton('Second Village', 50, 'Run and collect Second Village jobs independently of Deposit Planner');
        const update = function () {
            button.classList.toggle('btn-red', secondVillage.isRunning());
            button.classList.toggle('btn-orange', !secondVillage.isRunning());
        };
        button.addEventListener('click', function () {
            if (secondVillage.isRunning()) {
                secondVillage.stop();
                utils.notif('success', 'Second Village paused');
            } else if (secondVillage.start()) {
                utils.notif('success', 'Second Village started');
            }
            update();
        });
        events.register(eventTypeProvider.AUTO_COLLECTOR_SECONDVILLAGE_STARTED, update);
        events.register(eventTypeProvider.AUTO_COLLECTOR_SECONDVILLAGE_STOPPED, update);
        update();
    };
});
