define('two/depositPlanner/settings/map', [], function () {
    const number = (value, min, max) => ({default: value, updates: [], inputType: 'number', min, max});
    const checkbox = value => ({default: value, updates: [], inputType: 'checkbox'});
    return {
        preview_only: checkbox(true),
        auto_reroll: checkbox(false),
        target: number(0, 0, 1000000),
        max_rerolls: number(3, 0, 20),
        reserve_items: number(1, 0, 10000),
        free_refresh_wait: number(600, 0, 28800),
        deadline_buffer: number(60, 5, 3600),
        action_delay: number(2, 1, 60),
        success_percent: number(95, 10, 100),
        min_improvement: number(5, 1, 100),
        min_samples: number(5, 1, 30),
        poll_seconds: number(30, 5, 300),
        hold_after_target: checkbox(true)
    };
});
