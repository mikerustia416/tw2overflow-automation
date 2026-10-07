const assert = require('node:assert/strict');
const test = require('node:test');
const {fixture} = require('./farm-fixture.cjs');

function setup () {
    const f = fixture();
    const dom = {finish: [], lines: [], tasks: [], close: []};
    f.context.document = {querySelectorAll: selector => {
        if (selector.includes('finishQuest')) return dom.finish;
        if (selector.includes('selectQuest')) return dom.tasks;
        if (selector.includes('closeWindow')) return dom.close;
        return dom.lines;
    }};
    f.context.angular.element = button => ({scope: () => button.scope});
    for (const name of ['settings', 'events', 'core']) f.loadSource(`src/modules/auto_quest/src/${name}.js`);
    const quest = f.get('two/autoQuest');
    quest.init();
    return {...f, quest, dom};
}

function button (options = {}) {
    const classes = new Set(options.classes || []);
    const item = {
        disabled: options.disabled || false, isConnected: true, clicks: 0,
        classList: {contains: name => classes.has(name), add: name => classes.add(name), remove: name => classes.delete(name)},
        getAttribute: name => name === 'ng-click' ? options.click : null,
        getClientRects: () => options.hidden ? [] : [{}],
        querySelector: selector => options.markers && options.markers.includes(selector) ? {} : null,
        scope: options.scope,
        click: () => { item.clicks++; if (options.onClick) options.onClick(item); }
    };
    return item;
}

const task = options => button({click: 'selectQuest($index);', markers: ['.icon-44x44-quest-ready-to-finish'], ...options});
const reward = options => button({click: 'finishQuest();', classes: ['btn-green'],
    scope: {data: {questModel: {isFinishable: () => true, isClosed: () => false}}}, ...options});

test('AutoQuest opens unread lines, selects the marked task, then claims the revealed reward', async () => {
    const f = setup();
    const claim = reward();
    const marked = task({onClick: row => {
        row.classList.add('selected');
        f.dom.finish = [claim];
    }});
    const line = button({click: 'openQuestLineModal(questLineModel);', classes: ['quest-line-unread'], onClick: () => {
        f.dom.tasks = [marked];
    }});
    f.dom.lines = [line];
    f.quest.start();
    assert.equal(line.clicks, 1);
    assert.equal(marked.clicks, 0);
    await f.tick(1000);
    assert.equal(marked.clicks, 1);
    assert.equal(claim.clicks, 0);
    await f.tick(1000);
    assert.equal(claim.clicks, 1);
    await f.tick(1000);
    assert.equal(claim.clicks, 1, 'Do not repeat while claim is pending');
});

test('AutoQuest selects each ready task after consuming the preceding selected reward', async () => {
    const f = setup();
    const secondClaim = reward();
    const second = task({onClick: row => {
        row.classList.add('selected');
        f.dom.finish = [secondClaim];
    }});
    const firstClaim = reward({onClick: item => {
        item.isConnected = false;
        f.dom.finish = [];
    }});
    const selected = task({classes: ['selected']});
    f.dom.tasks = [selected, second];
    f.dom.finish = [firstClaim];
    f.quest.start();
    assert.equal(firstClaim.clicks, 1);
    assert.equal(second.clicks, 0);
    await f.tick(1000);
    assert.equal(second.clicks, 1);
    await f.tick(1000);
    assert.equal(secondClaim.clicks, 1);
    assert.equal(selected.clicks, 0);
});

test('AutoQuest never selects unfinished, finished, selected, hidden, disabled, or unrelated tasks', () => {
    const f = setup();
    const rejected = [task({markers: []}), task({markers: ['.icon-44x44-quest-finished']}),
        task({classes: ['selected']}), task({hidden: true}), task({disabled: true}),
        task({click: 'selectQuestAndBuyPremium($index);'}), task({classes: ['btn-grey']})];
    f.dom.tasks = rejected;
    f.quest.start();
    assert.deepEqual(rejected.map(row => row.clicks), Array(7).fill(0));
});

test('AutoQuest waits for task selection to render instead of closing the panel or repeatedly clicking', async () => {
    const f = setup();
    const marked = task();
    const close = button({click: 'closeWindow()'});
    f.dom.tasks = [marked];
    f.dom.close = [close];
    f.quest.start();
    await f.tick(3000);
    assert.equal(marked.clicks, 1);
    assert.equal(close.clicks, 0);
});

test('AutoQuest closes the quest panel after the selected reward is consumed', async () => {
    const f = setup();
    const selected = task({classes: ['selected']});
    const claim = reward({onClick: item => {
        item.isConnected = false;
        f.dom.finish = [];
    }});
    const close = button({click: 'closeWindow()', onClick: () => { f.dom.tasks = []; f.dom.close = []; }});
    f.dom.tasks = [selected];
    f.dom.finish = [claim];
    f.dom.close = [close];
    f.quest.start();
    assert.equal(close.clicks, 0);
    await f.tick(1000);
    assert.equal(close.clicks, 1);
});

test('AutoQuest defers task selection during an Angular digest and cancels on stop', async () => {
    const f = setup();
    const marked = task();
    f.dom.tasks = [marked];
    f.context.$rootScope.$$phase = '$digest';
    f.quest.start();
    assert.equal(marked.clicks, 0);
    f.quest.stop();
    f.context.$rootScope.$$phase = null;
    await f.tick(1000);
    assert.equal(marked.clicks, 0);
});

test('AutoQuest honors disabled checking and persisted settings', async () => {
    const f = setup();
    const marked = task();
    f.dom.tasks = [marked];
    f.quest.getSettings().set('enabled', false);
    f.quest.start();
    await f.tick(30000);
    assert.equal(marked.clicks, 0);
    assert.equal(f.storage.get('auto_quest_settings').enabled, false);
});
