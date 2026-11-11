/** Seeded PRNG (xoshiro128**), build plan 6.4: same plan + data + seed gives identical results. */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  private spare: number | null = null;

  /** Each (seed, stream) pair gives an independent stream, so runs can be split across workers. */
  constructor(seed: number, stream = 0) {
    let s = (seed ^ Math.imul(stream + 1, 0x9e3779b9)) >>> 0;
    const next = (): number => {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.a = next();
    this.b = next();
    this.c = next();
    this.d = next() || 1;
  }

  nextU32(): number {
    const r = Math.imul(this.b, 5);
    const result = Math.imul((r << 7) | (r >>> 25), 9) >>> 0;
    const t = this.b << 9;
    this.c ^= this.a;
    this.d ^= this.b;
    this.b ^= this.c;
    this.a ^= this.d;
    this.c ^= t;
    this.d = (this.d << 11) | (this.d >>> 21);
    return result;
  }

  /** Uniform in [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Standard normal (Box-Muller, cached pair). */
  normal(): number {
    if (this.spare !== null) {
      const v = this.spare;
      this.spare = null;
      return v;
    }
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    const m = Math.sqrt(-2 * Math.log(u));
    this.spare = m * Math.sin(2 * Math.PI * v);
    return m * Math.cos(2 * Math.PI * v);
  }
}

/** Lower-triangular Cholesky factor of a symmetric positive-definite matrix. */
export function cholesky(m: number[][]): number[][] {
  const n = m.length;
  const L = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = m[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) {
        if (sum <= 0) throw new Error('Correlation matrix is not positive-definite');
        L[i][j] = Math.sqrt(sum);
      } else L[i][j] = sum / L[j][j];
    }
  }
  return L;
}
