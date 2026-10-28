/** WebAudio synthesis only: no audio assets. The context is created on the first user gesture (iOS). */

const STORE_KEY = 'dd-audio';
const SFX_GAIN = 0.5;
const MUSIC_GAIN = 0.07;

interface Prefs {
  sfx: boolean;
  music: boolean;
}

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { sfx: true, music: true, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    /* storage unavailable */
  }
  return { sfx: true, music: true };
}

// Pentatonic tune (semitones above A3), 16 steps per loop, with a simple bass.
const MELODY = [12, -1, 16, -1, 19, -1, 16, 14, 12, -1, 9, -1, 14, -1, 16, -1, 19, -1, 21, 19, 16, -1, 14, -1, 12, 14, 16, -1, 12, -1, -1, -1];
const BASS = [0, 0, 7, 7, 5, 5, 7, 7];

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private prefs: Prefs = loadPrefs();
  private musicTimer: number | null = null;
  private nextNote = 0;
  private step16 = 0;
  private listeners: (() => void)[] = [];
  private htmlAudio: HTMLAudioElement | null = null;
  private sloshGain: GainNode | null = null;
  private sloshFilter: BiquadFilterNode | null = null;

  get sfxOn(): boolean {
    return this.prefs.sfx;
  }
  get musicOn(): boolean {
    return this.prefs.music;
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  private save(): void {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.prefs));
    } catch {
      /* ignore */
    }
    this.applyBuses();
    for (const l of this.listeners) l();
  }

  setSfx(on: boolean): void {
    this.prefs.sfx = on;
    this.save();
    if (on) this.click();
  }

  setMusic(on: boolean): void {
    this.prefs.music = on;
    this.save();
    if (on) this.startMusic();
    else this.stopMusic();
  }

  /** Call from a user gesture (touchend / pointerup / click / key): creates or resumes the context. */
  unlock(): void {
    this.unlockHtmlAudio();
    try {
      // iOS 17+: play through the media channel so the hardware silent switch does not mute WebAudio.
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      if (nav.audioSession) nav.audioSession.type = 'playback';
    } catch {
      /* not supported */
    }
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor();
      } catch {
        return;
      }
      const comp = this.ctx.createDynamicsCompressor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.6;
      this.sfxBus = this.ctx.createGain();
      this.musicBus = this.ctx.createGain();
      this.sfxBus.connect(this.master);
      this.musicBus.connect(this.master);
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
      const n = Math.floor(this.ctx.sampleRate * 0.6);
      this.noise = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      this.applyBuses();
      this.ctx.addEventListener('statechange', () => this.stateChanged());
    }
    const ctx = this.ctx;
    const kick = (): void => {
      // A silent one-sample buffer started inside the gesture fully unlocks old iOS versions.
      try {
        const buf = ctx.createBuffer(1, 1, 22050);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        src.start(0);
      } catch {
        /* ignore */
      }
    };
    kick();
    if (ctx.state !== 'running') {
      void ctx.resume().then(() => this.stateChanged()).catch(() => undefined);
    }
    this.stateChanged();
    if (this.prefs.music) this.startMusic();
  }

  /** True once sound can actually be heard. */
  get running(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  private stateChanged(): void {
    for (const l of this.listeners) l();
  }

  /** Resume without creating (visibility change, returning from background). */
  resumeIfNeeded(): void {
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume().then(() => this.stateChanged()).catch(() => undefined);
  }

  /** Looping silent <audio>: makes iOS treat the page as media playback (plays despite the mute switch). */
  private unlockHtmlAudio(): void {
    if (this.htmlAudio) {
      if (this.htmlAudio.paused) void this.htmlAudio.play().catch(() => undefined);
      return;
    }
    try {
      const rate = 8000;
      const samples = 800;
      const buf = new ArrayBuffer(44 + samples * 2);
      const v = new DataView(buf);
      const w = (o: number, t: string): void => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
      w(0, 'RIFF');
      v.setUint32(4, 36 + samples * 2, true);
      w(8, 'WAVE');
      w(12, 'fmt ');
      v.setUint32(16, 16, true);
      v.setUint16(20, 1, true);
      v.setUint16(22, 1, true);
      v.setUint32(24, rate, true);
      v.setUint32(28, rate * 2, true);
      v.setUint16(32, 2, true);
      v.setUint16(34, 16, true);
      w(36, 'data');
      v.setUint32(40, samples * 2, true);
      const url = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
      const a = new Audio(url);
      a.loop = true;
      a.volume = 0.01;
      a.setAttribute('playsinline', '');
      this.htmlAudio = a;
      void a.play().catch(() => undefined);
    } catch {
      /* ignore */
    }
  }

  private applyBuses(): void {
    if (this.sfxBus) this.sfxBus.gain.value = this.prefs.sfx ? SFX_GAIN : 0;
    if (this.musicBus) this.musicBus.gain.value = this.prefs.music ? MUSIC_GAIN : 0;
  }

  private ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running' && this.prefs.sfx;
  }

  // --- building blocks ---

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0, bus: GainNode | null = this.sfxBus): void {
    const c = this.ctx!;
    const t0 = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(bus!);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  private burst(filter: BiquadFilterType, freq: number, q: number, dur: number, vol: number, delay = 0, sweepTo?: number): void {
    const c = this.ctx!;
    const t0 = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, t0);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.sfxBus!);
    src.start(t0, Math.random() * 0.3);
    src.stop(t0 + dur + 0.02);
  }

  // --- effects ---

  click(): void {
    if (!this.ready()) return;
    this.tone('square', 900, 600, 0.05, 0.12);
  }

  footstep(amp = 1): void {
    if (!this.ready()) return;
    const v = 0.1 * Math.min(1, amp);
    this.burst('lowpass', 420 + Math.random() * 160, 0.7, 0.07, v);
  }

  jump(): void {
    if (!this.ready()) return;
    this.tone('sine', 240, 620, 0.14, 0.3);
  }

  land(): void {
    if (!this.ready()) return;
    this.burst('lowpass', 500, 0.8, 0.12, 0.3);
    this.tone('sine', 120, 55, 0.12, 0.3);
  }

  bump(strength = 1): void {
    if (!this.ready()) return;
    const v = 0.3 + 0.2 * Math.min(1.5, strength / 2);
    this.tone('triangle', 150, 60, 0.14, v);
    this.burst('lowpass', 700, 0.7, 0.08, v * 0.6);
  }

  push(mass = 1): void {
    if (!this.ready()) return;
    const f = 500 / (1 + mass);
    this.burst('bandpass', f + 150, 3, 0.28, 0.2, 0, f * 0.6);
  }

  /** Cartoon slide whistle down with a wobble, then a small thump. */
  slip(): void {
    if (!this.ready()) return;
    const c = this.ctx!;
    const t0 = c.currentTime;
    const o = c.createOscillator();
    const lfo = c.createOscillator();
    const lg = c.createGain();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(1500, t0);
    o.frequency.exponentialRampToValueAtTime(260, t0 + 0.55);
    lfo.frequency.value = 14;
    lg.gain.value = 40;
    lfo.connect(lg).connect(o.frequency);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.28, t0 + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
    o.connect(g).connect(this.sfxBus!);
    o.start(t0);
    lfo.start(t0);
    o.stop(t0 + 0.65);
    lfo.stop(t0 + 0.65);
    this.tone('triangle', 130, 50, 0.15, 0.3, 0.5);
  }

  /**
   * Water splash scaled by the amount lost (0…~20): a soft filtered-noise wash with a falling bandpass sweep
   * plus a few random low "gloop" bubbles. Everything is randomised, no fixed repeat interval.
   */
  splash(amount: number): void {
    if (!this.ready()) return;
    const a = Math.min(1, amount / 14);
    const r = Math.random;
    const dur = 0.25 + a * 0.5 + r() * 0.15;
    const f0 = 1800 + r() * 1400;
    this.shaped('bandpass', f0, 0.9 + r() * 0.6, dur, 0.05 + a * 0.2, 0.03 + r() * 0.04, 0, f0 * (0.2 + r() * 0.15));
    this.shaped('lowpass', 700 + r() * 500, 0.5, dur * 1.4, 0.04 + a * 0.12, 0.05, 0.02, 250);
    const bubbles = 1 + Math.floor(a * 3 + r() * 2);
    for (let i = 0; i < bubbles; i++) this.gloop(0.04 + r() * 0.35, 0.05 + a * 0.12 + r() * 0.05);
  }

  /** One bubble: a low sine whose pitch glides up quickly. */
  private gloop(delay: number, vol: number): void {
    const f = 140 + Math.random() * 260;
    const dur = 0.07 + Math.random() * 0.08;
    this.tone('sine', f, f * (1.6 + Math.random() * 0.8), dur, vol, delay);
  }

  /** Noise with soft attack/decay through a (sweeping) filter. */
  private shaped(filter: BiquadFilterType, freq: number, q: number, dur: number, vol: number, attack: number, delay: number, sweepTo?: number): void {
    const c = this.ctx!;
    const t0 = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = c.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, t0);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(60, sweepTo), t0 + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.sfxBus!);
    src.start(t0, Math.random() * 0.2);
    src.stop(t0 + dur + 0.05);
  }

  /** Continuous soft water slosh that follows the bucket's swing (level 0…1). */
  setSlosh(level: number): void {
    if (!this.ctx || !this.sfxBus) return;
    if (!this.sloshGain) {
      const c = this.ctx;
      const n = c.sampleRate * 2;
      const buf = c.createBuffer(1, n, c.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < n; i++) {
        last = (last + 0.04 * (Math.random() * 2 - 1)) / 1.04; // brown-ish noise: smooth, not clicky
        d[i] = last * 14;
      }
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      this.sloshFilter = c.createBiquadFilter();
      this.sloshFilter.type = 'bandpass';
      this.sloshFilter.frequency.value = 500;
      this.sloshFilter.Q.value = 0.8;
      this.sloshGain = c.createGain();
      this.sloshGain.gain.value = 0;
      src.connect(this.sloshFilter).connect(this.sloshGain).connect(this.sfxBus);
      src.start();
    }
    const run = this.ready();
    const l = run ? Math.max(0, Math.min(1, level)) : 0;
    const now = this.ctx.currentTime;
    this.sloshGain.gain.setTargetAtTime(l * l * 0.5, now, 0.12);
    this.sloshFilter!.frequency.setTargetAtTime(380 + l * 700 + Math.random() * 120, now, 0.1);
  }

  /** Tiny formant "mumble" for a speech balloon: a few short voiced blips, different pitch per man. */
  mumble(player: 0 | 1, length: number): void {
    if (!this.ready()) return;
    const c = this.ctx!;
    const base = player === 0 ? 105 : 175;
    const n = Math.max(2, Math.min(6, Math.round(length / 1.6)));
    let t = c.currentTime + 0.01;
    for (let i = 0; i < n; i++) {
      const f = base * (0.9 + Math.random() * 0.4);
      const dur = 0.07 + Math.random() * 0.05;
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f, t);
      o.frequency.linearRampToValueAtTime(f * (0.9 + Math.random() * 0.25), t + dur);
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = [500, 700, 400, 850][Math.floor(Math.random() * 4)]! * (player === 0 ? 0.9 : 1.1);
      bp.Q.value = 4;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.28, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(bp).connect(g).connect(this.sfxBus!);
      o.start(t);
      o.stop(t + dur + 0.02);
      t += dur + 0.025 + Math.random() * 0.03;
    }
  }

  /** Dull clap of lamp or meat against the ladder; meat is lower and heavier. */
  thud(heavy: boolean): void {
    if (!this.ready()) return;
    this.tone('sine', heavy ? 110 : 190, heavy ? 45 : 80, heavy ? 0.22 : 0.15, 0.4);
    this.burst('lowpass', heavy ? 300 : 600, 0.7, 0.1, heavy ? 0.35 : 0.2);
  }

  bonk(): void {
    if (!this.ready()) return;
    this.tone('triangle', 420, 170, 0.28, 0.4);
    this.tone('sine', 210, 90, 0.3, 0.3, 0.01);
    this.burst('lowpass', 900, 1, 0.06, 0.2);
  }

  lifeLost(): void {
    if (!this.ready()) return;
    [440, 370, 311].forEach((f, i) => this.tone('triangle', f, f * 0.97, 0.22, 0.28, i * 0.16));
  }

  gameOver(): void {
    if (!this.ready()) return;
    [392, 330, 262, 196].forEach((f, i) => this.tone('triangle', f, f * 0.96, 0.4, 0.3, i * 0.28));
    this.tone('sawtooth', 98, 70, 0.8, 0.12, 0.9);
  }

  // --- music ---

  private startMusic(): void {
    if (!this.ctx || this.musicTimer !== null) return;
    this.nextNote = this.ctx.currentTime + 0.1;
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 100);
  }

  private stopMusic(): void {
    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  private scheduleMusic(): void {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const stepDur = 60 / 132 / 2;
    while (this.nextNote < c.currentTime + 0.35) {
      const i = this.step16 % MELODY.length;
      const delay = Math.max(0, this.nextNote - c.currentTime);
      const m = MELODY[i]!;
      if (m >= 0) this.tone('triangle', 220 * Math.pow(2, m / 12), 220 * Math.pow(2, m / 12), stepDur * 1.6, 0.8, delay, this.musicBus);
      if (i % 4 === 0) {
        const b = BASS[(i / 4) % BASS.length]!;
        this.tone('sine', 110 * Math.pow(2, b / 12), 110 * Math.pow(2, b / 12), stepDur * 3.5, 1.1, delay, this.musicBus);
      }
      this.nextNote += stepDur;
      this.step16++;
    }
  }
}

export const sfx = new Sfx();

/** Mute / music buttons (bottom right, next to the debug gear). */
export function mountAudioButtons(): void {
  const wrap = document.createElement('div');
  wrap.id = 'audio-buttons';
  const mk = (id: string, label: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.id = id;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.unlock();
      onClick();
    });
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    wrap.appendChild(b);
    return b;
  };
  const sfxBtn = mk('btn-sound', 'Sound on/off', () => sfx.setSfx(!sfx.sfxOn));
  const musicBtn = mk('btn-music', 'Music on/off', () => sfx.setMusic(!sfx.musicOn));
  const refresh = (): void => {
    sfxBtn.textContent = sfx.sfxOn ? '🔊' : '🔇';
    sfxBtn.classList.toggle('off', !sfx.sfxOn);
    musicBtn.textContent = '♪';
    musicBtn.classList.toggle('off', !sfx.musicOn);
  };
  sfx.onChange(refresh);
  refresh();
  document.body.appendChild(wrap);
  // iOS only accepts unlocking in touchend / pointerup / click (not touchstart / pointerdown).
  const gesture = (): void => {
    if (!sfx.running) sfx.unlock();
  };
  for (const ev of ['touchend', 'pointerup', 'click', 'keydown'] as const) window.addEventListener(ev, gesture, { capture: true, passive: true });
  const back = (): void => {
    if (document.visibilityState === 'visible') sfx.resumeIfNeeded();
  };
  document.addEventListener('visibilitychange', back);
  window.addEventListener('pageshow', back);
  window.addEventListener('focus', back);

  const hint = document.createElement('button');
  hint.type = 'button';
  hint.id = 'sound-hint';
  hint.textContent = '🔈 Tap for sound';
  hint.addEventListener('click', (e) => {
    e.stopPropagation();
    sfx.unlock();
  });
  document.body.appendChild(hint);
  const syncHint = (): void => {
    hint.style.display = !sfx.running && (sfx.sfxOn || sfx.musicOn) ? 'block' : 'none';
  };
  sfx.onChange(syncHint);
  window.setInterval(syncHint, 700);
  syncHint();
}
