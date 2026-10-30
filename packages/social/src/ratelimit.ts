/** Sliding-window limiter: at most `max` hits per `windowMs` for each key. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly max: number, private readonly windowMs: number, private readonly now: () => number) {}

  /** Records an attempt; false when over the limit (the attempt is not recorded then). */
  hit(key: string): boolean {
    const t = this.now();
    const list = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (list.length >= this.max) {
      this.hits.set(key, list);
      return false;
    }
    list.push(t);
    this.hits.set(key, list);
    if (this.hits.size > 5000) this.sweep(t);
    return true;
  }

  private sweep(t: number): void {
    for (const [k, v] of this.hits) if (v.every((x) => t - x >= this.windowMs)) this.hits.delete(k);
  }
}
