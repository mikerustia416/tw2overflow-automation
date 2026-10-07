require(['two/ready', 'two/recruiter', 'two/recruiter/ui', 'two/moduleState'], function (ready, recruiter, ui, restoreModuleState) {
    ready(function () {
        if (!recruiter.isInitialized()) {
            recruiter.init();
            ui();
            restoreModuleState(recruiter, 'recruiter_active', 'two_recruiter_start', 'two_recruiter_stop');
        }
    }, 'all_villages_ready');
});
