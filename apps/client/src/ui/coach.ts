import { DEFAULT_TUNING } from '@dd/sim';
import type { GameState, PlayerInput } from '@dd/sim';
import type { ControlSettings } from '../input/types';

const KEY = 'dd-coach';
type Mark = 'move' | 'bend' | 'jump' | 'row' | 'lift' | 'duck';
const ORDER: Mark[] = ['move', 'bend', 'jump'];
const ROW_ORDER: Mark[] = ['row', 'lift', 'duck'];

const TEXT: Record<'touch' | 'keyboard', Record<Mark, string>> = {
  touch: {
    move: 'Left thumb = Dum, right thumb = Dee. Drag a thumb right to walk.',
    bend: 'Drag a thumb down to bend, up to stand.',
    jump: 'Flick a thumb up (or tap) to jump.',
    row: 'Row together! Drag your thumb left, then right, like pulling an oar. Both thumbs at the same time.',
    lift: 'Bridge! Hold your thumb a little lower to lift the oars out of the water, but not too high.',
    duck: 'Duck ahead! Flick a thumb up (or tap) to jump the skiff over it.',
  },
  keyboard: {
    move: 'Dum: W A S D · Dee: arrow keys. Walk with A/D and ←/→.',
    bend: 'Stand and bend with W/S (Dum) and ↑/↓ (Dee).',
    jump: 'Jump: Space (Dum) · Enter (Dee).',
    row: 'Row together! Dum: hold D to pull, let go to recover. Dee: same with →. Both at the same time!',
    lift: 'Bridge! Tap S (Dum) or ↓ (Dee) to lift the oars out of the water, not too high. W / ↑ lowers them again.',
    duck: 'Duck ahead! Jump the skiff: Space (Dum) or Enter (Dee).',
  },
};

function load(): Set<Mark> {
  try {
    return new Set((JSON.parse(localStorage.getItem(KEY) ?? '[]') as Mark[]).filter((m) => ORDER.includes(m) || ROW_ORDER.includes(m)));
  } catch {
    return new Set();
  }
}

/** Short instructions shown during the game, only at the moment they are needed, and never again once done or seen long enough. */
export class Coach {
  private readonly el = document.createElement('div');
  private done = load();
  private current: Mark | null = null;
  private shownFor = 0;
  private progress = 0;
  private gap = 1.2;

  constructor() {
    this.el.className = 'coach hidden';
    this.el.dataset.testid = 'coach';
    document.body.append(this.el);
  }

  hide(): void {
    this.el.classList.add('hidden');
    this.current = null;
  }

  /** Call every frame of solo play with the inputs of that frame. */
  update(dt: number, inputs: [PlayerInput, PlayerInput], cfg: ControlSettings): void {
    if (this.done.size >= ORDER.length) return this.hide();
    if (!this.current) {
      this.gap -= dt;
      if (this.gap > 0) return;
      this.current = ORDER.find((m) => !this.done.has(m)) ?? null;
      this.shownFor = 0;
      this.progress = 0;
      if (!this.current) return;
      const text = TEXT[cfg.source === 'keyboard' ? 'keyboard' : 'touch'][this.current];
      this.el.textContent = this.current === 'bend' && cfg.source === 'touch' && cfg.posture === 'digital' ? 'Hold a thumb to stand, let go to bend.' : text;
      this.el.classList.remove('hidden');
    }
    this.shownFor += dt;
    let hit = false;
    for (const i of inputs) {
      if (this.current === 'move' && Math.abs(i.push) > 0.5) hit = true;
      if (this.current === 'bend' && Math.abs(i.hTarget - DEFAULT_TUNING.hUpright) > 0.15) hit = true;
      if (this.current === 'jump' && i.jump) hit = true;
    }
    if (hit) this.progress += dt;
    const instant = this.current === 'jump';
    if ((instant && hit) || this.progress > 0.6 || this.shownFor > 14) this.finish();
  }

  /** Rowing race: show each mark when the situation arises (strokes at the start, bridge ahead, duck ahead). */
  updateRow(dt: number, inputs: [PlayerInput, PlayerInput], cfg: ControlSettings, s: GameState): void {
    const r = s.row;
    if (!r || s.finished || s.gameOver) return this.hide();
    const pending = ROW_ORDER.filter((m) => !this.done.has(m));
    if (pending.length === 0) return this.hide();
    const ahead = (xs: number[], max: number): boolean => xs.some((x) => x - r.x > 1 && x - r.x < max);
    const due = (m: Mark): boolean =>
      m === 'row' ? s.tick > 20 : m === 'lift' ? ahead(r.bridges.filter((b) => !b.done).map((b) => b.x0), 16) : ahead(r.ducks.filter((d) => !d.done).map((d) => d.x), 11);
    if (!this.current) {
      const next = pending.find((m) => due(m));
      if (!next) return;
      this.current = next;
      this.shownFor = 0;
      this.progress = 0;
      let text = TEXT[cfg.source === 'keyboard' ? 'keyboard' : 'touch'][next];
      if (next === 'lift' && cfg.source === 'touch' && cfg.posture === 'digital') text = 'Bridge! Let go of the screen to lift the oars out of the water.';
      this.el.textContent = text;
      this.el.classList.remove('hidden');
    }
    this.shownFor += dt;
    const m = this.current;
    const jumped = inputs.some((i) => i.jump);
    const lifted = r.rowers.some((w) => w.lift > 0.3 && w.lift < 0.9);
    const finished =
      (m === 'row' && r.strokes[0] >= 3 && r.strokes[1] >= 3) ||
      (m === 'lift' && (lifted || !ahead(r.bridges.filter((b) => !b.done).map((b) => b.x0), 16))) ||
      (m === 'duck' && (jumped || !ahead(r.ducks.filter((d) => !d.done).map((d) => d.x), 11)));
    if (finished || this.shownFor > 14) this.finish();
  }

  private finish(): void {
    if (!this.current) return;
    this.done.add(this.current);
    try {
      localStorage.setItem(KEY, JSON.stringify([...this.done]));
    } catch {
      /* ignore */
    }
    this.hide();
    this.gap = 1.5;
  }
}
