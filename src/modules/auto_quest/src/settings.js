define('two/autoQuest/settings', [], function () {
    return {
        ENABLED: 'enabled',
        CHECK_INTERVAL: 'check_interval'
    };
});

define('two/autoQuest/settings/updates', function () {
    return {
        ENABLED: 'enabled',
        CHECK_INTERVAL: 'check_interval'
    };
});

define('two/autoQuest/settings/map', [
    'two/autoQuest/settings',
    'two/autoQuest/settings/updates'
], function (SETTINGS, UPDATES) {
    return {
        [SETTINGS.ENABLED]: {
            default: true,
            updates: [UPDATES.ENABLED],
            inputType: 'checkbox'
        },
        [SETTINGS.CHECK_INTERVAL]: {
            default: '30 seconds',
            updates: [UPDATES.CHECK_INTERVAL],
            inputType: 'readable_time',
            min: '5 seconds',
            max: '5 minutes'
        }
    };
});
