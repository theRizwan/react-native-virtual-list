import { SumTree } from './sum-tree.js'

/**
 * Tracks where every item sits, while heights are still being discovered.
 *
 * Two ideas do the real work here.
 *
 * The first is that a scroll offset is not a fact. It is derived from the
 * heights known at the moment it was read, and those heights change as items
 * are measured. Anything that stores an offset and treats it as truth will
 * drift, which is why lists open at the wrong place. Position is therefore
 * expressed as an anchor, meaning an item and how far its top sits above the
 * viewport, and the offset is recomputed from the anchor whenever it is
 * needed.
 *
 * The second is that prepending must not renumber anything. Items live inside
 * a larger buffer with spare room at both ends, so loading older messages
 * writes into the space in front of them and costs O(k log n) rather than a
 * full rebuild.
 */
export class ListLayout {
  constructor({ count = 0, estimate, headroom = 1024 } = {}) {
    if (typeof estimate !== 'number' && typeof estimate !== 'function') {
      throw new TypeError('estimate must be a number or a function of the item index')
    }
    if (!Number.isInteger(count) || count < 0) {
      throw new TypeError('count must be a non negative integer')
    }

    this.estimate = estimate
    this.count = count
    this.originShift = 0

    const capacity = Math.max(count + headroom * 2, 1)
    this.head = headroom
    this.allocate(capacity)

    for (let i = 0; i < count; i += 1) {
      this.heights[this.head + i] = this.estimateFor(i)
    }
    this.tree.rebuild(this.heights)
    this.baseOffset = this.tree.prefix(this.head)
  }

  allocate(capacity) {
    this.capacity = capacity
    this.heights = new Float32Array(capacity)
    this.measured = new Uint8Array(capacity)
    this.tree = new SumTree(capacity)
  }

  estimateFor(index) {
    const value = typeof this.estimate === 'function' ? this.estimate(index) : this.estimate
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`estimate for index ${index} was ${value}, which is not a usable height`)
    }
    return value
  }

  physical(index) {
    return this.head + index
  }

  heightOf(index) {
    return this.heights[this.physical(index)]
  }

  isMeasured(index) {
    return this.measured[this.physical(index)] === 1
  }

  /**
   * Records a real measured height. Returns true when this actually moved
   * anything, so a caller can skip recomputing a position that has not changed.
   */
  setHeight(index, height) {
    if (index < 0 || index >= this.count) return false
    if (!Number.isFinite(height) || height < 0) {
      throw new RangeError(`height for index ${index} was ${height}, which is not a usable height`)
    }

    const at = this.physical(index)
    // Round trip through the array so the delta is computed against the value
    // that is actually stored, otherwise Float32 rounding leaves the tree and
    // the array disagreeing by a fraction of a pixel per measurement.
    const previous = this.heights[at]
    this.heights[at] = height
    const stored = this.heights[at]
    this.measured[at] = 1

    const delta = stored - previous
    if (delta === 0) return false
    this.tree.add(at, delta)
    if (at < this.head) this.baseOffset += delta
    return true
  }

  /** Pixel offset of the top of an item. */
  offsetOf(index) {
    return this.tree.prefix(this.physical(index)) - this.baseOffset
  }

  totalHeight() {
    return this.tree.prefix(this.head + this.count) - this.baseOffset
  }

  /** The item covering a pixel offset, clamped into range. */
  indexAt(offset) {
    if (this.count === 0) return -1
    if (offset <= 0) return 0
    const target = this.baseOffset + offset
    if (target >= this.tree.prefix(this.head + this.count)) return this.count - 1
    const found = this.tree.lowerBound(target) - this.head
    return Math.min(Math.max(found, 0), this.count - 1)
  }

  /**
   * The half open range of items to render for a viewport, widened by overscan
   * rows on each side.
   */
  visibleRange(scrollOffset, viewportHeight, overscan = 0) {
    if (this.count === 0) return { start: 0, end: 0 }
    const first = this.indexAt(scrollOffset)
    const last = this.indexAt(scrollOffset + Math.max(viewportHeight, 0))
    return {
      start: Math.max(first - overscan, 0),
      end: Math.min(last + overscan + 1, this.count),
    }
  }

  /**
   * Adds items to the front. Existing anchors keep pointing at the same items
   * because they carry the origin they were taken at.
   */
  prepend(n, estimateFor) {
    if (!Number.isInteger(n) || n < 0) throw new TypeError('prepend needs a non negative integer')
    if (n === 0) return
    if (this.head < n) this.grow(n, 0)

    for (let i = 0; i < n; i += 1) {
      const at = this.head - n + i
      const height = estimateFor ? estimateFor(i) : this.estimateFor(i)
      if (!Number.isFinite(height) || height < 0) {
        throw new RangeError(`estimate for prepended index ${i} was ${height}`)
      }
      this.heights[at] = height
      this.measured[at] = 0
      this.tree.add(at, this.heights[at])
    }

    this.head -= n
    this.count += n
    this.originShift += n
    this.baseOffset = this.tree.prefix(this.head)
  }

  append(n, estimateFor) {
    if (!Number.isInteger(n) || n < 0) throw new TypeError('append needs a non negative integer')
    if (n === 0) return
    if (this.head + this.count + n > this.capacity) this.grow(0, n)

    for (let i = 0; i < n; i += 1) {
      const index = this.count + i
      const at = this.physical(index)
      const height = estimateFor ? estimateFor(i) : this.estimateFor(index)
      if (!Number.isFinite(height) || height < 0) {
        throw new RangeError(`estimate for appended index ${i} was ${height}`)
      }
      this.heights[at] = height
      this.measured[at] = 0
      this.tree.add(at, this.heights[at])
    }
    this.count += n
  }

  /** Reallocates with room at both ends, keeping every measured height. */
  grow(needFront, needBack) {
    const frontroom = Math.max(needFront, this.capacity) + 1024
    const backroom = Math.max(needBack, this.capacity) + 1024
    const capacity = frontroom + this.count + backroom

    const heights = this.heights
    const measured = this.measured
    const oldHead = this.head

    this.allocate(capacity)
    this.head = frontroom
    for (let i = 0; i < this.count; i += 1) {
      this.heights[this.head + i] = heights[oldHead + i]
      this.measured[this.head + i] = measured[oldHead + i]
    }
    this.tree.rebuild(this.heights)
    this.baseOffset = this.tree.prefix(this.head)
  }

  /**
   * Describes the current position as an item plus how far its top sits above
   * the viewport top. This survives both measurement and prepending, which an
   * offset does not.
   */
  captureAnchor(scrollOffset) {
    const index = this.indexAt(scrollOffset)
    if (index < 0) return { index: 0, delta: 0, origin: this.originShift }
    return {
      index,
      delta: scrollOffset - this.offsetOf(index),
      origin: this.originShift,
    }
  }

  /** The item an anchor refers to now, accounting for anything prepended since. */
  resolveAnchor(anchor) {
    const index = anchor.index + (this.originShift - anchor.origin)
    return Math.min(Math.max(index, 0), Math.max(this.count - 1, 0))
  }

  /** The scroll offset that puts an anchor back where it was. */
  offsetForAnchor(anchor) {
    if (this.count === 0) return 0
    return this.offsetOf(this.resolveAnchor(anchor)) + anchor.delta
  }

  /**
   * Where to scroll so an item is visible. Alignment is start, center or end,
   * and the result is clamped so it never scrolls past either end.
   */
  offsetForIndex(index, { align = 'start', viewportHeight = 0 } = {}) {
    if (this.count === 0) return 0
    const clamped = Math.min(Math.max(index, 0), this.count - 1)
    const top = this.offsetOf(clamped)
    const height = this.heightOf(clamped)

    let offset = top
    if (align === 'center') offset = top - (viewportHeight - height) / 2
    else if (align === 'end') offset = top - (viewportHeight - height)

    const max = Math.max(this.totalHeight() - viewportHeight, 0)
    return Math.min(Math.max(offset, 0), max)
  }
}
