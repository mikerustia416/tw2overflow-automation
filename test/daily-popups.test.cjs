const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {fixture} = require('./farm-fixture.cjs');

function button (click, options = {}) {
    const item = {
        isConnected: true, disabled: !!options.disabled, clicks: 0, scope: options.scope,
        getAttribute: name => name === 'ng-click' ? click : name === 'aria-disabled' ? options.ariaDisabled : null,
        classList: {contains: name => (options.classes || []).includes(name)},
        getClientRects: () => options.hidden ? [] : [{}],
        click: () => { item.clicks++; if (options.onClick) options.onClick(item); }
    };
    return item;
}

function modal (templateName, scope, buttons = [], options = {}) {
    const panel = {scope, querySelectorAll: () => buttons};
    const controller = templateName === 'modal_daily_login_bonus' ? 'ModalDailyLoginBonusController' : 'ModalInterstitialController';
    return {templateName, scope, rootnode: {
        isConnected: true, getClientRects: () => options.hidden ? [] : [{}],
        querySelectorAll: () => buttons,
        querySelector: selector => selector === `[ng-controller="${controller}"]` ? panel : null
    }};
}

function setup (options = {}) {
    const f = fixture(options);
    const dom = {modals: []};
    f.context.windowManagerService = {getModals: () => dom.modals};
    f.events.WINDOW_CLOSED = 'window_closed';
    f.events.INTERSTITIALS_RECEIVED = 'interstitials_received';
    f.context.angular.element = element => ({scope: () => element.scope});
    f.loadSource('src/modules/daily_popups/src/settings.js');
    f.loadSource('src/modules/daily_popups/src/core.js');
    const tracker = f.get('two/dailyPopups');
    tracker.init();
    return {...f, tracker, dom};
}

function daily (f, options = {}) {
    const scope = {data: {reward_collected: false, login_chain: 2}, currentDay: 2, selectedDay: 2,
        rewards: [{}, {}, {}], ...options.scope};
    const claim = button('claimReward()', options.button);
    const rows = [0, 1, 2].map(n => button('selectDay(n + 1)', {scope: {n}, onClick: () => { scope.selectedDay = n + 1; }}));
    const close = button('closeWindow()');
    const window = modal('modal_daily_login_bonus', scope, [claim, close, ...rows], options);
    f.dom.modals = [window];
    return {window, scope, claim, close, rows};
}

function prompt (f, overrides = {}) {
    const scope = {submit: () => {}, cancel: () => {}, submitText: 'dismiss', cancelText: 'cancel',
        text: 'text', title: 'attention', ...overrides};
    const submit = button('submit($event)', {onClick: () => { f.dom.modals = f.dom.modals.filter(item => item !== window); }});
    const window = modal('modal_attention', scope, [submit]);
    return {window, scope, submit};
}

function advert (f, options = {}) {
    const scope = {interstitial: {cta_type: 'itemShop', accept_on_view: true, ...options.promotion}};
    const close = button('closeWindow()', {onClick: options.onClose || (() => { f.dom.modals = []; })});
    const accept = button('acceptInterstitial()');
    const window = modal('modal_interstitial', scope, [close, accept], options);
    f.dom.modals = [window];
    return {window, scope, close, accept};
}

test('Daily Popups claims the available daily reward and never clicks its close button', () => {
    const f = setup();
    const d = daily(f);
    f.tracker.start();
    assert.equal(d.claim.clicks, 1);
    assert.equal(d.close.clicks, 0);
    assert.equal(f.tracker.getStatus().claimsRequested, 1);
});

test('Daily Popups watches for rollover popups that arrive after startup', async () => {
    const f = setup();
    f.tracker.start();
    await f.tick(60000);
    const d = daily(f);
    await f.tick(2000);
    assert.equal(d.claim.clicks, 1);
});

test('Daily Popups selects today before claiming when another day was selected', async () => {
    const f = setup();
    const d = daily(f, {scope: {selectedDay: 3}});
    f.tracker.start();
    assert.equal(d.rows[1].clicks, 1);
    assert.equal(d.claim.clicks, 0);
    await f.tick(250);
    assert.equal(d.claim.clicks, 1);
    assert.equal(d.rows[2].clicks, 0);
});

test('Daily Popups waits for day selection and does not spam an unresponsive control', async () => {
    const f = setup();
    const d = daily(f, {scope: {selectedDay: 3}});
    d.rows[1].click = () => { d.rows[1].clicks++; };
    f.tracker.start();
    await f.tick(30000);
    assert.equal(d.rows[1].clicks, 1);
    assert.equal(d.claim.clicks, 0);
    assert.match(f.tracker.getStatus().message, /manually/);
});

test('Daily Popups suppresses ambiguous claims across timeouts, rerenders and pause/resume', async () => {
    const f = setup();
    const d = daily(f);
    f.tracker.start();
    await f.tick(60000);
    const replacement = button('claimReward()');
    d.window.rootnode.querySelector = () => ({scope: d.scope, querySelectorAll: () => [replacement]});
    f.tracker.stop();
    f.tracker.start();
    await f.tick(4000);
    assert.equal(d.claim.clicks, 1);
    assert.equal(replacement.clicks, 0);
    assert.match(f.tracker.getStatus().message, /manually/);
});

test('Daily Popups can claim a later daily popup after the prior window clears', async () => {
    const f = setup();
    const first = daily(f);
    f.tracker.start();
    f.dom.modals = [];
    await f.tick(250);
    const second = daily(f, {scope: {currentDay: 3, selectedDay: 3, data: {reward_collected: false, login_chain: 3}}});
    await f.tick(2000);
    assert.equal(first.claim.clicks, 1);
    assert.equal(second.claim.clicks, 1);
});

test('Daily Popups skips claimed, malformed, hidden and disabled daily rewards', () => {
    const rejected = [
        {scope: {data: {reward_collected: true, login_chain: 2}}},
        {scope: {data: {login_chain: 2}}}, {scope: {currentDay: 0}}, {scope: {currentDay: 4}},
        {scope: {rewards: null}}, {scope: {$$destroyed: true}},
        {button: {disabled: true}}, {button: {hidden: true}},
        {button: {classes: ['btn-grey']}}, {button: {ariaDisabled: 'true'}}, {hidden: true}
    ];
    for (const options of rejected) {
        const f = setup();
        const d = daily(f, options);
        f.tracker.start();
        assert.equal(d.claim.clicks, 0, JSON.stringify(options));
        assert.equal(d.close.clicks, 0);
    }
});

test('Daily Popups requires the native controller and exact claim expression', () => {
    const f = setup();
    const d = daily(f);
    d.claim.getAttribute = () => 'claimReward(); buyPremium()';
    f.tracker.start();
    assert.equal(d.claim.clicks, 0);
    f.tracker.stop();
    d.window.rootnode.querySelector = () => null;
    f.tracker.start();
    assert.equal(d.claim.clicks, 0);
});

test('Daily Popups closes viewed promotional adverts without accepting offers', async () => {
    const f = setup();
    const a = advert(f);
    f.tracker.start();
    await f.tick(250);
    assert.equal(a.close.clicks, 1);
    assert.equal(a.accept.clicks, 0);
    assert.equal(f.tracker.getStatus().advertsDismissed, 1);
});

test('Daily Popups confirms only the native Dismiss window produced by its advert', async () => {
    const f = setup();
    const p = prompt(f);
    const a = advert(f, {promotion: {accept_on_view: false}, onClose: () => { f.dom.modals = [p.window]; }});
    f.tracker.start();
    assert.equal(p.submit.clicks, 0);
    await f.tick(250);
    assert.equal(p.submit.clicks, 1);
    await f.tick(250);
    assert.equal(a.accept.clicks, 0);
    assert.equal(f.tracker.getStatus().advertsDismissed, 1);
});

test('Daily Popups does not submit pre-existing, unrelated or differently worded confirmations', async () => {
    for (const kind of ['existing', 'different', 'no-prompt']) {
        const f = setup();
        const p = prompt(f, kind === 'different' ? {text: 'Buy crowns?'} : {});
        const a = advert(f, {promotion: {accept_on_view: false}, onClose: () => { f.dom.modals = kind === 'no-prompt' ? [] : [p.window]; }});
        if (kind === 'existing') f.dom.modals.push(p.window);
        f.tracker.start();
        await f.tick(30000);
        assert.equal(a.close.clicks, 1);
        assert.equal(p.submit.clicks, 0, kind);
        assert.equal(f.tracker.getStatus().advertsDismissed, 0);
    }
});

test('Daily Popups waits behind unrelated modals and never closes shop screens or other confirmations', async () => {
    for (const template of ['screen_shop', 'modal_cash_shop', 'modal_attention', 'modal_socket', 'modal_quest_line']) {
        const f = setup();
        const d = daily(f);
        const close = button('closeWindow()');
        const submit = button('submit($event)');
        f.dom.modals.unshift(modal(template, {}, [close, submit]));
        f.tracker.start();
        await f.tick(4000);
        assert.equal(d.claim.clicks, 0);
        assert.equal(close.clicks, 0);
        assert.equal(submit.clicks, 0);
    }
});

test('Daily Popups handles stacked adverts then a daily reward one action at a time', async () => {
    const f = setup();
    const d = daily(f);
    const a = advert(f, {onClose: () => { f.dom.modals.shift(); }});
    const b = advert(f, {onClose: () => { f.dom.modals.shift(); }});
    f.dom.modals = [a.window, b.window, d.window];
    f.tracker.start();
    assert.equal(a.close.clicks, 1);
    assert.equal(b.close.clicks, 0);
    await f.tick(250);
    assert.equal(b.close.clicks, 1);
    await f.tick(250);
    assert.equal(d.claim.clicks, 1);
});

test('Daily Popups saves separate action preferences and leaves disabled actions untouched', () => {
    const f = setup();
    f.tracker.getSettings().set('claim_daily', false);
    const d = daily(f);
    f.tracker.start();
    assert.equal(d.claim.clicks, 0);
    f.tracker.stop();
    f.tracker.getSettings().setAll({claim_daily: true, close_ads: false});
    const a = advert(f);
    f.tracker.start();
    assert.equal(a.close.clicks, 0);
    assert.deepEqual(f.storage.get('daily_popups_settings'), {claim_daily: true, close_ads: false});
});

test('Daily Popups stops scheduled actions and defers clicks during an Angular digest', async () => {
    const f = setup();
    const d = daily(f);
    f.context.$rootScope.$$phase = '$apply';
    f.tracker.start();
    assert.equal(d.claim.clicks, 0);
    f.tracker.stop();
    f.context.$rootScope.$$phase = null;
    await f.tick(4000);
    assert.equal(d.claim.clicks, 0);
    f.tracker.start();
    assert.equal(d.claim.clicks, 1);
});

test('Daily Popups pause and disabling adverts cancel a scheduled Dismiss submission', async () => {
    const f = setup();
    const p = prompt(f);
    advert(f, {promotion: {accept_on_view: false}, onClose: () => { f.dom.modals = [p.window]; }});
    f.tracker.start();
    f.tracker.stop();
    await f.tick(2000);
    assert.equal(p.submit.clicks, 0);
    f.tracker.getSettings().set('close_ads', false);
    f.tracker.start();
    await f.tick(2000);
    assert.equal(p.submit.clicks, 0);
    f.tracker.getSettings().set('close_ads', true);
    await f.tick(250);
    assert.equal(p.submit.clicks, 1);
});

test('Daily Popups handles missing accept_on_view using the native dismissal confirmation', async () => {
    const f = setup();
    const p = prompt(f);
    advert(f, {promotion: {accept_on_view: undefined}, onClose: () => { f.dom.modals = [p.window]; }});
    f.tracker.start();
    await f.tick(250);
    assert.equal(p.submit.clicks, 1);
});

test('Daily Popups click failures do not trigger repeated requests', async () => {
    const f = setup();
    const d = daily(f, {button: {onClick: () => { throw Error('failed'); }}});
    f.tracker.start();
    await f.tick(30000);
    assert.equal(d.claim.clicks, 1);
    assert.match(f.tracker.getStatus().message, /failed/);
});

test('Daily Popups owns startup, starts automatically on first use, and restores an explicit pause', () => {
    for (const active of [undefined, false, true]) {
        const f = setup({storageEntries: active === undefined ? [] : [['daily_popups_active', active]]});
        // Use a fresh stub to verify module-local readiness and restoration.
        let readyCalled = false;
        let running = false;
        const tracker = {init: () => {}, start: () => { running = true; }, isInitialized: () => false, isRunning: () => running};
        f.loadSource('src/module-state.js');
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/modules/daily_popups/src/init.js'), 'utf8'), Object.assign(f.context, {
            require: (deps, callback) => callback((fn, state) => { assert.equal(state, 'map'); readyCalled = true; fn(); },
                tracker, () => {}, f.get('two/moduleState'))
        }));
        assert.equal(readyCalled, true);
        assert.equal(running, active !== false);
        f.rootScope.$broadcast('two_daily_popups_stop');
        assert.equal(f.storage.get('daily_popups_active'), false);
    }
});

test('Daily Popups respects manual cancellation of its dismissal and never submits a replacement prompt', async () => {
    const f = setup();
    const p = prompt(f);
    advert(f, {promotion: {accept_on_view: false}, onClose: () => { f.dom.modals = [p.window]; }});
    f.tracker.start();
    const unrelated = prompt(f);
    f.dom.modals = [unrelated.window];
    await f.tick(4000);
    assert.equal(p.submit.clicks, 0);
    assert.equal(unrelated.submit.clicks, 0);
    assert.equal(f.tracker.getStatus().advertsDismissed, 0);
});

test('Daily Popups skips hidden adverts, unknown campaign types and decorated close expressions', () => {
    for (const kind of ['hidden', 'type', 'expression']) {
        const f = setup();
        const a = advert(f, kind === 'hidden' ? {hidden: true} : kind === 'type' ? {promotion: {cta_type: 'newUnknownType'}} : {});
        if (kind === 'expression') a.close.getAttribute = () => 'closeWindow(); acceptInterstitial()';
        f.tracker.start();
        assert.equal(a.close.clicks, 0);
        assert.equal(a.accept.clicks, 0);
    }
});

test('Daily Popups saved flags apply immediately without restarting or waking an explicitly paused tracker', async () => {
    const f = setup({storageEntries: [['daily_popups_settings', {claim_daily: false, close_ads: false}]]});
    const d = daily(f);
    f.tracker.start();
    f.tracker.getSettings().set('claim_daily', true);
    await f.tick(250);
    assert.equal(d.claim.clicks, 1);
    f.tracker.stop();
    f.tracker.getSettings().set('close_ads', true);
    const a = advert(f);
    await f.tick(4000);
    assert.equal(a.close.clicks, 0);
    assert.equal(f.tracker.isRunning(), false);
});

test('Daily Popups UI saves both preferences, refreshes status, pauses independently and cleans up events', () => {
    const f = setup();
    let open;
    let scope;
    let destroyed = 0;
    const classes = new Set();
    const listeners = new Map();
    const destroys = [];
    f.context.$rootScope.$new = () => ({$evalAsync: fn => fn(), $on: (name, callback) => destroys.push(callback)});
    f.context.windowManagerService.getScreenWithInjectedScope = (name, value) => {
        assert.equal(name, '!twoverflow_daily_popups_window'); scope = value;
    };
    f.setModule('two/ui', {addTemplate: () => {}, addMenuButton: label => {
        assert.equal(label, 'Daily Popups');
        return {classList: {toggle: (name, value) => value ? classes.add(name) : classes.delete(name)},
            addEventListener: (event, listener) => {open = listener;}};
    }});
    f.setModule('two/EventScope', class {
        register (event, handler) { listeners.set(event, handler); }
        destroy () { destroyed++; }
    });
    f.loadSource('src/modules/daily_popups/src/interface.js');
    f.get('two/dailyPopups/ui')();
    open();
    assert.equal(scope.claimDaily, true);
    assert.equal(scope.closeAds, true);
    assert.equal(scope.running, false);
    scope.claimDaily = false;
    scope.closeAds = true;
    scope.saveSettings();
    assert.deepEqual(f.storage.get('daily_popups_settings'), {claim_daily: false, close_ads: true});
    assert.equal(scope.saved, true);
    scope.switchState();
    listeners.get('two_daily_popups_start')();
    assert.equal(scope.running, true);
    assert.equal(classes.has('btn-red'), true);
    scope.switchState();
    listeners.get('two_daily_popups_stop')();
    assert.equal(scope.running, false);
    assert.equal(classes.has('btn-orange'), true);
    assert.equal(f.farm.isRunning(), false);
    destroys.forEach(fn => fn());
    assert.equal(destroyed, 1);
});
