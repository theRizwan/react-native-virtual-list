/**
 * A Fenwick tree over a fixed capacity. It answers "where does item i start"
 * and "which item covers pixel p" in O(log n) while individual heights keep
 * changing as items are measured.
 *
 * Sums are kept in Float64 even when the heights themselves are Float32,
 * because a prefix sum over a million items accumulates error far faster than
 * any single height does.
 */
export class SumTree {
  constructor(capacity) {
    this.capacity = capacity
    this.tree = new Float64Array(capacity + 1)
    this.highestBit = 1
    while (this.highestBit * 2 <= capacity) this.highestBit *= 2
  }

  /** Adds delta to position i. O(log n). */
  add(i, delta) {
    if (delta === 0) return
    for (let p = i + 1; p <= this.capacity; p += p & -p) {
      this.tree[p] += delta
    }
  }

  /** Sum of positions [0, i). O(log n). */
  prefix(i) {
    let sum = 0
    for (let p = i; p > 0; p -= p & -p) {
      sum += this.tree[p]
    }
    return sum
  }

  total() {
    return this.prefix(this.capacity)
  }

  /**
   * The largest k for which prefix(k) <= target, found by descending the tree
   * rather than binary searching over prefix() calls, so it stays O(log n)
   * rather than O(log squared n).
   *
   * Positions holding zero are skipped over rather than landed on, so with a
   * target that falls exactly on a boundary this returns the position after
   * any run of zeroes. Callers that care about empty positions clamp the
   * result themselves.
   */
  lowerBound(target) {
    let pos = 0
    let rest = target
    for (let step = this.highestBit; step > 0; step >>= 1) {
      const next = pos + step
      if (next <= this.capacity && this.tree[next] <= rest) {
        rest -= this.tree[next]
        pos = next
      }
    }
    return pos
  }

  /**
   * Rebuilds every position from a source array in O(n), which matters because
   * seeding a million items one add() at a time would be O(n log n).
   */
  rebuild(values) {
    this.tree.fill(0)
    for (let i = 1; i <= this.capacity; i += 1) {
      this.tree[i] += values[i - 1]
      const parent = i + (i & -i)
      if (parent <= this.capacity) {
        this.tree[parent] += this.tree[i]
      }
    }
  }
}
