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
  private lastSplash = 0;
  private listeners: (() => void)[] = [];

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

  /** Call from a user gesture (tap / key): creates or resumes the context. */
  unlock(): void {
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
    }
    if (this.ctx.state !== 'running') void this.ctx.resume();
    if (this.prefs.music) this.startMusic();
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

  /** Water splash, scaled by the amount lost (0…~20). Throttled so continuous leaking stays soft. */
  splash(amount: number): void {
    if (!this.ready()) return;
    const now = performance.now();
    if (now - this.lastSplash < 90) return;
    this.lastSplash = now;
    const a = Math.min(1, amount / 12);
    this.burst('bandpass', 1400 + Math.random() * 500, 1.2, 0.1 + a * 0.3, 0.08 + a * 0.3, 0, 600);
    if (a > 0.4) this.tone('sine', 380, 160, 0.18, 0.12 * a, 0.03);
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
  const unlockOnce = (): void => sfx.unlock();
  for (const ev of ['pointerdown', 'touchend', 'keydown'] as const) window.addEventListener(ev, unlockOnce, { passive: true });
}
