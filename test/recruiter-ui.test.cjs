const assert = require('node:assert/strict');
const test = require('node:test');
const {fixture} = require('./farm-fixture.cjs');

function uiFixture () {
    const f = fixture({deferFarmInit: true, villageIds: [1, 2]});
    let click;
    let scope;
    let starts = 0;
    let running = false;
    let previews = 0;
    let destroy;
    const pending = {};
    const resolutions = [];
    const notifications = [];
    f.context.$rootScope.$new = () => ({$watch: () => {}, $on: () => {}, $evalAsync: fn => fn()});
    f.context.modelDataService.getSelectedVillage = () => f.villages[1];
    f.context.modelDataService.getGameData = () => ({getUnitsObject: () => ({spear: {building: 'barracks'}, axe: {building: 'barracks'}}),
        getBuildings: () => ({farm: {max_level: 30}})});
    f.context.windowManagerService = {getScreenWithInjectedScope: (name, value) => {scope = value;}};
    f.get('two/utils').notif = (kind, text) => notifications.push({kind, text});
    f.setModule('two/EventScope', class {constructor (name, callback) {destroy = callback;} register () {}});
    f.setModule('two/ui', {addMenuButton: () => ({classList: {toggle: () => {}},
        addEventListener: (name, listener) => {click = listener;}}), addTemplate: () => {}, addStyle: () => {}});
    for (const file of ['settings', 'policy']) f.loadSource('src/modules/recruiter/src/' + file + '.js');
    const settings = new (f.get('two/Settings'))({settingsMap: f.get('two/recruiter/settings/map'), storageKey: 'recruiter_ui'});
    const getSettings = id => f.get('two/villageSettings')(settings, id, ['check_interval', 'enabled_groups']);
    f.setModule('two/recruiter', {getSettings, isRunning: () => running, getPlans: () => [], getPending: () => pending,
        resolvePending: id => {resolutions.push(id); delete pending[id]; return true;},
        preview: () => {previews++;}, status: 'Stopped', start: () => {starts++; return true;}});
    f.loadSource('src/modules/recruiter/src/interface.js');
    f.get('two/recruiter/ui')();
    click();
    return {...f, previews: () => previews, destroy: () => destroy(), scope, settings, getSettings, notifications, click, currentScope: () => scope, starts: () => starts, pending, resolutions, setRunning: value => {running = value;}};
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

test('Recruiter UI default edits apply to unsaved villages, reset removes only selected profile, and timing stays shared', () => {
    const f = uiFixture();
    f.scope.units[0].target = 100;
    f.scope.save();
    f.scope.profileVillage = '';
    f.scope.selectVillage();
    f.scope.units[0].target = 50;
    f.scope.settings.check_interval = '10 seconds';
    f.scope.save();
    f.scope.profileVillage = '2';
    f.scope.selectVillage();
    assert.equal(f.scope.units[0].target, 50);
    assert.equal(f.scope.settings.check_interval, '10 seconds');
    f.scope.profileVillage = '1';
    f.scope.selectVillage();
    assert.equal(f.scope.units[0].target, 100);
    f.scope.useDefaults();
    assert.equal(f.scope.units[0].target, 50);
    assert.equal(f.settings.get('village_profiles')['1'], undefined);
});

test('invalid recruiter UI inputs cannot save a profile or partially change shared timing', () => {
    const f = uiFixture();
    f.scope.units[0].target = -1;
    f.scope.settings.check_interval = '10 seconds';
    f.scope.toggle();
    assert.equal(f.starts(), 0);
    assert.equal(f.settings.get('check_interval'), 60000);
    assert.equal(Object.keys(f.settings.get('village_profiles')).length, 0);
    assert.equal(f.notifications.at(-1).kind, 'error');
});


test('pending recovery opens an inline confirmation and clears only the checked village', () => {
    const f = uiFixture();
    f.pending[1] = {unit: 'spear', amount: 1};
    f.pending[2] = {unit: 'axe', amount: 2};
    f.scope.resolvePending(1);
    assert.equal(f.scope.pendingToResolve, '1');
    assert.deepEqual(f.resolutions, []);
    f.scope.cancelPendingResolution();
    assert.equal(f.scope.pendingToResolve, null);
    assert.ok(f.pending[1]);
    f.scope.resolvePending(1);
    assert.equal(f.scope.confirmPendingResolution(), true);
    assert.deepEqual(f.resolutions, ['1']);
    assert.equal(f.pending[1], undefined);
    assert.ok(f.pending[2]);
    assert.equal(f.scope.pendingToResolve, null);
    assert.equal(f.scope.confirmPendingResolution(), false);
    assert.equal(f.starts(), 0, 'Recovery itself never starts recruitment');
});

test('pending recovery cannot clear a guard after recruitment starts or the guard disappears', () => {
    const f = uiFixture();
    f.pending[1] = {unit: 'spear', amount: 1};
    f.setRunning(true);
    f.scope.resolvePending(1);
    assert.equal(f.scope.pendingToResolve, null);
    f.setRunning(false);
    f.scope.resolvePending(1);
    f.setRunning(true);
    assert.equal(f.scope.confirmPendingResolution(), false);
    assert.ok(f.pending[1]);
    f.setRunning(false);
    f.scope.resolvePending(1);
    delete f.pending[1];
    assert.equal(f.scope.confirmPendingResolution(), false);
    assert.deepEqual(f.resolutions, []);
});

test('Recruiter UI shows a preview immediately, removes the switch and stops polling when closed', async () => {
    const f = uiFixture();
    assert.equal(f.previews(), 1);
    assert.equal(f.scope.controls.includes('preview_only'), false);
    assert.equal(f.scope.settings.preview_only, undefined);
    await f.tick(5000);
    assert.equal(f.previews(), 2);
    f.scope.refreshPreview();
    assert.equal(f.previews(), 3);
    f.destroy();
    await f.tick(5000);
    assert.equal(f.previews(), 3);
    assert.equal(f.starts(), 0);
});
