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

// Each included module initializes itself from its own src/init.js.
