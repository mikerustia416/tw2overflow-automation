const assert = require('node:assert/strict');
const test = require('node:test');
const {fixture} = require('./farm-fixture.cjs');

function builderUI () {
    const f = fixture({deferFarmInit: true, villageIds: [1, 2]});
    let click;
    let scope;
    let modal;
    f.events.GROUPS_UPDATED = 'groups_updated';
    f.events.GROUPS_CREATED = 'groups_created';
    const groups = {10: {id: 10, name: 'Resource'}, 11: {id: 11, name: 'Offensive'}};
    const links = {10: [1], 11: []};
    const types = {HEADQUARTER: 'headquarter', BARRACKS: 'barracks', FARM: 'farm', WAREHOUSE: 'warehouse', TIMBER_CAMP: 'timber_camp'};
    const library = {Essential: ['barracks', 'warehouse', 'farm', 'timber_camp'],
        Resource: ['timber_camp', 'warehouse'], Offensive: ['barracks', 'farm'], Defensive: ['farm', 'barracks']};
    const buildings = Object.fromEntries(Object.values(types).map(name => [name, {max_level: 30, points: 1, points_factor: 1.2,
        individual_level_costs: Object.fromEntries(Array.from({length: 30}, (unused, index) => [index + 1, {wood: 100, clay: 100, iron: 100, food: 0, build_time: 100}]))}]));
    f.context.$rootScope.$new = () => { const watches = []; return {$watch: (expr, handler) => watches.push({expr, handler}), watches, $on: () => {}, $evalAsync: fn => fn()}; };
    f.context.modelDataService.getSelectedVillage = () => f.villages[1];
    f.context.modelDataService.getGroupList = () => ({getGroups: () => groups, getGroupVillageIds: id => links[id] || []});
    f.context.modelDataService.getGameData = () => ({data: {buildings}, getBuildings: () => buildings, getBuildingDataForBuilding: name => buildings[name]});
    f.context.injector = {get: name => ({buildingService: {compute: () => {}}, premiumActionService: {}, buildingQueueService: {canBeFinishedForFree: () => false}}[name])};
    f.context.windowManagerService = {getModal: (name, value) => {modal = value; modal.closeWindow = () => {};}, getScreenWithInjectedScope: (name, value) => {scope = value; scope.closeWindow = () => {};}};
    f.context.windowDisplayService = {openVillageInfo: () => {}};
    f.context.storageService = {getPaginationLimit: () => 10};
    f.setModule('helper/time', {gameTime: () => 0, readableSeconds: value => value + 's'});
    f.setModule('conf/buildingTypes', types);
    f.setModule('conf/locationTypes', {});
    f.setModule('conf/upgradeabilityStates', {POSSIBLE: 'possible', NOT_ENOUGH_FOOD: 'food', NOT_ENOUGH_RESOURCES: 'resources'});
    f.setModule('two/builderQueue/defaultOrders', library);
    f.setModule('two/EventScope', class {register (name, fn) {f.rootScope.$on(name, fn);}});
    f.setModule('two/ui', {addMenuButton: () => ({classList: {remove: () => {}, add: () => {}},
        addEventListener: (name, fn) => {click = fn;}}), addTemplate: () => {}, addStyle: () => {}});
    for (const village of Object.values(f.villages)) {
        const levels = Object.fromEntries(Object.values(types).map(name => [name, 0]));
        village.checkReadyState = () => ({buildingQueue: true, buildings: true});
        village.buildingQueue = {getQueue: () => [], getAmountJobs: () => 0, getUnlockedSlots: () => 2};
        village.getBuildingQueue = () => village.buildingQueue;
        village.getBuildingData = () => ({getBuildingLevels: () => levels, getBuildingLevel: name => levels[name],
            getDataForBuilding: name => ({level: levels[name], upgradeability: name === 'barracks' ? 'resources' : 'possible',
                nextLevelCosts: {wood: name === 'barracks' ? 5000 : 100, clay: 100, iron: 100, food: 0, build_time: '100'}})});
        village.getResources = () => ({getComputed: () => Object.fromEntries(['wood', 'clay', 'iron', 'food'].map(type => [type, {currentStock: type === 'food' ? 100 : 1000}])),
            getMaxStorage: () => 10000, getProductionRates: () => ({wood: {current: 3600}, clay: {current: 3600}, iron: {current: 3600}})});
    }
    f.loadSource('src/resource-budget.js');
    for (const file of ['settings', 'events', 'types', 'label-policy', 'core', 'interface']) f.loadSource('src/modules/builder_queue/src/' + file + '.js');
    f.get('two/builderQueue/events');
    const builder = f.get('two/builderQueue');
    builder.init();
    f.get('two/builderQueue/ui')();
    click();
    const activeChange = (newValue, oldValue) => scope.watches.find(watch => watch.expr === 'settings[SETTINGS.ACTIVE_SEQUENCE].value').handler(newValue, oldValue);
    return {...f, builder, scope, click, groups, links, currentScope: () => scope, currentModal: () => modal, activeChange};
}

test('Builder UI opens selected village and renders the label-selected sequence without submitting upgrades', () => {
    const f = builderUI();
    assert.equal(f.scope.profileVillage, '1');
    assert.equal(f.scope.settingsView.plan.sequence, 'Resource');
    assert.equal(f.scope.settingsView.plan.groupName, 'Resource');
    assert.deepEqual(Array.from(f.scope.settingsView.buildingSequence, item => item.building), ['timber_camp', 'warehouse']);
    assert.equal(f.requests.length, 0);
});

test('Builder UI saves per-village reserves, manual choice, and re-enables label following across windows', () => {
    const f = builderUI();
    f.scope.settings.preserve_wood = 300;
    f.scope.settings.building_sequence = {name: 'Offensive', value: 'Offensive'};
    f.activeChange('Offensive', 'Essential');
    assert.equal(f.scope.settings.follow_village_labels, false);
    f.scope.saveSettings();
    f.scope.profileVillage = '2';
    f.scope.selectVillage();
    f.activeChange('Essential', 'Offensive');
    assert.equal(f.scope.settings.follow_village_labels, true, 'Switching profiles must not count as a manual sequence edit');
    assert.equal(f.scope.settings.preserve_wood, 0);
    f.scope.settings.preserve_wood = 600;
    f.scope.saveSettings();
    f.click();
    const reopened = f.currentScope();
    assert.equal(reopened.settings.preserve_wood, 300);
    assert.equal(reopened.settingsView.plan.sequence, 'Offensive');
    reopened.settings.follow_village_labels = true;
    reopened.followVillageLabels();
    assert.equal(reopened.settingsView.plan.sequence, 'Resource');
    reopened.saveSettings();
    assert.equal(f.builder.preview(1).sequence, 'Resource');
    assert.equal(f.builder.getSettings(2).get('preserve_wood'), 600);
    assert.equal(f.requests.length, 0);
});

test('Builder UI previews dynamic draft settings, updates effective sequence on label events and saves mappings globally', () => {
    const f = builderUI();
    f.scope.profileVillage = '2';
    f.scope.selectVillage();
    assert.equal(f.scope.settingsView.plan.building, null);
    f.scope.settings.dynamic_building = true;
    f.scope.settingsView.generateSequences();
    assert.equal(f.scope.settingsView.plan.building, 'timber_camp');
    assert.equal(f.scope.settingsView.plan.detour, true);
    assert.equal(f.builder.getSettings(2).get('dynamic_building'), false, 'Draft preview must not persist settings');
    f.scope.saveSettings();
    f.links[11] = [2];
    f.rootScope.$broadcast(f.events.GROUPS_VILLAGE_LINKED, {});
    assert.equal(f.scope.settingsView.plan.sequence, 'Essential');
    f.currentModal().submit();
    assert.equal(f.scope.settingsView.plan.sequence, 'Offensive');
    f.scope.settings.follow_village_labels = true;
    f.scope.followVillageLabels();
    f.scope.settings.label_sequence_mappings = [{group_id: '11', sequence: 'Defensive'}];
    f.scope.settingsView.generateSequences();
    assert.equal(f.scope.settingsView.plan.sequence, 'Defensive');
    f.scope.saveSettings();
    assert.equal(f.builder.preview(2).sequence, 'Defensive');
    assert.equal(f.builder.getSettings(1).get('label_sequence_mappings')[0].sequence, 'Defensive');
    assert.equal(f.requests.length, 0);
});

test('Builder creates a shared named sequence without saving village drafts and refreshes label preview', () => {
    const f = builderUI();
    f.groups[10].name = 'Starter Farm';
    f.rootScope.$broadcast(f.events.GROUPS_UPDATED, {});
    f.scope.settings.preserve_wood = 333;
    f.scope.createSequence();
    const modal = f.currentModal();
    modal.name = '   ';
    assert.equal(modal.submit(), false);
    modal.name = '  Starter Farm  ';
    modal.submit();
    assert.equal(f.scope.selectedTab, 'sequences');
    assert.equal(f.scope.editorView.selectedSequence.value, 'Starter Farm');
    assert.equal(f.scope.settingsView.plan.sequence, 'Starter Farm');
    assert.equal(f.builder.getSettings(1).get('follow_village_labels'), true);
    assert.equal(f.builder.getSettings(1).get('building_sequence'), 'Essential');
    assert.equal(f.builder.getSettings(1).get('preserve_wood'), 0);
    assert.equal(f.scope.settings.preserve_wood, 333);
    f.scope.editorView.addBuilding('farm', 2, 2);
    f.scope.editorView.updateBuildingSequence();
    assert.deepEqual(Array.from(f.storage.get('builder_queue_settings').building_orders['Starter Farm']), ['headquarter', 'farm', 'farm']);
    f.click();
    assert.equal(f.currentScope().settingsView.plan.sequence, 'Starter Farm');
    assert.equal(f.requests.length, 0);
});

test('Builder Save as new sequence saves current draft steps while preserving the original', () => {
    const f = builderUI();
    f.scope.editorView.addBuilding('farm', 1);
    f.scope.editorView.modal.nameSequence(true);
    const modal = f.currentModal();
    assert.equal(modal.name, 'Essential');
    modal.name = ' essential ';
    modal.submit();
    assert.equal(f.scope.editorView.selectedSequence.value, 'Essential');
    modal.name = '  Custom Village  ';
    modal.submit();
    const library = f.builder.getSettings().get('building_orders');
    assert.deepEqual(Array.from(library['Custom Village']), ['farm', 'barracks', 'warehouse', 'farm', 'timber_camp']);
    assert.deepEqual(Array.from(library.Essential), ['barracks', 'warehouse', 'farm', 'timber_camp']);
    assert.equal(f.scope.editorView.selectedSequence.value, 'Custom Village');
    f.scope.editorView.addBuilding('warehouse', 1);
    assert.equal(f.storage.get('builder_queue_settings').building_orders['Custom Village'].length, 5);
    assert.equal(f.requests.length, 0);
});

test('renamed labels prompt with the existing attention modal and cancel keeps the old sequence', () => {
    const f = builderUI();
    f.groups[10].name = 'Offensive';
    f.rootScope.$broadcast(f.events.GROUPS_UPDATED, {});
    const modal = f.currentModal();
    assert.equal(modal.title, 'Use matching building sequence?');
    assert.match(modal.text, /Village 1.*Offensive.*Resource/);
    assert.equal(modal.submitText, 'Use sequence');
    assert.equal(modal.cancelText, 'Keep current');
    assert.equal(f.builder.preview(1).sequence, 'Resource');
    modal.cancel();
    assert.equal(f.builder.preview(1).sequence, 'Resource');
    assert.equal(f.builder.getSequenceSuggestions().length, 0);
    f.rootScope.$broadcast(f.events.GROUPS_UPDATED, {});
    assert.equal(f.builder.getSequenceSuggestions().length, 0);
    assert.equal(f.requests.length, 0);
});

test('additional matching labels offer their sequence even when an existing role label takes precedence', () => {
    const f = builderUI();
    f.builder.addBuildingSequence('Starter Farm', ['farm']);
    f.groups[12] = {id: 12, name: ' starter farm '};
    f.links[12] = [1];
    f.rootScope.$broadcast(f.events.GROUPS_VILLAGE_LINKED, {});
    assert.match(f.currentModal().text, /Starter Farm/);
    assert.equal(f.builder.preview(1).sequence, 'Resource');
    f.scope.settings.preserve_wood = 333;
    f.currentModal().submit();
    assert.equal(f.builder.preview(1).sequence, 'Starter Farm');
    assert.equal(f.builder.getSettings(2).get('building_sequence'), 'Essential');
    assert.equal(f.scope.settings.preserve_wood, 333);
    assert.equal(f.builder.getSettings(1).get('preserve_wood'), 0);
    f.groups[12].name = 'Defensive';
    f.rootScope.$broadcast(f.events.GROUPS_UPDATED, {});
    assert.equal(f.builder.preview(1).sequence, 'Starter Farm');
    f.currentModal().closeWindow();
    assert.equal(f.builder.preview(1).sequence, 'Starter Farm');
    assert.equal(f.builder.getSequenceSuggestions().length, 0);
    assert.equal(f.requests.length, 0);
});

test('label confirmations queue across villages, dismiss stale prompts, and work with Builder closed', () => {
    const f = builderUI();
    f.scope.closeWindow();
    f.links[11] = [1, 2];
    f.rootScope.$broadcast(f.events.GROUPS_VILLAGE_LINKED, {});
    assert.equal(f.builder.getSequenceSuggestions().length, 2);
    const stale = f.currentModal();
    f.links[11] = [2];
    f.rootScope.$broadcast(f.events.GROUPS_VILLAGE_UNLINKED, {});
    stale.submit();
    assert.equal(f.builder.preview(1).sequence, 'Resource');
    assert.equal(f.builder.preview(2).sequence, 'Essential');
    assert.match(f.currentModal().text, /Village 2/);
    f.currentModal().submit();
    assert.equal(f.builder.preview(2).sequence, 'Offensive');
    assert.equal(f.builder.getSequenceSuggestions().length, 0);
    assert.equal(f.requests.length, 0);
});
