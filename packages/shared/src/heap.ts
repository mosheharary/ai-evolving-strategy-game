/** Binary min-heap keyed by (priority, tiebreak) — deterministic ordering for equal priorities. */
export class MinHeap {
  private readonly items: [number, number][] = [];

  get size(): number {
    return this.items.length;
  }

  push(priority: number, value: number): void {
    const a = this.items;
    a.push([priority, value]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (less(a[i]!, a[p]!)) {
        [a[i], a[p]] = [a[p]!, a[i]!];
        i = p;
      } else break;
    }
  }

  pop(): [number, number] | undefined {
    const a = this.items;
    if (a.length === 0) return undefined;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && less(a[l]!, a[m]!)) m = l;
        if (r < a.length && less(a[r]!, a[m]!)) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m]!, a[i]!];
        i = m;
      }
    }
    return top;
  }
}

function less(x: [number, number], y: [number, number]): boolean {
  return x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]);
}
