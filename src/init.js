require([
    'two/language',
    'two/ready'
], function (
    twoLanguage,
    ready
) {
    ready(function () {
        twoLanguage.init();
    });
});

// Load core modules immediately
require([
    'two/farmOverflow',
    'two/builderQueue',
    'two/autoQuest',
    'two/ui'
], function (
    farmOverflow,
    builderQueue,
    autoQuest,
    interfaceOverflow
) {
    // Initialize modules as soon as possible
    if (farmOverflow && !farmOverflow.isInitialized()) {
        farmOverflow.init();
    }
    
    if (builderQueue && !builderQueue.isInitialized()) {
        builderQueue.init();
    }
    
    if (autoQuest && !autoQuest.isInitialized()) {
        autoQuest.init();
    }
});
