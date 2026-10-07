const assert = require('node:assert/strict');
const test = require('node:test');
const {fixture} = require('./farm-fixture.cjs');

function uiFixture () {
    const f = fixture({deferFarmInit: true});
    const notifications = [];
    let click;
    let scope;
    let starts = 0;
    let running = false;
    f.context.modelDataService.getWorldConfig = () => ({isResourceDepositEnabled: () => true});
    f.context.$rootScope.$new = () => ({$on: () => {}, $evalAsync: fn => fn()});
    f.context.windowManagerService = {getScreenWithInjectedScope: (name, value) => {scope = value;}};
    f.get('two/utils').notif = (kind, text) => notifications.push({kind, text});
    f.setModule('two/EventScope', class {register () {}});
    f.setModule('two/ui', {addMenuButton: () => ({classList: {toggle: () => {}},
        addEventListener: (name, listener) => {click = listener;}}), addTemplate: () => {}, addStyle: () => {}});
    for (const name of ['settings', 'policy']) f.loadSource('src/modules/deposit_planner/src/' + name + '.js');
    const settings = new (f.get('two/Settings'))({settingsMap: f.get('two/depositPlanner/settings/map'), storageKey: 'planner_ui'});
    f.setModule('two/depositPlanner', {
        isRunning: () => running, getSettings: () => settings, getStatus: () => 'Paused',
        getPlan: () => ({jobs: []}), getPending: () => null, refresh: () => {},
        start: () => {starts++; running = true; return true;}, stop: () => {running = false;}
    });
    f.loadSource('src/modules/deposit_planner/src/interface.js');
    f.get('two/depositPlanner/ui')();
    click();
    return {...f, scope, settings, notifications, starts: () => starts};
}

test('preview Start accepts boolean switches and both forecast percentage boundaries', () => {
    for (const percent of [10, 20, 50, 70, 100]) {
        const f = uiFixture();
        f.scope.settings.preview_only = true;
        f.scope.settings.auto_reroll = true;
        f.scope.settings.success_percent = percent;
        f.scope.toggle();
        assert.equal(f.starts(), 1);
        assert.equal(f.settings.get('preview_only'), true);
        assert.equal(f.settings.get('success_percent'), percent);
        assert.equal(Object.keys(f.scope.settingErrors).length, 0);
    }
});

test('invalid forecast values identify the field and range without saving or starting', () => {
    for (const value of [9, 0, 101, 10.5, undefined, null, '70', NaN]) {
        const f = uiFixture();
        f.scope.settings.success_percent = value;
        f.scope.toggle();
        assert.equal(f.starts(), 0);
        assert.equal(f.settings.get('success_percent'), 95);
        assert.match(f.scope.settingErrors.success_percent, /Desired forecast success.*whole number between 10 and 100/);
        assert.equal(f.notifications.at(-1).text, f.scope.settingErrors.success_percent);
    }
});

test('correcting an invalid Angular numeric model clears its error and permits preview Start', () => {
    const f = uiFixture();
    // Angular numeric range validation clears the model while the input still shows 9.
    f.scope.settings.success_percent = undefined;
    f.scope.toggle();
    assert.equal(f.starts(), 0);
    f.scope.settings.success_percent = 20;
    f.scope.clearSettingError('success_percent');
    assert.equal(f.scope.settingErrors.success_percent, undefined);
    f.scope.toggle();
    assert.equal(f.starts(), 1);
    assert.equal(f.settings.get('preview_only'), true);
    assert.equal(f.settings.get('success_percent'), 20);
});

test('all invalid fields are reported and automatic mode enforces the same limits', () => {
    const f = uiFixture();
    f.scope.settings.preview_only = false;
    f.scope.settings.success_percent = 9;
    f.scope.settings.poll_seconds = undefined;
    f.scope.toggle();
    assert.equal(f.starts(), 0);
    assert.match(f.scope.settingErrors.success_percent, /10 and 100/);
    assert.match(f.scope.settingErrors.poll_seconds, /Refresh interval.*5 and 300/);
    assert.equal(f.settings.get('preview_only'), true, 'Invalid Save cannot partially switch modes');
});

test('new depositor controls persist and minimum item value uses the same numeric validation', () => {
    const f = uiFixture();
    for (const id of ['confidence_guard', 'learn_action_delay', 'milestone_fallback', 'min_gain_per_item']) {
        assert.ok(f.scope.controls.includes(id));
        assert.ok(f.scope.labels[id]);
    }
    assert.equal(f.scope.settings.confidence_guard, true);
    assert.equal(f.scope.settings.learn_action_delay, true);
    assert.equal(f.scope.settings.milestone_fallback, false);
    f.scope.settings.milestone_fallback = true;
    f.scope.settings.min_gain_per_item = 500;
    f.scope.save();
    assert.equal(f.settings.get('milestone_fallback'), true);
    assert.equal(f.settings.get('min_gain_per_item'), 500);
    f.scope.settings.min_gain_per_item = -1;
    assert.equal(f.scope.save(), false);
    assert.match(f.scope.settingErrors.min_gain_per_item, /whole number between 0 and 1000000/);
    assert.equal(f.settings.get('min_gain_per_item'), 500);
});
