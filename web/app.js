// Chat page for the local GraphRAG server (npm run chat). No framework and no build step.
// The server returns view models (src/web/present.ts); this file only renders them.
// Every string from the corpus or the model is inserted as text, never as HTML.

const MODE_NAMES = {
  vector: 'Vector',
  hybrid: 'Hybrid',
  graph: 'Graph',
  rerank: 'Rerank',
  full: 'Full',
};
const MODE_NOTES = {
  vector: 'Vector: semantic search only, without fulltext, graph or reranker.',
  hybrid: 'Hybrid: vector plus fulltext search, fused by reciprocal rank.',
  graph: 'Graph: hybrid plus graph expansion through neighbours, shared entities and links.',
  rerank: 'Rerank: graph plus the trained reranker, or its pass-through baseline.',
  full: 'Full: rerank plus the evidence gate, the answer, and a check of every sentence against its sources.',
};
const STOP = new Set(
  'about after also against been before being between both could during each from have here into most more only other over same should some such than that their them then there these they this those under were what when where which while whose with would your'.split(
    ' ',
  ),
);

const els = {
  slug: document.getElementById('slug'),
  takes: document.getElementById('takes'),
  composer: document.getElementById('composer'),
  question: document.getElementById('question'),
  ask: document.getElementById('ask'),
  modes: document.getElementById('modes'),
  retrievalOnly: document.getElementById('retrieval-only'),
  modeNote: document.getElementById('mode-note'),
  memory: document.getElementById('memory'),
  desk: document.getElementById('desk-slips'),
  announcer: document.getElementById('announcer'),
};

const app = {
  status: null,
  takes: [],
  history: [],
  mode: 'full',
  retrievalOnly: false,
  active: null,
  seq: 0,
  busy: false,
  forgotPending: false,
};

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const slipText = new WeakMap();

// ---------- small DOM helpers ----------

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style')
      for (const [k, v] of Object.entries(value)) el.style.setProperty(k, String(v));
    else if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  add(el, children);
  return el;
}

function add(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === '') continue;
    el.append(child instanceof Node ? child : String(child));
  }
}

const SVG = 'http://www.w3.org/2000/svg';
const ICONS = {
  tick: ['M3.6 13.1c1.6 1.2 3 3 4.3 5.4 2.7-5.9 6.5-10.6 12.5-14.7'],
  query: [
    'M12.4 2.9c5.2 0 8.9 3.9 8.7 9-.2 5.3-4.4 9.3-9.6 9.1-5.1-.2-8.8-4.2-8.6-9.3.2-4.6 3.7-8.2 8.2-8.6',
    'M9.5 9.4c.2-1.7 1.4-2.7 2.9-2.7 1.6 0 2.8 1 2.8 2.4 0 2.2-2.8 2.4-2.9 4.8',
    'M12.3 17.1v.1',
  ],
  cross: ['M5.6 5.8c4.4 4 8.7 8.3 12.9 12.7', 'M18.3 5.5c-4.6 4-8.8 8.4-12.7 13'],
  dash: ['M5.5 12.2c4.3-.4 8.6-.4 13 0'],
  squiggle: ['M2.5 12.5c1.6-3 3.2-3 4.8 0s3.2 3 4.8 0 3.2-3 4.8 0 3.2 3 4.6 0'],
  chevron: ['M7 10l5 5 5-5'],
  external: [
    'M14 5h5v5',
    'M19 5l-8.5 8.5',
    'M18 14.5V18a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3.5',
  ],
  clip: {
    viewBox: '0 0 10 24',
    paths: ['M3 6.5v11.2a3.1 3.1 0 0 0 6.2 0V4.4a2.2 2.2 0 0 0-4.4 0V17a1 1 0 0 0 2 0V8'],
  },
};

function icon(name, extra = '') {
  const spec = Array.isArray(ICONS[name])
    ? { viewBox: '0 0 24 24', paths: ICONS[name] }
    : ICONS[name];
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', spec.viewBox);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', `icon icon-${name} ${extra}`.trim());
  for (const d of spec.paths) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    path.setAttribute('pathLength', '1');
    svg.append(path);
  }
  return svg;
}

/** **bold**, *italic* and `code` from the model's Markdown; everything else stays text. */
function inline(text) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) out.push(h('strong', {}, t.slice(2, -2)));
    else if (t.startsWith('`')) out.push(h('code', {}, t.slice(1, -1)));
    else out.push(h('em', {}, t.slice(1, -1)));
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// ---------- number formats: exact, never rounded up ----------

const floorTo = (x, digits) => Math.floor(x * 10 ** digits + 1e-9) / 10 ** digits;
const score = (x) => (x === null || x === undefined ? '–' : floorTo(x, 4).toFixed(4));
const pct = (x) => {
  const v = floorTo(x * 100, 1);
  return `${Number.isInteger(v) ? v : v.toFixed(1)}%`;
};
const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;
const modeName = (m) => MODE_NAMES[m] ?? m;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const sectionPath = (s) => s.replaceAll(' > ', ' › ');
const isHttp = (uri) => /^https?:\/\//i.test(uri);
const listNumbers = (ns) =>
  ns.length <= 1 ? `${ns[0] ?? ''}` : `${ns.slice(0, -1).join(', ')} and ${ns.at(-1)}`;

function norm(word) {
  return word.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
}

function contentWords(text) {
  const words = new Set();
  for (const w of text.match(/[\p{L}\p{N}]+/gu) ?? []) {
    const n = norm(w);
    if ((n.length >= 4 && !STOP.has(n)) || /\d/.test(n)) words.add(n);
  }
  return words;
}

// ---------- API ----------

async function api(path, body, signal) {
  const init = body
    ? {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      }
    : { signal };
  const res = await fetch(path, init);
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}`, kind: 'internal' }));
  if (!res.ok) {
    const error = new Error(data.error ?? `HTTP ${res.status}`);
    error.kind = data.kind;
    error.hint = data.hint;
    throw error;
  }
  return data;
}

function announce(text) {
  els.announcer.textContent = '';
  requestAnimationFrame(() => (els.announcer.textContent = text));
}

// ---------- status slug and composer ----------

async function loadStatus() {
  app.status = null;
  renderSlug();
  renderComposer();
  try {
    app.status = await api('/api/status');
  } catch (error) {
    app.status = { ready: false, error: error.message, kind: 'internal', hint: null };
  }
  renderSlug();
  renderComposer();
  if (app.takes.length === 0) renderBlank();
  if (app.status.ready && window.matchMedia('(min-width: 761px)').matches) els.question.focus();
}

async function refreshStatus() {
  try {
    const status = await api('/api/status');
    if (status.ready) app.status = status;
    renderSlug();
  } catch {
    // The slug keeps the last known status.
  }
}

function renderSlug() {
  const s = app.status;
  const items = [h('span', { class: 'slug-item slug-name' }, 'rag-implementation')];
  if (!s) {
    items.push(h('span', { class: 'slug-item' }, 'Loading models and connecting to the database…'));
  } else if (!s.ready) {
    items.push(
      h('span', { class: 'slug-item slug-error' }, s.error),
      s.hint ? h('span', { class: 'slug-item' }, s.hint) : null,
      h(
        'span',
        { class: 'slug-item' },
        h('button', { type: 'button', onclick: loadStatus }, 'Retry'),
      ),
    );
  } else {
    const model = s.lastModel ?? s.model;
    // Short items leave the model id room to show in full, ':free' suffix included.
    items.push(
      ...(s.collection === s.domain
        ? [h('span', { class: 'slug-item' }, `Domain and collection ${s.domain}`)]
        : [
            h('span', { class: 'slug-item' }, `Domain ${s.domain}`),
            h('span', { class: 'slug-item' }, `Collection ${s.collection}`),
          ]),
    );
    items.push(
      h(
        'span',
        { class: 'slug-item slug-model', title: model ?? null },
        // ':free' is the zero-cost lock: when the id must shorten, only the name before it does.
        model && s.hasKey && model.endsWith(':free')
          ? [
              h('span', {}, `Model ${model.slice(0, -':free'.length)}`),
              h('b', { class: 'model-free' }, ':free'),
            ]
          : h(
              'span',
              {},
              !s.hasKey
                ? 'No OpenRouter key: retrieval only'
                : model
                  ? `Model ${model}`
                  : 'Model: free, picked on first answer',
            ),
      ),
    );
    if (s.hasKey) {
      const q = s.quota;
      items.push(
        h(
          'span',
          {
            class: `slug-item${q.used >= q.warnAt ? ' warn' : ''}`,
            title: 'Free OpenRouter requests used today; the counter resets at UTC midnight',
          },
          `Quota ${q.used}/${q.blockAt} today`,
        ),
        h('span', { class: 'slug-item' }, 'Key set'),
      );
    }
  }
  // The wrapper clips the divider of whichever item starts a wrapped line.
  els.slug.replaceChildren(h('div', { class: 'slug-items' }, items));
}

function buildModes() {
  const modes = app.status?.modes ?? Object.keys(MODE_NAMES);
  els.modes.replaceChildren(
    h('legend', { class: 'visually-hidden' }, 'Pipeline mode'),
    ...modes.map((m) =>
      h(
        'label',
        { class: 'mode' },
        h('input', {
          type: 'radio',
          name: 'mode',
          value: m,
          checked: m === app.mode,
          onchange: () => {
            app.mode = m;
            renderComposer();
          },
        }),
        h('span', {}, modeName(m)),
      ),
    ),
  );
}

function renderComposer() {
  const s = app.status;
  const ready = Boolean(s?.ready);
  if (els.modes.querySelectorAll('input').length === 0) buildModes();
  for (const input of els.modes.querySelectorAll('input')) {
    input.checked = input.value === app.mode;
    input.disabled = !ready || app.busy;
  }
  const keyless = ready && !s.hasKey;
  els.retrievalOnly.checked = keyless || app.retrievalOnly;
  els.retrievalOnly.disabled = !ready || keyless || app.busy;
  els.question.disabled = !ready;
  els.ask.disabled = !ready || app.busy;
  els.ask.textContent = app.busy ? 'Working…' : 'Ask';
  const retrieval = keyless || app.retrievalOnly;
  els.modeNote.textContent =
    MODE_NOTES[app.mode] +
    (retrieval
      ? ' Retrieval only: no answer is written and no quota is used.'
      : app.mode === 'full'
        ? ''
        : ' Sentences are not checked in this mode.');
  const turns = s?.memoryTurns ?? 3;
  const remembered = Math.min(app.history.length, turns);
  els.memory.replaceChildren();
  add(els.memory, [
    remembered === 0
      ? `Memory: empty. Follow-up questions can refer back up to ${turns} turns.`
      : `Memory: ${remembered} of ${turns} turns. `,
    remembered > 0 ? h('button', { type: 'button', onclick: forget }, 'Forget') : null,
  ]);
}

function forget() {
  app.history = [];
  app.forgotPending = true;
  renderComposer();
  announce('Memory cleared. The next question stands alone.');
  els.question.focus();
}

function autosize() {
  els.question.style.height = 'auto';
  els.question.style.height = `${els.question.scrollHeight}px`;
}

// ---------- first page ----------

function renderBlank() {
  const s = app.status;
  const thr = s?.ready ? score(s.thresholds.support) : null;
  const suggestions = s?.ready ? s.suggestions.slice(0, 5) : [];
  const blank = h(
    'article',
    { class: 'take blank' },
    h(
      'div',
      { class: 'row' },
      h(
        'div',
        { class: 'set' },
        h('h2', {}, 'Ask the corpus a question'),
        h(
          'p',
          {},
          'Every answer comes back as a checked proof. Before you read it, each sentence is compared with the passage it cites and marked in the margin.',
        ),
        h(
          'dl',
          { class: 'legend' },
          h(
            'div',
            {},
            h('dt', { class: 'tick' }, icon('tick')),
            h(
              'dd',
              {},
              h('b', {}, 'Supported. '),
              `A cited passage backs the sentence${thr ? ` (similarity of at least ${thr})` : ''}.`,
            ),
          ),
          h(
            'div',
            {},
            h('dt', { class: 'query' }, icon('query')),
            h(
              'dd',
              {},
              h('b', {}, 'Queried. '),
              'No cited passage backs it, or it cites nothing. It stays in the answer, marked.',
            ),
          ),
          h(
            'div',
            {},
            h('dt', {}, h('span', { class: 'stamp' }, 'Held')),
            h(
              'dd',
              {},
              h('b', {}, 'Held. '),
              'The sources do not cover the question, so nothing is written from outside them.',
            ),
          ),
        ),
        suggestions.length
          ? h(
              'div',
              { class: 'try' },
              h('h3', {}, 'From this domain’s evaluation set'),
              h(
                'ul',
                {},
                suggestions.map((q) =>
                  h(
                    'li',
                    {},
                    h(
                      'button',
                      { type: 'button', onclick: () => submit(q) },
                      h('span', {}, q),
                      icon('chevron'),
                    ),
                  ),
                ),
              ),
            )
          : null,
      ),
      h(
        'div',
        { class: 'margin-col' },
        h(
          'p',
          { class: 'margin-note' },
          'The checker’s marks appear in this margin, level with the sentence they check, with the exact similarity score.',
        ),
        h('p', { class: 'margin-note' }, 'Each answer’s sources are laid out beside it as slips.'),
      ),
    ),
  );
  els.takes.replaceChildren(blank);
}

// ---------- asking ----------

async function submit(text, override = {}) {
  const question = text.trim();
  if (!question || app.busy || !app.status?.ready) return;
  const take = {
    key: ++app.seq,
    question,
    mode: override.mode ?? app.mode,
    retrievalOnly: override.retrievalOnly ?? (app.retrievalOnly || !app.status.hasKey),
    phase: 'pending',
    started: performance.now(),
    history: app.history.slice(-app.status.memoryTurns),
    forgottenBefore: app.forgotPending && app.takes.length > 0,
  };
  app.forgotPending = false;
  app.takes.push(take);
  app.busy = true;
  els.question.value = '';
  autosize();
  renderComposer();
  const el = renderTake(take);
  el.scrollIntoView({ block: 'start', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  take.abort = new AbortController();
  const timer = setInterval(() => {
    const out = document.querySelector(`#take-${take.key} .elapsed`);
    if (out) out.textContent = secs(performance.now() - take.started);
  }, 100);
  try {
    take.view = await api(
      '/api/ask',
      { question, mode: take.mode, retrievalOnly: take.retrievalOnly, history: take.history },
      take.abort.signal,
    );
    take.phase = 'done';
    if (take.view.status !== 'retrieval') app.history.push(take.view.turn);
    app.active = take.key;
    announce(summary(take));
  } catch (error) {
    if (error.name === 'AbortError') take.phase = 'stopped';
    else {
      take.phase = 'error';
      take.error = error;
      announce(`Could not answer: ${error.message}`);
    }
  } finally {
    clearInterval(timer);
    take.elapsed = performance.now() - take.started;
    app.busy = false;
  }
  const done = renderTake(take, { checking: take.phase === 'done' });
  if (take.phase === 'done') renderDesk(true);
  // Bring the finished take to the top unless the reader already scrolled it into place.
  if (done.getBoundingClientRect().top > window.innerHeight * 0.3)
    done.scrollIntoView({ block: 'start', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  renderComposer();
  els.question.focus({ preventScroll: true });
  refreshStatus();
}

function retry(take, override = {}) {
  app.takes = app.takes.filter((t) => t !== take);
  document.getElementById(`take-${take.key}`)?.remove();
  submit(take.question, { mode: take.mode, retrievalOnly: take.retrievalOnly, ...override });
}

function summary(take) {
  const v = take.view;
  if (v.status === 'held' || v.status === 'refused')
    return 'Held: the sources do not cover this question.';
  if (v.status === 'retrieval')
    return `Retrieval only: ${plural(v.sources.length, 'passage')} found.`;
  if (v.checkedCount > 0)
    return `Answer ready. ${v.supportedCount} of ${plural(v.checkedCount, 'sentence')} supported.`;
  return 'Answer ready, not checked in this mode.';
}

// ---------- a take ----------

function renderTake(take, options = {}) {
  const el = buildTake(take);
  els.takes.querySelector('.blank')?.remove();
  const old = document.getElementById(`take-${take.key}`);
  if (old) old.replaceWith(el);
  else els.takes.append(el);
  if (options.checking && !reducedMotion.matches) {
    el.classList.add('checking');
    setTimeout(() => el.classList.remove('checking'), 2800);
  }
  requestAnimationFrame(() => layoutMarks(el));
  return el;
}

function buildTake(take) {
  const el = h('article', {
    class: `take${take.forgottenBefore ? ' forgotten' : ''}`,
    id: `take-${take.key}`,
    'aria-labelledby': `q-${take.key}`,
  });
  el.append(
    h(
      'header',
      { class: 'take-head row' },
      h('h2', { class: 'take-q', id: `q-${take.key}` }, take.question),
      h('p', { class: 'take-meta' }, metaLine(take)),
    ),
  );
  if (take.phase === 'pending') el.append(pendingBody(take));
  else if (take.phase === 'error') el.append(errorBody(take));
  else if (take.phase === 'stopped') el.append(stoppedBody(take));
  else {
    el.append(answerBody(take), signoff(take), tools(take));
    if (take.traceOpen) el.append(fileSection(take));
    el.append(takeSlips(take));
    el.addEventListener('pointerenter', () => setActive(take.key));
    el.addEventListener('focusin', () => setActive(take.key));
  }
  return el;
}

function metaLine(take) {
  const v = take.view;
  return [
    h('b', {}, modeName(take.mode)),
    take.retrievalOnly ? ', retrieval only' : '',
    v?.trace.intent ? ` · ${v.trace.intent} intent` : '',
    take.elapsed !== undefined ? ` · ${secs(take.elapsed)}` : '',
  ];
}

function pendingBody(take) {
  return h(
    'div',
    { class: 'take-body row' },
    h(
      'div',
      { class: 'set' },
      h(
        'p',
        { class: 'pending-line' },
        take.retrievalOnly
          ? 'Searching the corpus. No answer will be written.'
          : 'Searching the corpus, writing the answer, then checking each sentence. This usually takes 5 to 20 seconds.',
      ),
      h(
        'button',
        { class: 'link-button stop', type: 'button', onclick: () => take.abort?.abort() },
        'Stop waiting',
      ),
    ),
    h(
      'div',
      { class: 'margin-col' },
      h('p', { class: 'working' }, icon('squiggle'), h('span', { class: 'elapsed' }, '0.0 s')),
    ),
  );
}

function errorBody(take) {
  const e = take.error;
  const offerRetrieval = !take.retrievalOnly && ['quota', 'no-key', 'llm'].includes(e.kind);
  return h(
    'div',
    { class: 'take-body row' },
    h(
      'div',
      {},
      h(
        'p',
        { class: 'error-note' },
        icon('query'),
        h('span', {}, h('b', {}, 'Could not answer. '), e.message),
      ),
      e.hint ? h('p', { class: 'error-hint' }, e.hint) : null,
      h(
        'div',
        { class: 'tools' },
        h(
          'button',
          { class: 'link-button', type: 'button', onclick: () => retry(take) },
          'Try again',
        ),
        offerRetrieval
          ? h(
              'button',
              {
                class: 'link-button',
                type: 'button',
                onclick: () => retry(take, { retrievalOnly: true }),
              },
              'Run retrieval only',
            )
          : null,
      ),
    ),
    h('div'),
  );
}

function stoppedBody(take) {
  return h(
    'div',
    { class: 'take-body row' },
    h(
      'div',
      { class: 'set' },
      h(
        'p',
        { class: 'pending-line' },
        'Stopped waiting. The server may still finish this request and count it against the quota.',
      ),
      h(
        'div',
        { class: 'tools' },
        h(
          'button',
          { class: 'link-button', type: 'button', onclick: () => retry(take) },
          'Ask again',
        ),
      ),
    ),
    h('div'),
  );
}

function answerBody(take) {
  const v = take.view;
  const set = h('div', { class: 'set' });
  const marks = h('div', { class: 'marks margin-col' });
  if (v.status === 'answered') {
    const numbered = v.sentences.map((s, i) => ({ ...s, i }));
    const answer = numbered.filter((s) => s.part === 'answer');
    const points = numbered.filter((s) => s.part === 'point');
    if (answer.length) set.append(h('p', {}, joinSpaced(answer.map((s) => sentenceSpan(s, take)))));
    if (points.length)
      set.append(
        h('h3', { class: 'points-head' }, 'Key points'),
        h(
          'ul',
          {},
          points.map((s) => h('li', {}, sentenceSpan(s, take))),
        ),
      );
    marks.setAttribute('aria-label', 'Checker’s marks');
    numbered.forEach((s) => marks.append(markButton(s, take)));
  } else if (v.status === 'held' || v.status === 'refused') {
    const g = v.trace.gate;
    set.append(
      h('p', {}, h('span', { class: 'stamp' }, 'Held'), v.refusal),
      h(
        'p',
        { class: 'held-why' },
        v.status === 'held'
          ? `Nothing retrieved cleared the evidence gate (best ${score(g.bestScore)}, needs ${score(g.threshold)}), so the model was not called and no quota was used.`
          : `The model read the ${plural(v.sources.length, 'retrieved passage')} and found they do not answer the question. Nothing was written from outside them.`,
      ),
    );
    if (v.notes.length)
      set.append(
        h(
          'div',
          { class: 'notes' },
          h('h3', { class: 'points-head' }, 'The model’s notes (not checked)'),
          h(
            'ul',
            {},
            v.notes.map((s, j) => h('li', {}, sentenceSpan({ ...s, i: `n${j}` }, take))),
          ),
        ),
      );
    marks.append(
      h(
        'p',
        { class: 'margin-note' },
        v.status === 'held'
          ? `Gate ${score(g.bestScore)} < ${score(g.threshold)}`
          : 'Declined by the model',
      ),
      h(
        'p',
        { class: 'margin-note' },
        v.status === 'held' ? 'No LLM call' : plural(v.sources.length, 'passage') + ' read',
      ),
    );
  } else {
    const g = v.trace.gate;
    set.append(
      h(
        'p',
        {},
        `Retrieval only: no answer was written. These are the ${plural(v.sources.length, 'passage')} the ${modeName(v.mode)} pipeline would send to the model.`,
      ),
    );
    if (g?.applied)
      set.append(
        h(
          'p',
          { class: 'held-why' },
          g.passed
            ? `The evidence gate would let it through (best ${score(g.bestScore)}, needs ${score(g.threshold)}).`
            : `The evidence gate would hold it (best ${score(g.bestScore)}, needs ${score(g.threshold)}): the model would not be called.`,
        ),
      );
    marks.append(
      h('p', { class: 'margin-note' }, plural(v.sources.length, 'passage')),
      h('p', { class: 'margin-note' }, `${v.trace.contextTokens} tokens of context`),
    );
  }
  return h('div', { class: 'take-body row' }, set, marks);
}

function joinSpaced(nodes) {
  return nodes.flatMap((n, i) => (i === 0 ? [n] : [' ', n]));
}

function sentenceSpan(s, take) {
  const sources = take.view.sources.length;
  // The last word, its citations and its mark never break apart (a lone '2,3' on a new line).
  const split = /^(.*?)(\S+)$/s.exec(s.text);
  const bind = split !== null && !/[*`]/.test(split[2]);
  const cites = s.citations.length
    ? h(
        'span',
        { class: 'cites' },
        s.citations.map((n, j) => [
          j > 0 ? ',' : null,
          h(
            'button',
            {
              class: `cite${n > sources ? ' invalid' : ''}`,
              type: 'button',
              'aria-label': n > sources ? `Source ${n} does not exist` : `Show source ${n}`,
              title: n > sources ? 'This source number is not in the context' : null,
              onclick: () => focusSlip(take, n),
            },
            n,
          ),
        ]),
      )
    : null;
  const span = h(
    'span',
    {
      class: `s${s.supported === false ? ' q' : ''}`,
      'data-i': s.i,
      style: { '--i': typeof s.i === 'number' ? s.i : 0 },
    },
    inline(bind ? split[1] : s.text),
    h('span', { class: 'tail' }, bind ? split[2] : null, cites, inlineMark(s)),
  );
  span.addEventListener('pointerenter', () => light(take, s, true));
  span.addEventListener('pointerleave', () => light(take, s, false));
  return span;
}

function inlineMark(s) {
  if (s.supported === null) return null;
  return h(
    'span',
    { class: `inline-mark ${s.supported ? 'tick' : 'query'}`, 'aria-hidden': 'true' },
    icon(s.supported ? 'tick' : 'query'),
    s.supported || s.citations.length ? score(s.support) : 'no source',
  );
}

function markButton(s, take) {
  const thr = take.view.thresholds.support;
  const sourceText =
    s.citations.length === 1 ? `source ${s.citations[0]}` : `best of ${listNumbers(s.citations)}`;
  let kind;
  let value;
  let why;
  let label;
  if (s.supported === true) {
    kind = 'tick';
    value = score(s.support);
    why = sourceText;
    label = `Sentence ${s.i + 1}: supported. Similarity ${value} with ${sourceText}, needs ${score(thr)}. Show the source.`;
  } else if (s.supported === false) {
    kind = 'query';
    if (s.citations.length === 0) {
      value = 'Query';
      why = 'no source cited';
      label = `Sentence ${s.i + 1}: queried, it cites no source.`;
    } else {
      value = score(s.support);
      why = `below ${score(thr)}, ${sourceText}`;
      label = `Sentence ${s.i + 1}: queried. Similarity ${value} with ${sourceText} is below ${score(thr)}. Show the source.`;
    }
  } else {
    kind = 'unchecked';
    value = 'Not checked';
    why = `${modeName(take.view.mode)} mode`;
    label = `Sentence ${s.i + 1}: not checked in ${modeName(take.view.mode)} mode.`;
  }
  const props = {
    class: `mark ${kind}`,
    'data-i': s.i,
    style: { '--i': s.i },
    'aria-label': label,
  };
  const content = [
    icon(kind === 'tick' ? 'tick' : kind === 'query' ? 'query' : 'dash'),
    h('span', {}, h('span', { class: 'val' }, value), h('span', { class: 'why' }, why)),
  ];
  if (kind === 'unchecked') return h('div', props, content);
  const button = h(
    'button',
    {
      ...props,
      type: 'button',
      onclick: () => s.citations.length && focusSlip(take, s.citations[0]),
    },
    content,
  );
  for (const [type, on] of [
    ['pointerenter', true],
    ['pointerleave', false],
    ['focus', true],
    ['blur', false],
  ])
    button.addEventListener(type, () => light(take, s, on));
  return button;
}

/** Places each mark level with the first line of its sentence, pushing down to avoid overlap. */
function layoutMarks(el) {
  const marks = el.querySelector('.marks');
  if (!marks || marks.offsetParent === null) return;
  const buttons = [...marks.querySelectorAll('.mark')];
  if (buttons.length === 0) return;
  const base = marks.getBoundingClientRect().top;
  let floor = 0;
  for (const b of buttons) {
    const s = el.querySelector(`.s[data-i="${b.dataset.i}"]`);
    if (!s) continue;
    const rect = s.getClientRects()[0] ?? s.getBoundingClientRect();
    const top = Math.max(Math.round(rect.top - base) - 1, floor);
    b.style.top = `${top}px`;
    floor = top + b.offsetHeight + 6;
  }
  marks.style.minHeight = `${floor}px`;
}

let layoutQueued = false;
function layoutAll() {
  if (layoutQueued) return;
  layoutQueued = true;
  requestAnimationFrame(() => {
    layoutQueued = false;
    for (const el of els.takes.querySelectorAll('.take')) layoutMarks(el);
  });
}

function signoff(take) {
  const v = take.view;
  const left = h('div', {});
  if (v.status === 'answered') {
    const ver = v.trace.verification;
    if (v.mode === 'full' && v.checkedCount > 0 && ver) {
      const queried = v.checkedCount - v.supportedCount;
      const reasons = [];
      if (ver.groundingScore < v.thresholds.pass)
        reasons.push(`it needs ${pct(v.thresholds.pass)} supported`);
      if (!ver.citationsValid) reasons.push('the citations are not all valid');
      if (ver.structureErrors.length)
        reasons.push('the answer does not follow the required structure');
      left.append(
        h(
          'p',
          { class: 'verdict' },
          h(
            'b',
            {},
            `Checked ${plural(v.checkedCount, 'sentence')}: ${v.supportedCount} supported`,
          ),
          queried ? h('span', { class: 'below' }, `, ${queried} queried`) : '',
          `. ${pct(v.confidence)} supported; `,
          ver.passed
            ? `the grounding check passed (it needs ${pct(v.thresholds.pass)}).`
            : h(
                'span',
                { class: 'below' },
                `the grounding check did not pass: ${reasons.join('; ')}.`,
              ),
        ),
      );
      const problems = [
        ...ver.invalidCitations.map(
          (n) => `Source ${n} is cited but does not exist in the context.`,
        ),
        ...ver.structureErrors.map((e) => `Structure: ${e}.`),
      ];
      if (problems.length)
        left.append(
          h(
            'ul',
            { class: 'verdict-list' },
            problems.map((p) => h('li', {}, p)),
          ),
        );
    } else {
      left.append(
        h(
          'p',
          { class: 'verdict' },
          `Not checked: ${modeName(v.mode)} mode skips the sentence check. Ask again in Full mode to verify each sentence.`,
        ),
      );
    }
  } else if (v.status === 'held' || v.status === 'refused') {
    left.append(
      h(
        'p',
        { class: 'verdict' },
        h('b', {}, 'Held. '),
        'The system declined rather than answer beyond its sources. If the corpus should cover this, open the trace to see what was retrieved.',
      ),
    );
  } else {
    left.append(
      h(
        'p',
        { class: 'verdict' },
        'Retrieval only. Open the trace for every stage, or switch Retrieval only off to get a written, checked answer.',
      ),
    );
  }
  return h(
    'footer',
    { class: 'signoff row' },
    left,
    h('div', { class: 'margin-col' }, rating(take)),
  );
}

function rating(take) {
  if (take.view.status === 'retrieval') return null;
  const button = (cls, value, text, glyph) =>
    h(
      'button',
      {
        class: cls,
        type: 'button',
        'aria-pressed': String(take.rating === value),
        disabled: Boolean(take.rating) || take.rating === 'saving',
        onclick: () => rate(take, value),
      },
      icon(glyph),
      text,
    );
  return h(
    'div',
    { class: 'rate', role: 'group', 'aria-label': 'Rate this answer' },
    h('span', { class: 'rate-label' }, 'Rate this answer'),
    button('good', 'up', 'Good', 'tick'),
    button('bad', 'down', 'Bad', 'cross'),
    take.rateMessage ? h('span', { class: 'rate-saved' }, take.rateMessage) : null,
  );
}

async function rate(take, value) {
  try {
    await api('/api/feedback', { id: take.view.id, rating: value });
    take.rating = value;
    take.rateMessage = 'Saved to data/feedback.jsonl. npm run train:reranker learns from it.';
  } catch (error) {
    take.rateMessage = `Not saved: ${error.message}`;
  }
  renderTake(take);
}

function tools(take) {
  const c = take.compare;
  return h(
    'div',
    { class: 'tools' },
    h(
      'button',
      {
        class: 'link-button',
        type: 'button',
        'aria-expanded': String(Boolean(take.traceOpen)),
        'aria-controls': `file-${take.key}`,
        onclick: () => {
          take.traceOpen = !take.traceOpen;
          renderTake(take);
        },
      },
      take.traceOpen ? 'Hide the trace' : 'Show the trace',
      icon('chevron'),
    ),
    h(
      'button',
      {
        class: 'link-button',
        type: 'button',
        disabled: c?.phase === 'pending' || app.busy,
        onclick: () => runCompare(take),
      },
      c?.phase === 'pending'
        ? 'Comparing modes…'
        : c?.phase === 'done'
          ? 'Compare modes again'
          : 'Compare modes',
    ),
  );
}

async function runCompare(take) {
  take.compare = { phase: 'pending' };
  take.traceOpen = true;
  renderTake(take);
  document.getElementById(`compare-${take.key}`)?.scrollIntoView({ block: 'nearest' });
  try {
    take.compare = {
      phase: 'done',
      data: await api('/api/compare', { question: take.question, history: take.history }),
    };
  } catch (error) {
    take.compare = { phase: 'error', error };
  }
  renderTake(take);
  document.getElementById(`compare-${take.key}`)?.scrollIntoView({
    block: 'nearest',
    behavior: reducedMotion.matches ? 'auto' : 'smooth',
  });
}

// ---------- the trace ----------

function fact(label, value) {
  return h('div', {}, h('dt', {}, label), h('dd', {}, value));
}

function fileSection(take) {
  const v = take.view;
  const t = v.trace;
  const file = h('section', { class: 'file', id: `file-${take.key}`, 'aria-label': 'Trace' });
  file.append(
    h('h3', {}, 'Query'),
    h(
      'dl',
      { class: 'file-facts' },
      fact('Intent', t.intent ? `${t.intent} (${t.intentSource})` : '–'),
      t.retrievalQuery
        ? fact('Retrieval query (with remembered entities)', t.retrievalQuery)
        : null,
      fact('Mode', modeName(v.mode) + (take.retrievalOnly ? ', retrieval only' : '')),
      fact('Collection', v.collection ?? 'all'),
      fact('Context', `${plural(v.sources.length, 'passage')}, ${t.contextTokens} tokens`),
      fact('Model', t.model ?? 'not called'),
      t.usage
        ? fact(
            'Tokens',
            `${t.usage.promptTokens ?? '–'} in, ${t.usage.completionTokens ?? '–'} out`,
          )
        : null,
      fact('Pipeline time', `${t.totalMs} ms`),
    ),
    h('h3', {}, 'Stages'),
    stages(v),
    h('h3', {}, `Ranking (top ${t.ranked.length} of ${t.rankedTotal})`),
    rankingTable(v),
  );
  if (t.graphTotal > 0)
    file.append(
      h('h3', {}, `Graph expansion (${t.graph.length} of ${t.graphTotal})`),
      pathsList(t),
    );
  file.append(h('h3', {}, 'Search hits'), hitsLists(t));
  if (t.warnings.length)
    file.append(
      h('h3', {}, 'Warnings'),
      h(
        'ul',
        { class: 'warnings' },
        t.warnings.map((w) => h('li', {}, w)),
      ),
    );
  if (take.compare) file.append(compareSection(take));
  return file;
}

function stages(v) {
  const t = v.trace;
  const tm = t.timings;
  const m = v.mode;
  const graph = ['graph', 'rerank', 'full'].includes(m);
  const rerank = ['rerank', 'full'].includes(m);
  const list = [
    { name: 'Intent', detail: t.intent ?? '–', ms: tm.classifyIntent, ran: true },
    {
      name: 'Search',
      detail:
        m === 'vector'
          ? `${t.vectorTotal} vector hits`
          : `${t.vectorTotal} vector + ${t.fulltextTotal} fulltext → ${t.fusedTotal} fused`,
      ms: tm.hybridRetrieve,
      ran: true,
    },
    {
      name: 'Graph',
      detail: graph ? `+${t.graphTotal} passages` : 'not in this mode',
      ms: tm.expandGraph,
      ran: graph,
    },
    {
      name: 'Rank',
      detail: rerank ? `reranker: ${app.status?.reranker ?? '–'}` : 'no reranker',
      ms: tm.rank,
      ran: true,
    },
    {
      name: 'Gate',
      detail: t.gate?.applied
        ? `${score(t.gate.bestScore)} ${t.gate.passed ? '≥' : '<'} ${score(t.gate.threshold)}`
        : 'Full mode only',
      ran: Boolean(t.gate?.applied),
      held: Boolean(t.gate?.applied && !t.gate.passed),
    },
    {
      name: 'Answer',
      detail: t.model
        ? `${t.usage?.totalTokens ?? '–'} tokens`
        : v.status === 'retrieval'
          ? 'retrieval only'
          : 'not called',
      ms: tm.generate,
      ran: Boolean(t.model),
    },
    {
      name: 'Check',
      detail: t.verification ? `${pct(t.verification.groundingScore)} supported` : 'Full mode only',
      ms: tm.verify,
      ran: Boolean(t.verification),
    },
  ];
  return h(
    'ol',
    { class: 'stages' },
    list.map((s) =>
      h(
        'li',
        { class: `stage${s.ran ? '' : ' skipped'}${s.held ? ' held' : ''}` },
        h('b', {}, s.name),
        h('span', {}, s.detail),
        h('span', {}, s.ms !== undefined ? `${s.ms} ms` : ''),
      ),
    ),
  );
}

function rankingTable(v) {
  const t = v.trace;
  const cited = new Set(v.sources.filter((s) => s.cited).map((s) => s.chunkId));
  const gate = t.gate?.applied ? t.gate.threshold : null;
  const bar = (x) =>
    h(
      'span',
      {
        class: 'bar',
        style: { '--v': Math.max(0, Math.min(1, x)), ...(gate !== null ? { '--t': gate } : {}) },
      },
      h('i'),
      gate !== null ? h('b', { title: `Evidence gate ${score(gate)}` }) : null,
    );
  return h(
    'div',
    { class: 'scroll' },
    h(
      'table',
      { class: 'ledger' },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          ['#', 'Passage', 'Score (0 to 1)', 'Cosine', 'Vector', 'Fulltext', 'Via', 'Source'].map(
            (c, i) => h('th', { class: i >= 2 ? 'fig' : null, scope: 'col' }, c),
          ),
        ),
      ),
      h(
        'tbody',
        {},
        t.ranked.map((r) =>
          h(
            'tr',
            {
              class:
                [r.contextN ? 'in-context' : '', cited.has(r.chunkId) ? 'cited' : '']
                  .join(' ')
                  .trim() || null,
            },
            h('td', { class: 'fig' }, r.rank),
            h('td', { class: 'chunk' }, r.title, h('small', {}, sectionPath(r.section))),
            h('td', { class: 'fig' }, bar(r.score), score(r.score)),
            h('td', { class: 'fig' }, score(r.cosine)),
            h('td', { class: 'fig' }, r.vectorRank ? `#${r.vectorRank}` : '–'),
            h('td', { class: 'fig' }, r.fulltextRank ? `#${r.fulltextRank}` : '–'),
            h('td', { class: 'fig' }, r.expansion ?? '–'),
            h('td', { class: 'fig' }, r.contextN ? `[${r.contextN}]` : '–'),
          ),
        ),
      ),
    ),
  );
}

const VIA = { next: 'next passage', entity: 'shared entities', link: 'article link' };

function pathsList(t) {
  return h(
    'ol',
    { class: 'paths' },
    t.graph.map((p) =>
      h(
        'li',
        {},
        sectionPath(p.from),
        ' → ',
        h('span', { class: 'via' }, VIA[p.kind] ?? p.kind),
        ' → ',
        sectionPath(p.to),
        p.through.length
          ? h(
              'small',
              {},
              `Through ${p.through.join(', ')}${p.throughTotal > p.through.length ? ` and ${p.throughTotal - p.through.length} more` : ''}`,
            )
          : null,
      ),
    ),
  );
}

function hitsLists(t) {
  const list = (title, hits, total) =>
    h(
      'div',
      {},
      h('h4', {}, `${title} (top ${hits.length} of ${total})`),
      hits.length
        ? h(
            'ol',
            {},
            hits.map((x) =>
              h(
                'li',
                {},
                `${x.title} › ${sectionPath(x.section)} `,
                h('span', { class: 'score' }, score(x.score)),
              ),
            ),
          )
        : h('p', { class: 'file-note' }, 'None in this mode.'),
    );
  return h(
    'div',
    { class: 'hits' },
    list('Vector, cosine similarity 0 to 1', t.vector, t.vectorTotal),
    list('Fulltext, Lucene relevance (unbounded)', t.fulltext, t.fulltextTotal),
  );
}

function compareSection(take) {
  const c = take.compare;
  const section = h(
    'section',
    { class: 'compare', id: `compare-${take.key}` },
    h('h3', {}, 'Context by mode'),
    h(
      'p',
      { class: 'file-note' },
      'The same question through each pipeline, retrieval only: no LLM calls and no quota used. Each number is the passage’s position in the context that mode would send.',
    ),
    h('p', { class: 'file-note scroll-hint' }, 'Swipe the table sideways to see every mode.'),
  );
  if (c.phase === 'pending') {
    section.append(h('p', { class: 'working' }, icon('squiggle'), 'Running five retrievals…'));
    return section;
  }
  if (c.phase === 'error') {
    section.append(h('p', { class: 'error-note' }, icon('query'), c.error.message));
    return section;
  }
  const modes = c.data.modes;
  const cited = new Set(take.view.sources.filter((s) => s.cited).map((s) => s.chunkId));
  const rows = new Map();
  for (const m of [...modes].reverse())
    for (const p of m.context) if (!rows.has(p.chunkId)) rows.set(p.chunkId, p);
  const cell = (m, id) => {
    const pos = m.context.findIndex((p) => p.chunkId === id);
    return h(
      'td',
      { class: m.mode === 'full' ? 'full' : null },
      pos >= 0 ? h('span', { class: 'rank' }, pos + 1) : '',
    );
  };
  section.append(
    h(
      'div',
      { class: 'scroll' },
      h(
        'table',
        { class: 'matrix' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', { scope: 'col' }, 'Passage'),
            modes.map((m) =>
              h('th', { scope: 'col', class: m.mode === 'full' ? 'full' : null }, modeName(m.mode)),
            ),
          ),
        ),
        h(
          'tbody',
          {},
          [...rows.values()].map((p) =>
            h(
              'tr',
              { class: cited.has(p.chunkId) ? 'cited' : null },
              h('td', {}, `${p.title} › ${sectionPath(p.section)}`),
              modes.map((m) => cell(m, p.chunkId)),
            ),
          ),
        ),
        h(
          'tfoot',
          {},
          h(
            'tr',
            {},
            h('td', {}, 'Evidence gate'),
            modes.map((m) =>
              h(
                'td',
                { class: m.mode === 'full' ? 'full' : null },
                m.gate?.applied ? (m.gate.passed ? 'pass' : 'hold') : '–',
              ),
            ),
          ),
          h(
            'tr',
            {},
            h('td', {}, 'Time'),
            modes.map((m) =>
              h('td', { class: m.mode === 'full' ? 'full' : null }, `${m.totalMs} ms`),
            ),
          ),
        ),
      ),
    ),
  );
  return section;
}

// ---------- slips ----------

function viaText(via) {
  if (via.kind === 'next') return `Reached as the passage next to ${sectionPath(via.from)}.`;
  if (via.kind === 'link') return `Reached through an article link from ${sectionPath(via.from)}.`;
  const names = via.through.slice(0, 3).join(', ');
  return `Reached from ${sectionPath(via.from)} through shared entities: ${names}${via.through.length > 3 ? '…' : ''}.`;
}

function slip(s, i, quiet = false) {
  const long = s.text.length > 520;
  const excerpt = h('p', { class: 'excerpt' }, s.text);
  const el = h(
    'article',
    { class: `slip${quiet ? ' quiet' : ''}`, 'data-n': s.n, style: { '--i': i } },
    quiet ? null : icon('clip', 'clip'),
    h(
      'header',
      { class: 'slip-head' },
      h('span', { class: 'num', 'aria-label': `Source ${s.n}` }, s.n),
      h(
        'div',
        {},
        h('h3', {}, s.title),
        h('p', { class: 'sec' }, `${sectionPath(s.section)} · ${s.locator}`),
      ),
    ),
    excerpt,
    long
      ? h(
          'button',
          {
            class: 'more',
            type: 'button',
            'aria-expanded': 'false',
            onclick: (event) => {
              const open = el.classList.toggle('open');
              event.currentTarget.setAttribute('aria-expanded', String(open));
              event.currentTarget.textContent = open ? 'Show less' : 'Show the whole passage';
            },
          },
          'Show the whole passage',
        )
      : null,
    h(
      'footer',
      { class: 'slip-foot' },
      h('span', {}, `score ${score(s.score)}`),
      h('span', {}, `cos ${score(s.cosine)}`),
      s.vectorRank ? h('span', {}, `vec #${s.vectorRank}`) : null,
      s.fulltextRank ? h('span', {}, `ft #${s.fulltextRank}`) : null,
      isHttp(s.uri)
        ? h(
            'a',
            { href: s.uri, target: '_blank', rel: 'noopener noreferrer' },
            'Open source',
            icon('external'),
          )
        : null,
      s.via ? h('span', { class: 'slip-via' }, viaText(s.via)) : null,
    ),
  );
  slipText.set(el, s.text);
  return el;
}

function slipGroups(v) {
  const cited = v.sources.filter((s) => s.cited);
  if (v.status === 'answered' && cited.length)
    return { primary: cited, rest: v.sources.filter((s) => !s.cited) };
  return { primary: v.sources, rest: [] };
}

function setActive(key) {
  if (app.active === key) return;
  if (!app.takes.find((t) => t.key === key)?.view) return;
  app.active = key;
  renderDesk(true);
}

function renderDesk(arriving = false) {
  const take = app.takes.find((t) => t.key === app.active && t.view);
  if (!take) {
    els.desk.replaceChildren(
      h(
        'p',
        { class: 'desk-empty' },
        'The passages behind an answer are laid out here, one slip per source.',
      ),
    );
    return;
  }
  const v = take.view;
  const { primary, rest } = slipGroups(v);
  const cited = v.status === 'answered' && rest.length < v.sources.length;
  // add() skips the empty branch; replaceChildren would print it as the text "null".
  els.desk.replaceChildren();
  add(els.desk, [
    h('h2', { class: 'desk-head' }, take.question),
    h(
      'p',
      { class: 'desk-meta' },
      cited
        ? `${plural(primary.length, 'source')} cited${rest.length ? `, ${rest.length} more in context` : ''}`
        : v.status === 'retrieval'
          ? `${plural(primary.length, 'passage')} the ${modeName(v.mode)} pipeline would send`
          : `${plural(primary.length, 'passage')} retrieved, none cited`,
    ),
    ...primary.map((s, i) => slip(s, i)),
    rest.length
      ? h(
          'details',
          { class: 'also' },
          h('summary', {}, `Also in context, not cited (${rest.length})`, icon('chevron')),
          rest.map((s, i) => slip(s, i, true)),
        )
      : null,
  ]);
  els.desk.scrollTop = 0;
  if (arriving && !reducedMotion.matches) {
    els.desk.classList.remove('arriving');
    void els.desk.offsetWidth;
    els.desk.classList.add('arriving');
    setTimeout(() => els.desk.classList.remove('arriving'), 1200);
  }
}

function takeSlips(take) {
  const v = take.view;
  const { primary, rest } = slipGroups(v);
  const label =
    v.status === 'answered' && rest.length < v.sources.length
      ? `Sources (${primary.length} cited)`
      : `Passages (${primary.length})`;
  return h(
    'details',
    { class: 'take-slips' },
    h('summary', {}, label, icon('chevron')),
    h(
      'div',
      { class: 'tray' },
      primary.map((s, i) => slip(s, i)),
      rest.map((s, i) => slip(s, i, true)),
    ),
  );
}

function deskVisible() {
  return getComputedStyle(els.desk).display !== 'none';
}

function slipsFor(take, n) {
  const own = [...document.querySelectorAll(`#take-${take.key} .take-slips .slip[data-n="${n}"]`)];
  const desk =
    app.active === take.key ? [...els.desk.querySelectorAll(`.slip[data-n="${n}"]`)] : [];
  return [...desk, ...own];
}

function highlight(el, words) {
  const p = el.querySelector('.excerpt');
  const text = slipText.get(el);
  if (!p || text === undefined) return;
  if (!words) {
    p.textContent = text;
    return;
  }
  p.replaceChildren(
    ...text
      .split(/([\p{L}\p{N}]+)/u)
      .map((part) => (words.has(norm(part)) ? h('mark', {}, part) : part)),
  );
}

function light(take, s, on) {
  const root = document.getElementById(`take-${take.key}`);
  if (!root) return;
  root.querySelector(`.s[data-i="${s.i}"]`)?.classList.toggle('lit', on);
  root.querySelector(`.mark[data-i="${s.i}"]`)?.classList.toggle('lit', on);
  if (on) setActive(take.key);
  const words = on ? contentWords(s.text) : null;
  for (const n of s.citations)
    for (const el of slipsFor(take, n)) {
      el.classList.toggle('lit', on);
      highlight(el, words);
    }
}

function focusSlip(take, n) {
  setActive(take.key);
  let target;
  if (deskVisible()) target = els.desk.querySelector(`.slip[data-n="${n}"]`);
  if (!target) {
    const details = document.querySelector(`#take-${take.key} .take-slips`);
    if (details) details.open = true;
    target = details?.querySelector(`.slip[data-n="${n}"]`);
  }
  if (!target) return;
  const also = target.closest('details.also');
  if (also) also.open = true;
  target.classList.add('open', 'lit');
  target.querySelector('.more')?.setAttribute('aria-expanded', 'true');
  const more = target.querySelector('.more');
  if (more) more.textContent = 'Show less';
  target.scrollIntoView({ block: 'nearest', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  setTimeout(() => target.classList.remove('lit'), 1600);
}

// ---------- wiring ----------

els.composer.addEventListener('submit', (event) => {
  event.preventDefault();
  submit(els.question.value);
});
els.question.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    submit(els.question.value);
  }
});
els.question.addEventListener('input', autosize);
els.retrievalOnly.addEventListener('change', () => {
  app.retrievalOnly = els.retrievalOnly.checked;
  renderComposer();
});

new ResizeObserver(layoutAll).observe(els.takes);
document.fonts?.ready.then(layoutAll);

renderSlug();
renderComposer();
renderBlank();
renderDesk();
loadStatus();
