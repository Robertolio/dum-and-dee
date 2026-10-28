import type { Tuning } from '@dd/sim';
import type { GameScene } from '../scenes/GameScene';
import { STRINGS } from '../strings';
import { fullscreenSupported, isFullscreen, toggleFullscreen } from '../platform/fullscreen';

interface SliderDef {
  key: keyof Tuning;
  label: string;
  min: number;
  max: number;
  step: number;
}

const SLIDERS: SliderDef[] = [
  { key: 'dyMax', label: 'Arm reach ΔyMax', min: 0.6, max: 2.2, step: 0.05 },
  { key: 'hRise', label: 'Posture rise τ', min: 0.05, max: 0.4, step: 0.01 },
  { key: 'hFall', label: 'Posture fall τ', min: 0.05, max: 0.4, step: 0.01 },
  { key: 'hTargetRate', label: 'Posture rate', min: 1, max: 12, step: 0.5 },
  { key: 'vMax', label: 'vMax', min: 1.5, max: 6, step: 0.1 },
  { key: 'aMax', label: 'aMax', min: 2, max: 20, step: 0.5 },
  { key: 'k', label: 'Ladder spring k', min: 10, max: 200, step: 5 },
  { key: 'c', label: 'Ladder damping c', min: 0, max: 40, step: 1 },
  { key: 'tStep', label: 'Step time', min: 0.1, max: 0.6, step: 0.01 },
  { key: 'bucketD', label: 'Bucket damping', min: 0.2, max: 4, step: 0.1 },
  { key: 'aSafe', label: 'aSafe', min: 1, max: 15, step: 0.5 },
  { key: 'kV', label: 'kV (shock loss)', min: 0, max: 3, step: 0.05 },
  { key: 'kPhi', label: 'kφ (swing loss)', min: 0, max: 0.5, step: 0.01 },
  { key: 'lampD', label: 'Lamp damping', min: 0.1, max: 2, step: 0.05 },
  { key: 'lampE', label: 'Lamp bounce e', min: 0, max: 1, step: 0.05 },
  { key: 'sMax', label: 'Balance sMax', min: 0.05, max: 0.6, step: 0.01 },
];

/** Small HTML debug panel: control variants, fullscreen, tuning sliders, replay, readouts. */
export function mountDebugPanel(scene: GameScene): void {
  const root = document.getElementById('debug');
  const toggle = document.getElementById('debug-toggle');
  if (!root || !toggle) return;

  toggle.addEventListener('click', () => root.classList.toggle('open'));

  root.innerHTML = '';
  const h = (tag: string, attrs: Record<string, string> = {}, text = ''): HTMLElement => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text) el.textContent = text;
    return el;
  };

  // --- Controls ---
  root.appendChild(h('h3', {}, 'Controls'));
  const postureRow = h('div', { class: 'row' });
  const analogBtn = h('button', { type: 'button', 'data-testid': 'mode-analog' }, STRINGS.analog);
  const digitalBtn = h('button', { type: 'button', 'data-testid': 'mode-digital' }, STRINGS.digital);
  postureRow.append(h('label', {}, 'Posture'), analogBtn, digitalBtn);
  root.appendChild(postureRow);

  const sourceRow = h('div', { class: 'row' });
  const sourceSel = h('select', { 'data-testid': 'input-source' }) as HTMLSelectElement;
  sourceSel.append(new Option(STRINGS.touch, 'touch'), new Option(STRINGS.keyboard, 'keyboard'));
  sourceRow.append(h('label', {}, 'Input'), sourceSel);
  root.appendChild(sourceRow);

  const actionRow = h('div', { class: 'row' });
  const resetBtn = h('button', { type: 'button', 'data-testid': 'reset' }, STRINGS.reset);
  actionRow.append(resetBtn);
  if (fullscreenSupported()) {
    const fsBtn = h('button', { type: 'button', 'data-testid': 'fullscreen' }, STRINGS.fullscreen);
    fsBtn.addEventListener('click', () => void toggleFullscreen());
    document.addEventListener('fullscreenchange', () => {
      fsBtn.textContent = isFullscreen() ? STRINGS.exitFullscreen : STRINGS.fullscreen;
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyF' && !e.repeat) void toggleFullscreen();
    });
    actionRow.append(fsBtn);
  }
  root.appendChild(actionRow);

  const refreshButtons = (): void => {
    const cfg = scene.controller.settings();
    analogBtn.classList.toggle('active', cfg.posture === 'analog');
    digitalBtn.classList.toggle('active', cfg.posture === 'digital');
    sourceSel.value = cfg.source;
  };
  analogBtn.addEventListener('click', () => {
    scene.controller.setSettings({ posture: 'analog' });
    scene.refreshHints();
    refreshButtons();
  });
  digitalBtn.addEventListener('click', () => {
    scene.controller.setSettings({ posture: 'digital' });
    scene.refreshHints();
    refreshButtons();
  });
  sourceSel.addEventListener('change', () => {
    scene.controller.setSettings({ source: sourceSel.value as 'touch' | 'keyboard' });
    scene.refreshHints();
    refreshButtons();
  });
  resetBtn.addEventListener('click', () => scene.reset());
  refreshButtons();

  // --- Replay ---
  root.appendChild(h('hr'));
  root.appendChild(h('h3', {}, 'Replay'));
  const replayRow = h('div', { class: 'row' });
  const recBtn = h('button', { type: 'button' }, STRINGS.record);
  const playBtn = h('button', { type: 'button' }, STRINGS.play);
  const replayInfo = h('span', { class: 'val' }, '0 t');
  replayRow.append(recBtn, playBtn, replayInfo);
  root.appendChild(replayRow);
  recBtn.addEventListener('click', () => {
    if (scene.replay.state === 'recording') {
      scene.replay.stop();
    } else {
      scene.reset();
      scene.replay.startRecording();
    }
  });
  playBtn.addEventListener('click', () => {
    scene.reset();
    scene.replay.startPlayback();
  });

  // --- Tuning sliders ---
  root.appendChild(h('hr'));
  root.appendChild(h('h3', {}, 'Tuning'));
  const sliderEls: { def: SliderDef; input: HTMLInputElement; val: HTMLElement }[] = [];
  for (const def of SLIDERS) {
    const row = h('div', { class: 'row' });
    const input = h('input', {
      type: 'range',
      min: String(def.min),
      max: String(def.max),
      step: String(def.step),
      value: String(scene.tuning[def.key]),
      'data-tuning': def.key,
    }) as HTMLInputElement;
    const val = h('span', { class: 'val' }, fmt(scene.tuning[def.key] as number));
    input.addEventListener('input', () => {
      (scene.tuning as unknown as Record<string, number>)[def.key] = Number(input.value);
      val.textContent = fmt(Number(input.value));
    });
    row.append(h('label', {}, def.label), input, val);
    root.appendChild(row);
    sliderEls.push({ def, input, val });
  }
  const defaultsBtn = h('button', { type: 'button' }, 'Defaults');
  defaultsBtn.addEventListener('click', () => {
    scene.resetTuning();
    for (const { def, input, val } of sliderEls) {
      input.value = String(scene.tuning[def.key]);
      val.textContent = fmt(scene.tuning[def.key] as number);
    }
  });
  root.appendChild(defaultsBtn);

  // --- Readouts ---
  root.appendChild(h('hr'));
  const readout = h('div', { class: 'readout', 'data-testid': 'readout' });
  root.appendChild(readout);

  setInterval(() => {
    if (!root.classList.contains('open')) return;
    const r = scene.readout();
    readout.textContent = [
      `fps ${r.fps!.toFixed(0)}   water ${r.water!.toFixed(1)}%`,
      `θ ${r.thetaDeg!.toFixed(1)}°   balance ${r.balance!.toFixed(2)}`,
      `tension ${r.tension!.toFixed(3)}   over ${r.over!.toFixed(2)}`,
      `aP,y ${r.aPy!.toFixed(1)}   jerk ${r.jerk!.toFixed(0)}`,
      `φ ${r.phiDeg!.toFixed(1)}°   loss ${r.lossRate!.toFixed(2)}%/s`,
      `h ${r.hA!.toFixed(2)} / ${r.hB!.toFixed(2)}   v ${r.vA!.toFixed(2)} / ${r.vB!.toFixed(2)}`,
    ].join('\n');
    const rs = scene.replay.state;
    recBtn.textContent = rs === 'recording' ? STRINGS.stopRecording : STRINGS.record;
    recBtn.classList.toggle('active', rs === 'recording');
    playBtn.classList.toggle('active', rs === 'playing');
    replayInfo.textContent = `${scene.replay.length} t`;
  }, 150);
}

function fmt(v: number): string {
  return Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(2);
}
