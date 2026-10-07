require([
    'two/ready',
    'two/autoQuest',
    'two/autoQuest/ui',
    'two/moduleState',
    'two/autoQuest/events'
], function (
    ready,
    autoQuest,
    autoQuestInterface,
    restoreModuleState
) {
    if (autoQuest.isInitialized()) {
        return false;
    }

    ready(function () {
        autoQuest.init();
        autoQuestInterface();
        restoreModuleState(autoQuest, 'auto_quest_active', eventTypeProvider.AUTO_QUEST_START, eventTypeProvider.AUTO_QUEST_STOP);
    }, ['map']);
});
