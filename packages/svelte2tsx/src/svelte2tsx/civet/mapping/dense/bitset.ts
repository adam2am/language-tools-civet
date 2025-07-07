// FastBitSet utility for numeric keys up to large range, with fallback for string keys.
// Provides `add` and `has` (and `clear`) API subset used by existing mapping code.

export class FastBitSet<K extends number | string> {
  private buckets: Map<number, Uint32Array>; // for numeric keys (int>=0)
  private strSet: Set<string>; // fallback for non-numeric or out-of-range keys

  constructor() {
    this.buckets = new Map();
    this.strSet = new Set();
  }

  private addNumber(n: number): void {
    if (n < 0) {
      // negative treated as string fallback
      this.strSet.add(String(n));
      return;
    }
    const bucketIdx = n >>> 5; // divide by 32
    const bit = n & 31;
    let bucket = this.buckets.get(bucketIdx);
    if (!bucket) {
      bucket = new Uint32Array(1); // single 32-bit slot
      this.buckets.set(bucketIdx, bucket);
    }
    bucket[0] |= 1 << bit;
  }

  private hasNumber(n: number): boolean {
    if (n < 0) return this.strSet.has(String(n));
    const bucketIdx = n >>> 5;
    const bucket = this.buckets.get(bucketIdx);
    if (!bucket) return false;
    const bit = n & 31;
    return (bucket[0] & (1 << bit)) !== 0;
  }

  add(key: K): this {
    if (typeof key === 'number') {
      this.addNumber(key);
    } else {
      this.strSet.add(key);
    }
    return this;
  }

  has(key: K): boolean {
    if (typeof key === 'number') {
      return this.hasNumber(key);
    }
    return this.strSet.has(key);
  }

  clear(): void {
    this.buckets.clear();
    this.strSet.clear();
  }
} 