const assert = require('node:assert/strict');
const test = require('node:test');
const {fixture} = require('./farm-fixture.cjs');

function notices() {
    const f = fixture({deferFarmInit: true});
    for (const name of ['settings', 'policy', 'notice']) f.loadSource('src/modules/deposit_planner/src/' + name + '.js');
    const map = f.get('two/depositPlanner/settings/map');
    const config = Object.fromEntries(Object.entries(map).map(([id, field]) => [id, field.default]));
    config.auto_reroll = true;
    config.fixed_yield_rerolls = false;
    const state = {now: 1000, progress: 0, target: 500, errandsReset: 5000, milestonesReset: 10000,
        itemCount: 9, itemId: 42, rerollsUsed: 0, jobs: [], collectible: [], current: null};
    const plan = {state, action: 'wait', reason: 'Wait', jobs: [], knownEta: null, forecast: null};
    const notice = f.get('two/depositPlanner/rerollNotice');
    return {notice, config, state, plan, policy: f.get('two/depositPlanner/policy')};
}
const text = notice => notice.reasons.join(' ');
const option = (changes = {}) => ({action: 'reroll', itemLimit: 1, meanItems: 1, gainPerItem: 200,
    lowerProbability: 0.96, probability: 1, upperProbability: 1, ...changes});

test('reroll notice follows exact plans and disappears for a recommended reroll', () => {
    const f = notices();
    f.state.jobs = [{id: 1, duration: 10, amount: 500}];
    const exact = f.policy.plan(f.state, f.config);
    const snapshot = JSON.stringify(exact);
    assert.match(text(f.notice(exact, f.config)), /visible errands.*without a reroll/);
    assert.equal(JSON.stringify(exact), snapshot, 'Notice cannot change the chosen plan');
    assert.equal(f.notice({...f.plan, action: 'reroll'}, f.config), null);
    f.state.progress = 500;
    assert.match(text(f.notice(f.plan, f.config)), /target is already reached/);
});

test('reroll notice lists reserve and cycle constraints together with actual limits', () => {
    const f = notices();
    f.state.itemCount = 1;
    f.state.rerollsUsed = 3;
    const value = f.notice(f.plan, f.config);
    assert.equal(value.level, 'warning');
    assert.match(text(value), /1 reroll items; 1 are reserved/);
    assert.match(text(value), /3[/]3 reserved or used/);
    f.state.itemCount = 9;
    f.state.rerollsUsed = 0;
    f.state.itemId = null;
    assert.match(text(f.notice(f.plan, f.config)), /item is unavailable/);
});

test('reroll notice distinguishes disabled automation, learning and a nearby free reset', () => {
    const f = notices();
    f.config.auto_reroll = false;
    const off = f.notice(f.plan, f.config);
    assert.equal(off.level, 'info');
    assert.match(text(off), /setting alone does not judge.*manual reroll/);
    f.config.auto_reroll = true;
    f.plan.forecast = {ready: false, sampleCount: 2};
    f.state.errandsReset = 1200;
    const learning = f.notice(f.plan, f.config);
    assert.equal(learning.level, 'warning');
    assert.match(text(learning), /2[/]5 matching complete boards/);
    assert.match(text(learning), /free errand reset is due within 4 minutes/);
});

test('reroll notice uses the cautious confidence, improvement and item-value thresholds', () => {
    const f = notices();
    const alternative = option({action: 'continue', itemLimit: 0, meanItems: 0, gainPerItem: null,
        lowerProbability: 0.70, upperProbability: 0.80, probability: 0.75});
    const candidate = option({lowerProbability: 0.94});
    f.plan.forecast = {ready: true, options: [alternative, candidate]};
    assert.match(text(f.notice(f.plan, f.config)), /cautious success threshold of 95%/);
    candidate.lowerProbability = 0.96;
    alternative.upperProbability = 0.94;
    assert.match(text(f.notice(f.plan, f.config)), /required 5 percentage points/);
    f.config.min_gain_per_item = 300;
    assert.match(text(f.notice(f.plan, f.config)), /at least 300/);
    f.config.min_gain_per_item = 0;
    candidate.gainPerItem = 0;
    assert.match(text(f.notice(f.plan, f.config)), /gain must be positive/);
    candidate.gainPerItem = 200;
    alternative.upperProbability = 0.80;
    assert.equal(f.notice(f.plan, f.config).level, 'info', 'Prefer a no-reroll plan without inventing a failed threshold');
    f.config.confidence_guard = false;
    candidate.lowerProbability = 0;
    assert.doesNotMatch(text(f.notice(f.plan, f.config)), /cautious success threshold/);
});

test('reroll notice preserves pending guards and distinguishes collection from reset timing', () => {
    const f = notices();
    const guard = f.notice({...f.plan, action: 'reroll'}, f.config, {action: 'reroll'});
    assert.equal(guard.level, 'warning');
    assert.match(text(guard), /previous reroll request still needs game confirmation/);
    f.state.collectible = [{id: 1}];
    assert.match(text(f.notice(f.plan, f.config)), /Collect the completed errand/);
    f.state.milestonesReset = 1060;
    assert.match(text(f.notice(f.plan, f.config)), /reset buffer has been reached/);
    const fresh = f.notice({...f.plan, action: 'refresh'}, f.config);
    assert.match(text(fresh), /fresh deposit data/);
});

test('reroll notice explains the actual last-errand decision and lower milestone plan', () => {
    const f = notices();
    f.state.current = {id: 1};
    f.plan.runningPreview = {reason: 'The running errand covers the target; keep items',
        collectableBeforeReset: true};
    f.state.runningRerollAllowed = true;
    assert.match(text(f.notice(f.plan, f.config)), /running errand covers the target/);
    f.plan.runningPreview = {reason: 'The running reward cannot be safely collected before both reset buffers',
        collectableBeforeReset: false};
    assert.equal(f.notice(f.plan, f.config).level, 'warning');
    f.state.current = null;
    f.plan.knownEta = 2000;
    f.plan.fallback = true;
    assert.match(text(f.notice(f.plan, f.config)), /planned lower milestone/);
});

test('fixed yield notices ignore historical zero-percent results and learning thresholds', () => {
    const f = notices();
    const plan = {...f.plan, fixedYield: true, goalTarget: 500,
        reason: 'Collect visible rewards first, then recalculate the fixed reroll forecast',
        forecast: {ready: false, sampleCount: 0, options: []}};
    const notice = f.notice(plan, {...f.config, fixed_yield_rerolls: true});
    assert.match(text(notice), /Collect visible rewards first/);
    assert.doesNotMatch(text(notice), /history|learned|confidence|0%/);
    assert.equal(notice.level, 'info');
});
