const assert = require('node:assert/strict');
const test = require('node:test');
const {fixture} = require('./farm-fixture.cjs');

function uiFixture () {
    const f = fixture({deferFarmInit: true, villageIds: [1, 2]});
    let click;
    let scope;
    let starts = 0;
    const notifications = [];
    f.context.$rootScope.$new = () => ({$watch: () => {}, $on: () => {}, $evalAsync: fn => fn()});
    f.context.modelDataService.getSelectedVillage = () => f.villages[1];
    f.context.modelDataService.getGameData = () => ({getUnitsObject: () => ({spear: {building: 'barracks'}, axe: {building: 'barracks'}}),
        getBuildings: () => ({farm: {max_level: 30}})});
    f.context.windowManagerService = {getScreenWithInjectedScope: (name, value) => {scope = value;}};
    f.get('two/utils').notif = (kind, text) => notifications.push({kind, text});
    f.setModule('two/EventScope', class {register () {}});
    f.setModule('two/ui', {addMenuButton: () => ({classList: {toggle: () => {}},
        addEventListener: (name, listener) => {click = listener;}}), addTemplate: () => {}, addStyle: () => {}});
    for (const file of ['settings', 'policy']) f.loadSource('src/modules/recruiter/src/' + file + '.js');
    const settings = new (f.get('two/Settings'))({settingsMap: f.get('two/recruiter/settings/map'), storageKey: 'recruiter_ui'});
    const getSettings = id => f.get('two/villageSettings')(settings, id, ['preview_only', 'check_interval', 'enabled_groups']);
    f.setModule('two/recruiter', {getSettings, isRunning: () => false, getPlans: () => [], getPending: () => ({}),
        status: 'Stopped', start: () => {starts++; return true;}});
    f.loadSource('src/modules/recruiter/src/interface.js');
    f.get('two/recruiter/ui')();
    click();
    return {...f, scope, settings, getSettings, notifications, click, currentScope: () => scope, starts: () => starts};
}

test('Recruiter UI opens current village, switches profiles, and saves separate targets and protected upgrades', () => {
    const f = uiFixture();
    assert.equal(f.scope.profileVillage, '1');
    f.scope.units[0].target = 100;
    f.scope.settings.preserve_wood = 3000;
    f.scope.buildings[0].enabled = true;
    assert.equal(f.scope.save(), true);
    f.scope.profileVillage = '2';
    f.scope.selectVillage();
    assert.equal(f.scope.units[0].target, 0);
    assert.equal(f.scope.settings.preserve_wood, 5000);
    f.scope.units[1].target = 200;
    f.scope.settings.preserve_wood = 1000;
    f.scope.save();
    f.scope.profileVillage = '1';
    f.scope.selectVillage();
    assert.equal(f.scope.units[0].target, 100);
    assert.equal(f.scope.units[1].target, 0);
    assert.equal(f.scope.buildings[0].enabled, true);
    assert.equal(f.scope.settings.preserve_wood, 3000);
    f.click();
    assert.equal(f.currentScope().units[0].target, 100);
});

test('Recruiter UI default edits apply to unsaved villages, reset removes only selected profile, and mode stays shared', () => {
    const f = uiFixture();
    f.scope.units[0].target = 100;
    f.scope.save();
    f.scope.profileVillage = '';
    f.scope.selectVillage();
    f.scope.units[0].target = 50;
    f.scope.settings.preview_only = false;
    f.scope.save();
    f.scope.profileVillage = '2';
    f.scope.selectVillage();
    assert.equal(f.scope.units[0].target, 50);
    assert.equal(f.scope.settings.preview_only, false);
    f.scope.profileVillage = '1';
    f.scope.selectVillage();
    assert.equal(f.scope.units[0].target, 100);
    f.scope.useDefaults();
    assert.equal(f.scope.units[0].target, 50);
    assert.equal(f.settings.get('village_profiles')['1'], undefined);
});

test('invalid recruiter UI inputs cannot save a profile or partially change global mode', () => {
    const f = uiFixture();
    f.scope.units[0].target = -1;
    f.scope.settings.preview_only = false;
    f.scope.toggle();
    assert.equal(f.starts(), 0);
    assert.equal(f.settings.get('preview_only'), true);
    assert.equal(Object.keys(f.settings.get('village_profiles')).length, 0);
    assert.equal(f.notifications.at(-1).kind, 'error');
});
