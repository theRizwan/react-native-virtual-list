import { ListLayout } from './layout.js'

/**
 * Holds the scroll state on top of a ListLayout and works out what should be
 * on screen. It knows nothing about React or React Native, so all of it can be
 * exercised without a renderer.
 *
 * The rule it exists to enforce is that the controller never stores a scroll
 * offset as truth. It stores an anchor, and derives the offset. Every reported
 * failure this design is aimed at comes from something holding an offset
 * across a change that invalidated it.
 */
export class ListController {
  constructor({ count = 0, estimate = 100, overscan = 3, viewportHeight = 0, headroom } = {}) {
    this.layout = new ListLayout({ count, estimate, headroom })
    this.overscan = overscan
    this.viewportHeight = viewportHeight

    this.anchor = { index: 0, delta: 0, origin: 0 }
    this.atEnd = false
    this.pendingScroll = null
  }

  get count() {
    return this.layout.count
  }

  get scrollOffset() {
    if (this.atEnd) return this.maxOffset()
    return this.clamp(this.layout.offsetForAnchor(this.anchor))
  }

  maxOffset() {
    return Math.max(this.layout.totalHeight() - this.viewportHeight, 0)
  }

  clamp(offset) {
    return Math.min(Math.max(offset, 0), this.maxOffset())
  }

  setViewportHeight(height) {
    this.viewportHeight = height
  }

  /**
   * Called when the user scrolls. This is the only place an incoming offset is
   * trusted, because it is the one moment it reflects where the content
   * actually is.
   */
  onScroll(offset) {
    const max = this.maxOffset()
    // "Following the end" is a state, not an offset, so that appending keeps
    // the list pinned to the bottom without a threshold guess going stale.
    this.atEnd = this.viewportHeight > 0 && offset >= max - 1
    this.anchor = this.layout.captureAnchor(this.clamp(offset))
  }

  /**
   * Records a measured height. Returns whether the visible window changed, so
   * a caller can avoid rendering when nothing moved.
   */
  measure(index, height) {
    const before = this.range()
    if (!this.layout.setHeight(index, height)) return false
    const after = this.range()
    return after.start !== before.start || after.end !== before.end
  }

  measureMany(entries) {
    const before = this.range()
    let moved = false
    for (const [index, height] of entries) {
      if (this.layout.setHeight(index, height)) moved = true
    }
    if (!moved) return false
    const after = this.range()
    return after.start !== before.start || after.end !== before.end
  }

  /** Loading older items. The anchor carries its own origin, so nothing jumps. */
  prepend(n, estimateFor) {
    this.layout.prepend(n, estimateFor)
  }

  /** Newer items. If the user was at the end, stay there. */
  append(n, estimateFor) {
    this.layout.append(n, estimateFor)
  }

  scrollToIndex(index, { align = 'start' } = {}) {
    const offset = this.layout.offsetForIndex(index, { align, viewportHeight: this.viewportHeight })
    this.atEnd = false
    this.anchor = this.layout.captureAnchor(offset)
    this.pendingScroll = offset
    return offset
  }

  scrollToEnd() {
    this.atEnd = true
    this.pendingScroll = this.maxOffset()
    return this.pendingScroll
  }

  /** The offset the view should be moved to, consumed once. */
  takePendingScroll() {
    const pending = this.pendingScroll
    this.pendingScroll = null
    return pending
  }

  range() {
    return this.layout.visibleRange(this.scrollOffset, this.viewportHeight, this.overscan)
  }

  /**
   * Everything a renderer needs for one frame: which items to mount, where
   * each one goes, and how tall the scrollable content is.
   */
  frame() {
    const { start, end } = this.range()
    const items = []
    for (let index = start; index < end; index += 1) {
      items.push({
        index,
        offset: this.layout.offsetOf(index),
        height: this.layout.heightOf(index),
        measured: this.layout.isMeasured(index),
      })
    }
    return {
      items,
      start,
      end,
      totalHeight: this.layout.totalHeight(),
      scrollOffset: this.scrollOffset,
    }
  }
}
