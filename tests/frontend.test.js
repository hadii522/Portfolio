const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const siteRoot = path.resolve(process.env.PORTFOLIO_TEST_SITE_ROOT || path.resolve(__dirname, '..'));

function eventTarget(properties = {}) {
  const listeners = new Map();
  return Object.assign({
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) || []) listener(event);
    }
  }, properties);
}

function element(properties = {}) {
  const attributes = new Map();
  const classes = new Set();
  return eventTarget({
    dataset: {},
    hidden: false,
    textContent: '',
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    removeAttribute(name) { attributes.delete(name); },
    focus() { this.focused = true; },
    contains(candidate) { return candidate === this; },
    closest() { return null; },
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
      toggle(name, force) {
        const selected = force === undefined ? !classes.has(name) : Boolean(force);
        if (selected) classes.add(name); else classes.delete(name);
        return selected;
      }
    },
    ...properties
  });
}

function frameScheduler() {
  let nextId = 1, timestamp = 0;
  const frames = new Map();
  return {
    requestAnimationFrame(callback) { const id = nextId++; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    get pending() { return frames.size; },
    tick(elapsed = 1000 / 60) {
      timestamp += elapsed;
      const current = [...frames.values()]; frames.clear();
      for (const callback of current) callback(timestamp);
    }
  };
}

function runScript(filename, globals) {
  vm.runInNewContext(fs.readFileSync(path.join(siteRoot, filename), 'utf8'), globals, { filename });
}

function animationHarness({ reducedMotion = false, mobile = false, saveData = false, hidden = false, canvas = true, context = true } = {}) {
  const scheduler = frameScheduler();
  const motion = eventTarget({ matches: reducedMotion });
  const screen = eventTarget({ matches: mobile });
  const connection = eventTarget({ saveData });
  const drawCalls = [], renders = [];
  const canvasElement = element({ getContext: () => context ? {
    globalAlpha: 1, setTransform() {},
    clearRect() { renders.push([]); },
    drawImage(image, ...coordinates) {
      assert.equal(image.decoded, true, 'canvas must never receive an undecoded image');
      const call = { image, coordinates, alpha: this.globalAlpha };
      drawCalls.push(call); renders.at(-1).push(call);
    }
  } : null });
  const requests = [];
  class Image {
    constructor() { this.naturalWidth = 1280; this.naturalHeight = 720; this.settled = false; this.decoded = false; this.failed = false; }
    set src(value) { this.url = value; requests.push(this); }
    decode() { this.decodeCalled = true; return new Promise((resolve, reject) => { this.resolvePixels = resolve; this.rejectPixels = reject; }); }
    resolveDecode() { this.decoded = true; this.resolvePixels?.(); }
    succeed({ decoded = true } = {}) { this.settled = true; this.onload(); if (decoded) this.resolveDecode(); }
    fail() { this.settled = true; this.failed = true; this.onerror(); }
  }
  const document = eventTarget({ hidden, getElementById: () => canvas ? canvasElement : null, documentElement: { scrollHeight: 4000 } });
  const window = eventTarget({ innerWidth: 1440, innerHeight: 900, scrollY: 0, devicePixelRatio: 3,
    matchMedia: query => query.includes('prefers-reduced-motion') ? motion : screen });
  runScript('app.js', { document, window, navigator: { connection }, Image,
    requestAnimationFrame: scheduler.requestAnimationFrame, cancelAnimationFrame: scheduler.cancelAnimationFrame });
  return { scheduler, motion, screen, connection, canvas: canvasElement, document, window, requests, drawCalls, renders };
}
async function flushMicrotasks() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }
function frameIndex(image) { return Number(image.url.match(/frame_(\d+)/)[1]) - 1; }
function activeRequests(harness) { return harness.requests.filter(image => !image.decoded && !image.failed); }
function renderedPositions(harness) {
  return harness.renders.filter(calls => calls.length).map(calls => {
    const first = frameIndex(calls[0].image);
    return calls.length === 1 ? first : first + (frameIndex(calls[1].image) - first) * calls[1].alpha;
  });
}
function currentPosition(harness) { return renderedPositions(harness).at(-1); }
async function settleAnimation(harness, limit = 500) {
  for (let step = 0; step < limit; step++) {
    if (harness.scheduler.pending) harness.scheduler.tick();
    const budget = harness.screen.matches ? 3 : 4;
    assert.ok(activeRequests(harness).length <= budget, `at most ${budget} loads/decodes may be in flight`);
    for (const image of harness.requests.filter(image => !image.settled)) image.succeed();
    await flushMicrotasks();
    if (!harness.scheduler.pending && !activeRequests(harness).length) return step;
  }
  assert.fail('animation/buffer must settle; possible idle loop or repeated cache downloads');
}

for (const preference of [{ reducedMotion: true }, { saveData: true }, { hidden: true }]) {
  test(`animation avoids frame requests for ${JSON.stringify(preference)}`, () => {
    const harness = animationHarness(preference);
    assert.equal(harness.scheduler.pending, 0);
    assert.equal(harness.requests.length, 0);
    assert.equal(harness.canvas.hidden, true);
    harness.window.scrollY = 1000;
    harness.window.dispatch('scroll');
    harness.scheduler.tick();
    assert.equal(harness.requests.length, 0);
  });
}

test('animation exits gracefully when canvas or 2D context is unavailable', () => {
  assert.doesNotThrow(() => animationHarness({ canvas: false }));
  assert.doesNotThrow(() => animationHarness({ context: false }));
});

test('desktop animation buffers consecutive frames, caps resolution, and stops idle RAF', async () => {
  const h = animationHarness();
  assert.equal(h.requests.length, 4);
  assert.deepEqual(h.requests.map(frameIndex), [0, 1, 2, 3], 'frame 0002 must not be skipped for 0006');
  h.scheduler.tick();
  assert.equal(h.canvas.width, 2160);
  assert.equal(h.drawCalls.length, 0, 'encoded images are not drawable until decoded');
  await settleAnimation(h);
  assert.ok(h.requests.length > 4 && h.requests.length < 240, 'warm nearby frames without eager full-sequence loading');
  assert.equal(currentPosition(h), 0);
  assert.equal(h.scheduler.pending, 0);
  const before = h.drawCalls.length; h.scheduler.tick();
  assert.equal(h.drawCalls.length, before);
});

test('mobile keeps the full animation with three-load budget, DPR one, and idle stopping', async () => {
  const h = animationHarness({ mobile: true });
  h.window.innerWidth = 375;
  h.window.innerHeight = 812;
  assert.equal(h.canvas.hidden, false);
  assert.equal(h.requests.length, 3, 'mobile starts only three concurrent loads');
  assert.deepEqual(h.requests.map(frameIndex), [0, 1, 2]);
  h.scheduler.tick();
  assert.equal(h.canvas.width, 375, 'mobile pixel ratio is capped at one');
  assert.equal(h.canvas.height, 812);
  await settleAnimation(h);
  assert.ok(h.requests.length > 3 && h.requests.length < 240);
  assert.equal(h.scheduler.pending, 0);
  h.window.scrollY = 3188;
  h.window.dispatch('scroll');
  await settleAnimation(h);
  assert.ok(Math.abs(currentPosition(h) - 239) < 0.01, 'mobile reaches the final frame');
  assert.equal(h.scheduler.pending, 0);
  h.window.scrollY = 0;
  h.window.dispatch('scroll');
  await settleAnimation(h);
  assert.ok(Math.abs(currentPosition(h)) < 0.01, 'mobile also supports reverse scrolling');
  assert.equal(h.scheduler.pending, 0);
});

test('an image is not drawable until asynchronous decode completes', async () => {
  const h = animationHarness(), first = h.requests[0];
  first.succeed({ decoded: false }); await flushMicrotasks(); h.scheduler.tick();
  assert.equal(first.decodeCalled, true);
  assert.equal(h.drawCalls.length, 0);
  assert.equal(h.requests.length, 4, 'decode occupies its request budget');
  first.resolveDecode(); await flushMicrotasks(); h.scheduler.tick();
  assert.equal(h.drawCalls[0].image, first);
  await settleAnimation(h);
});

test('scroll animation reaches all 240 frames with at most four loads in flight', async () => {
  const h = animationHarness(); await settleAnimation(h);
  h.window.scrollY = 3100; h.window.dispatch('scroll'); await settleAnimation(h);
  assert.ok(Math.abs(currentPosition(h) - 239) < 0.01);
  assert.ok(h.requests.some(image => /frame_0240\.webp$/.test(image.url)));
  const positions = renderedPositions(h);
  assert.ok(positions.every((value, i) => i === 0 || value >= positions[i - 1] - 0.0001), 'forward scroll never jumps backward');
  assert.equal(h.scheduler.pending, 0);
});

test('late out-of-order frames hold the ready boundary without backward jumps or cache churn', async () => {
  const h = animationHarness(); await settleAnimation(h);
  h.window.scrollY = 3100; h.window.dispatch('scroll'); h.scheduler.tick();
  const boundary = currentPosition(h);
  const blocked = activeRequests(h).sort((a, b) => frameIndex(a) - frameIndex(b))[0];
  assert.equal(frameIndex(blocked), boundary + 1);
  for (let batch = 0; batch < 16; batch++) {
    for (const image of h.requests.filter(image => !image.settled && image !== blocked).reverse()) image.succeed();
    await flushMicrotasks(); h.scheduler.tick();
    assert.equal(currentPosition(h), boundary, 'future frames cannot pass an undecoded intervening frame');
    assert.ok(activeRequests(h).length <= 4);
  }
  const urls = h.requests.map(image => image.url);
  assert.equal(new Set(urls).size, urls.length, 'buffered lookahead frames must not be immediately evicted and fetched again');
  blocked.succeed(); await flushMicrotasks(); await settleAnimation(h);
  assert.ok(currentPosition(h) > boundary);
});

test('scroll reversal ignores stale forward completions and finishes at the new target', async () => {
  const h = animationHarness(); await settleAnimation(h);
  h.window.scrollY = 3100; h.window.dispatch('scroll'); h.scheduler.tick();
  const reversalStart = currentPosition(h), priorRenders = h.renders.length;
  const stale = [...activeRequests(h)];
  h.window.scrollY = 0; h.window.dispatch('scroll');
  for (const image of stale.reverse()) image.succeed();
  await flushMicrotasks(); await settleAnimation(h);
  const positions = renderedPositions({ renders: h.renders.slice(priorRenders) });
  assert.ok(positions.length > 0 && positions[0] <= reversalStart);
  assert.ok(positions.every((value, i) => i === 0 || value <= positions[i - 1] + 0.0001), 'old forward loads must not draw against the reversed direction');
  assert.ok(Math.abs(currentPosition(h)) < 0.01);
});

test('adjacent decoded frames blend at fractional positions', async () => {
  const h = animationHarness(); await settleAnimation(h);
  h.window.scrollY = 100; h.window.dispatch('scroll'); h.scheduler.tick();
  const calls = h.renders.at(-1);
  assert.equal(calls.length, 2);
  assert.equal(frameIndex(calls[1].image), frameIndex(calls[0].image) + 1);
  assert.equal(calls[0].alpha, 1);
  assert.ok(calls[1].alpha > 0 && calls[1].alpha < 1);
  await settleAnimation(h);
});

test('time-based easing remains comparable at 60Hz and 120Hz', async () => {
  async function simulate(delta, count) {
    const h = animationHarness(); await settleAnimation(h);
    h.window.scrollY = 100; h.window.dispatch('scroll'); h.scheduler.tick(1000 / 60);
    for (let step = 0; step < count; step++) h.scheduler.tick(delta);
    return currentPosition(h);
  }
  assert.ok(Math.abs(await simulate(1000 / 60, 12) - await simulate(1000 / 120, 24)) < 0.0001);
});

test('failed frames do not retry forever or block later frames', async () => {
  const h = animationHarness();
  for (const image of [...h.requests]) image.fail();
  await settleAnimation(h);
  assert.equal(h.scheduler.pending, 0);
  for (const url of h.requests.slice(0, 4).map(image => image.url)) assert.equal(h.requests.filter(image => image.url === url).length, 1);
  h.window.scrollY = 100; h.window.dispatch('scroll'); await settleAnimation(h);
  assert.ok(currentPosition(h) > 3, 'known failed frames must not freeze the sequence');
});

test('preference and visibility changes pause animation and avoid new hidden work', async () => {
  const h = animationHarness(), first = [...h.requests];
  h.motion.matches = true; h.motion.dispatch('change');
  assert.equal(h.scheduler.pending, 0); assert.equal(h.canvas.hidden, true);
  for (const image of first) image.succeed(); await flushMicrotasks();
  assert.equal(h.requests.length, 4, 'decode completions do not refill while paused');
  assert.equal(h.scheduler.pending, 0);
  h.motion.matches = false; h.motion.dispatch('change');
  assert.equal(h.scheduler.pending, 1); assert.equal(h.canvas.hidden, false);
  h.document.hidden = true; h.document.dispatch('visibilitychange');
  const count = h.requests.length;
  for (const image of h.requests.filter(image => !image.settled)) image.succeed(); await flushMicrotasks();
  assert.equal(h.scheduler.pending, 0); assert.equal(h.requests.length, count);
});

test('filters update card hidden state, pressed state, and announced counts', () => {
  const html = fs.readFileSync(path.join(siteRoot, 'projects.html'), 'utf8');
  const buttons = [...html.matchAll(/data-filter="([^"]+)"/g)].map(match => element({ dataset: { filter: match[1] } }));
  const cards = [...html.matchAll(/class="project-card showcase-card" data-category="([^"]+)"/g)].map(match => element({ dataset: { category: match[1] } }));
  const status = element();
  const document = {
    querySelectorAll: query => query === '.filter-btn' ? buttons : cards,
    getElementById: () => status
  };
  runScript('projects.js', { document });
  buttons[1].dispatch('click');
  assert.equal(cards.length, 14);
  assert.equal(cards.filter(card => !card.hidden).length, 4);
  assert.deepEqual(buttons.map(button => button.getAttribute('aria-pressed')), ['false', 'true', 'false', 'false', 'false']);
  assert.equal(buttons[1].classList.contains('active'), true);
  assert.equal(status.textContent, '4 projects shown');
  buttons[4].dispatch('click');
  assert.equal(cards.filter(card => !card.hidden).length, 5);
  assert.equal(status.textContent, '5 projects shown');
  buttons[3].dispatch('click');
  assert.equal(cards.filter(card => !card.hidden).length, 1);
  assert.equal(status.textContent, '1 project shown');
  buttons[0].dispatch('click');
  assert.ok(cards.every(card => card.hidden === false));
  assert.equal(status.textContent, '14 projects shown');
});

function navigationHarness({ sections = [], links = [] } = {}) {
  const scheduler = frameScheduler();
  const toggle = element();
  toggle.setAttribute('aria-expanded', 'false');
  const menu = element({ querySelectorAll: () => links });
  const wideScreen = eventTarget({ matches: false });
  const document = eventTarget({
    documentElement: element({ scrollHeight: 4000 }),
    getElementById: id => id === 'menu-toggle' ? toggle : menu,
    querySelectorAll: () => sections
  });
  const window = eventTarget({ innerHeight: 900, scrollY: 0, matchMedia: () => wideScreen });
  runScript('navigation.js', { document, window, requestAnimationFrame: scheduler.requestAnimationFrame });
  return { scheduler, document, window, toggle, menu, wideScreen };
}

test('navigation opens accessibly and Escape closes it and restores focus', () => {
  const harness = navigationHarness();
  assert.equal(harness.document.documentElement.classList.contains('navigation-ready'), true);
  harness.toggle.dispatch('click');
  assert.equal(harness.toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(harness.toggle.getAttribute('aria-label'), 'Close navigation menu');
  assert.equal(harness.menu.classList.contains('open'), true);
  harness.document.dispatch('keydown', { key: 'Escape' });
  assert.equal(harness.toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(harness.menu.classList.contains('open'), false);
  assert.equal(harness.toggle.focused, true);
});

test('link selection, outside clicks, and desktop breakpoint close navigation', () => {
  const harness = navigationHarness();
  harness.toggle.dispatch('click');
  harness.menu.dispatch('click', { target: element({ closest: () => element() }) });
  assert.equal(harness.toggle.getAttribute('aria-expanded'), 'false');
  harness.toggle.dispatch('click');
  harness.document.dispatch('click', { target: element() });
  assert.equal(harness.menu.classList.contains('open'), false);
  harness.toggle.dispatch('click');
  harness.wideScreen.dispatch('change');
  assert.equal(harness.menu.classList.contains('open'), false);
});

test('scrollspy exposes the current section and batches scroll events', () => {
  const position = { about: 0, skills: 600, contact: 2000 };
  const sections = Object.keys(position).map(id => element({ id, getBoundingClientRect: () => ({ top: position[id] }) }));
  const links = sections.map(section => element({ hash: `#${section.id}` }));
  const harness = navigationHarness({ sections, links });
  assert.equal(links[0].getAttribute('aria-current'), 'location');
  position.skills = 100;
  harness.window.dispatch('scroll');
  harness.window.dispatch('scroll');
  assert.equal(harness.scheduler.pending, 1);
  harness.scheduler.tick();
  assert.equal(links[0].getAttribute('aria-current'), null);
  assert.equal(links[1].getAttribute('aria-current'), 'location');
  harness.window.scrollY = 3100;
  harness.window.dispatch('scroll');
  harness.scheduler.tick();
  assert.equal(links[2].getAttribute('aria-current'), 'location');
});
