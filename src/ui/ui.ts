import {
  DEFAULT_PARAMS,
  FONTS,
  generate,
  getFont,
  MAX_LINE_CHARS,
  MAX_LINES,
  PALETTES,
  STRATEGIES,
  SURFACES,
  WarpParams,
} from '../core';

const state: WarpParams = { ...DEFAULT_PARAMS };

let currentSvg = '';
let targetId: string | null = null;
let targetName = '';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const randSeed = (): number => Math.floor(Math.random() * 1_000_000_000);

// Coalesce slider drags and typing to one render per animation frame.
let renderQueued = false;
function scheduleRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    if (renderQueued) render();
  });
}

/** Why some of what's typed won't show up: characters the font doesn't have,
 *  and anything past the line limits. Layout drops both silently. */
function textWarning(): string {
  const font = getFont(state.fontId);
  const missing = new Set<string>();
  for (const ch of state.text) {
    if (ch !== '\n' && ch !== '\r' && font.glyphs[ch] === undefined) missing.add(ch);
  }
  const lines = state.text.split('\n');
  const notes: string[] = [];
  if (missing.size > 0) {
    const list = [...missing].slice(0, 8).join(' ');
    notes.push(`${font.name} doesn't have: ${list}${missing.size > 8 ? ' …' : ''}`);
  }
  if (lines.length > MAX_LINES) notes.push(`only the first ${MAX_LINES} lines are used`);
  if (lines.some((l) => l.length > MAX_LINE_CHARS)) {
    notes.push(`lines are cut off after ${MAX_LINE_CHARS} characters`);
  }
  return notes.join(' · ');
}

function render(): void {
  renderQueued = false;
  const t0 = performance.now();
  const res = generate(state);
  currentSvg = res.svg;
  const box = $('preview');
  // Fit the frame's own proportions inside the panel, capped so a tall canvas
  // can't push the controls off screen.
  const avail = (box.parentElement as HTMLElement).clientWidth || 336;
  const k = Math.min(avail / state.width, 240 / state.height);
  box.style.width = `${Math.round(state.width * k)}px`;
  box.style.height = `${Math.round(state.height * k)}px`;
  box.innerHTML = res.svg.replace(
    /width="[\d.]+" height="[\d.]+"/,
    'width="100%" height="100%"',
  );
  const target = targetId ? ` · updating “${targetName}”` : '';
  $('meta').textContent = `${res.glyphCount} letters · seed ${state.seed} · ${(
    performance.now() - t0
  ).toFixed(0)}ms${target}`;
  const warning = textWarning();
  $('textWarning').textContent = warning;
  $('textWarning').classList.toggle('hide', warning === '');
  $('insert').textContent = targetId ? 'Update selected' : 'Insert into Figma';
  $('insertNew').classList.toggle('hide', !targetId);
  $('themeRow').classList.toggle('hide', state.style === 'bw');
  $('strategyRow').classList.toggle('hide', state.style === 'bw');
  $('grainRow').classList.toggle('hide', state.style === 'bw');
}

/** Push current state into every control (hydrate from a selected frame). */
function applyState(): void {
  const numeric = [
    'wave',
    'folds',
    'swell',
    'lean',
    'jitter',
    'tracking',
    'lineGap',
    'grain',
    'strokeWidth',
    'width',
    'height',
    'seed',
  ] as const;
  for (const id of numeric) {
    const el = $<HTMLInputElement>(id);
    el.value = String(state[id]);
    const val = document.getElementById(`${id}Val`);
    if (val) val.textContent = el.value;
  }
  $<HTMLTextAreaElement>('text').value = state.text;
  $<HTMLSelectElement>('fontId').value = state.fontId;
  $<HTMLSelectElement>('surface').value = state.surface;
  $<HTMLSelectElement>('colorStrategy').value = state.colorStrategy;
  for (const group of ['style', 'fit'] as const) {
    $(group)
      .querySelectorAll('button')
      .forEach((b) => b.classList.toggle('on', b.dataset.v === state[group]));
  }
  $('themes')
    .querySelectorAll<HTMLElement>('.swatch')
    .forEach((s) => s.classList.toggle('on', s.dataset.id === state.themeId));
}

window.onmessage = (e: MessageEvent) => {
  const msg = e.data?.pluginMessage;
  if (!msg) return;
  if (msg.type === 'hydrate' && msg.params) {
    Object.assign(state, msg.params);
    applyState();
    render();
  } else if (msg.type === 'target') {
    const changed = msg.nodeId !== targetId;
    targetId = msg.nodeId ?? null;
    targetName = msg.name ?? '';
    if (targetId && changed && msg.params) {
      Object.assign(state, msg.params);
      applyState();
    }
    render();
  }
};

// Theme swatches
const themes = $('themes');
for (const p of PALETTES) {
  const sw = document.createElement('div');
  sw.className = 'swatch' + (p.id === state.themeId ? ' on' : '');
  sw.title = p.name;
  sw.dataset.id = p.id;
  for (const c of [p.bg, ...p.colors.slice(0, 3)]) {
    const bar = document.createElement('i');
    bar.style.background = c;
    sw.appendChild(bar);
  }
  sw.addEventListener('click', () => {
    themes.querySelectorAll('.swatch').forEach((s) => s.classList.remove('on'));
    sw.classList.add('on');
    state.themeId = p.id;
    render();
  });
  themes.appendChild(sw);
}

function fillSelect(id: string, options: { id: string; name: string; blurb?: string }[]): void {
  const el = $<HTMLSelectElement>(id);
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = o.blurb ? `${o.name} — ${o.blurb}` : o.name;
    el.appendChild(opt);
  }
}
fillSelect('fontId', FONTS);
fillSelect('surface', SURFACES);
fillSelect('colorStrategy', STRATEGIES);

function bindSlider(
  id:
    | 'wave'
    | 'folds'
    | 'swell'
    | 'lean'
    | 'jitter'
    | 'tracking'
    | 'lineGap'
    | 'grain'
    | 'strokeWidth',
): void {
  const el = $<HTMLInputElement>(id);
  el.addEventListener('input', () => {
    state[id] = Number(el.value);
    const val = document.getElementById(`${id}Val`);
    if (val) val.textContent = el.value;
    scheduleRender();
  });
}

/** Frame dims commit on change (blur/enter) so clamping doesn't fight typing. */
function bindDimension(id: 'width' | 'height'): void {
  const el = $<HTMLInputElement>(id);
  el.addEventListener('change', () => {
    const v = Math.min(4000, Math.max(100, Math.round(Number(el.value) || state[id])));
    el.value = String(v);
    state[id] = v;
    render();
  });
}

function bindSelect(id: 'fontId' | 'surface' | 'colorStrategy'): void {
  const el = $<HTMLSelectElement>(id);
  el.addEventListener('change', () => {
    (state as unknown as Record<string, unknown>)[id] = el.value;
    render();
  });
}

function bindSegmented(id: 'style' | 'fit'): void {
  $(id)
    .querySelectorAll('button')
    .forEach((btn) => {
      btn.addEventListener('click', () => {
        $(id)
          .querySelectorAll('button')
          .forEach((b) => b.classList.remove('on'));
        btn.classList.add('on');
        (state as unknown as Record<string, unknown>)[id] = btn.dataset.v;
        render();
      });
    });
}

bindSlider('wave');
bindSlider('folds');
bindSlider('swell');
bindSlider('lean');
bindSlider('jitter');
bindSlider('tracking');
bindSlider('lineGap');
bindSlider('grain');
bindSlider('strokeWidth');
bindDimension('width');
bindDimension('height');
bindSelect('fontId');
bindSelect('surface');
bindSelect('colorStrategy');
bindSegmented('style');
bindSegmented('fit');

$<HTMLTextAreaElement>('text').addEventListener('input', () => {
  state.text = $<HTMLTextAreaElement>('text').value;
  scheduleRender();
});

$<HTMLInputElement>('seed').addEventListener('input', () => {
  state.seed = Number($<HTMLInputElement>('seed').value) || 0;
  scheduleRender();
});

$('shuffle').addEventListener('click', () => {
  state.seed = randSeed();
  $<HTMLInputElement>('seed').value = String(state.seed);
  render();
});

function send(type: 'insert' | 'update'): void {
  // Typing or a slider drag may have a render waiting on the next frame; send
  // what the controls say now, not the previous frame's SVG.
  if (renderQueued) render();
  parent.postMessage(
    {
      pluginMessage: {
        type,
        nodeId: targetId,
        svg: currentSvg,
        seed: state.seed,
        style: state.style,
        params: { ...state },
      },
    },
    '*',
  );
}

$('insert').addEventListener('click', () => send(targetId ? 'update' : 'insert'));
// With a frame selected the main button updates it; this adds a new one instead.
$('insertNew').addEventListener('click', () => send('insert'));

applyState();
render();
