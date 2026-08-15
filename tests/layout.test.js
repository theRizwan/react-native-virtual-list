import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ListLayout } from '../src/layout.js'

function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Where an item currently sits relative to the top of the viewport. */
function screenPosition(layout, index, scrollOffset) {
  return layout.offsetOf(index) - scrollOffset
}

test('offsets accumulate exactly', () => {
  const layout = new ListLayout({ count: 50, estimate: 72 })
  assert.equal(layout.offsetOf(0), 0)
  for (let i = 0; i < 50; i += 1) {
    assert.equal(layout.offsetOf(i), i * 72)
  }
  assert.equal(layout.totalHeight(), 50 * 72)
})

test('the next offset is always the previous offset plus the previous height', () => {
  const layout = new ListLayout({ count: 200, estimate: i => 40 + (i % 7) * 11 })
  const random = rng(3)
  for (let n = 0; n < 300; n += 1) {
    layout.setHeight(Math.floor(random() * 200), 10 + Math.floor(random() * 300))
  }
  for (let i = 0; i < 199; i += 1) {
    assert.equal(
      layout.offsetOf(i + 1),
      layout.offsetOf(i) + layout.heightOf(i),
      `offsets stopped accumulating at ${i}`
    )
  }
})

test('indexAt inverts offsetOf', () => {
  const layout = new ListLayout({ count: 500, estimate: 60 })
  const random = rng(11)
  for (let n = 0; n < 800; n += 1) {
    layout.setHeight(Math.floor(random() * 500), 20 + Math.floor(random() * 200))
  }
  for (let i = 0; i < 500; i += 1) {
    assert.equal(layout.indexAt(layout.offsetOf(i)), i, `indexAt failed to invert at ${i}`)
    assert.equal(layout.indexAt(layout.offsetOf(i) + layout.heightOf(i) - 0.5), i, `midpoint failed at ${i}`)
  }
})

test('indexAt clamps rather than running off either end', () => {
  const layout = new ListLayout({ count: 10, estimate: 50 })
  assert.equal(layout.indexAt(-1000), 0)
  assert.equal(layout.indexAt(0), 0)
  assert.equal(layout.indexAt(499), 9)
  assert.equal(layout.indexAt(500), 9)
  assert.equal(layout.indexAt(1e9), 9)
  assert.equal(new ListLayout({ count: 0, estimate: 50 }).indexAt(0), -1)
})

test('measuring an item moves everything below it and nothing above it', () => {
  const layout = new ListLayout({ count: 100, estimate: 50 })
  const before = Array.from({ length: 100 }, (_, i) => layout.offsetOf(i))

  layout.setHeight(40, 130)

  for (let i = 0; i <= 40; i += 1) {
    assert.equal(layout.offsetOf(i), before[i], `item ${i} above the change should not have moved`)
  }
  for (let i = 41; i < 100; i += 1) {
    assert.equal(layout.offsetOf(i), before[i] + 80, `item ${i} below the change should have moved by 80`)
  }
})

// This is the property the whole design exists to guarantee. An anchored item
// must not move on screen, no matter what gets measured around it.
test('the anchored item holds its screen position through arbitrary measurement', () => {
  const random = rng(2024)

  for (let trial = 0; trial < 40; trial += 1) {
    const count = 5000
    const layout = new ListLayout({ count, estimate: 72 })

    const scrollOffset = Math.floor(random() * layout.totalHeight())
    const anchor = layout.captureAnchor(scrollOffset)
    const positionBefore = screenPosition(layout, anchor.index, scrollOffset)

    // Measure items everywhere: above the anchor, below it, and the anchor
    // itself. Measuring above is what normally ruins a stored offset.
    for (let n = 0; n < 400; n += 1) {
      layout.setHeight(Math.floor(random() * count), 20 + Math.floor(random() * 300))
    }

    const restored = layout.offsetForAnchor(anchor)
    const positionAfter = screenPosition(layout, layout.resolveAnchor(anchor), restored)

    assert.equal(positionAfter, positionBefore, `trial ${trial}: the anchored item moved on screen`)
  }
})

test('prepending does not move the anchored item', () => {
  const random = rng(555)

  for (let trial = 0; trial < 30; trial += 1) {
    const layout = new ListLayout({ count: 2000, estimate: 72 })
    for (let n = 0; n < 300; n += 1) {
      layout.setHeight(Math.floor(random() * 2000), 30 + Math.floor(random() * 200))
    }

    const scrollOffset = Math.floor(random() * layout.totalHeight())
    const anchor = layout.captureAnchor(scrollOffset)
    const anchoredItemHeight = layout.heightOf(anchor.index)
    const positionBefore = screenPosition(layout, anchor.index, scrollOffset)

    const added = 1 + Math.floor(random() * 200)
    layout.prepend(added, () => 40 + Math.floor(random() * 120))

    const restored = layout.offsetForAnchor(anchor)
    const resolved = layout.resolveAnchor(anchor)

    assert.equal(resolved, anchor.index + added, `trial ${trial}: anchor lost track of its item`)
    assert.equal(layout.heightOf(resolved), anchoredItemHeight, `trial ${trial}: anchor points at a different item`)
    assert.equal(
      screenPosition(layout, resolved, restored),
      positionBefore,
      `trial ${trial}: the list jumped when older items were loaded`
    )
  }
})

test('prepending repeatedly keeps working after the buffer has to grow', () => {
  // The front room is finite, so this forces at least one reallocation and
  // checks nothing was lost in the move.
  const layout = new ListLayout({ count: 100, estimate: 50, headroom: 8 })
  layout.setHeight(0, 123)
  const anchor = layout.captureAnchor(layout.offsetOf(50))
  const positionBefore = screenPosition(layout, 50, layout.offsetOf(50))

  let added = 0
  for (let round = 0; round < 20; round += 1) {
    layout.prepend(25, () => 60)
    added += 25
  }

  assert.equal(layout.count, 100 + added)
  assert.equal(layout.heightOf(added), 123, 'a measured height was lost when the buffer grew')

  const resolved = layout.resolveAnchor(anchor)
  const restored = layout.offsetForAnchor(anchor)
  assert.equal(resolved, 50 + added)
  assert.equal(screenPosition(layout, resolved, restored), positionBefore)
})

test('measurements survive appending past the end of the buffer', () => {
  const layout = new ListLayout({ count: 10, estimate: 50, headroom: 4 })
  layout.setHeight(3, 200)
  layout.append(500, () => 30)
  assert.equal(layout.count, 510)
  assert.equal(layout.heightOf(3), 200)
  assert.equal(layout.totalHeight(), 9 * 50 + 200 + 500 * 30)
})

test('an anchor taken before a prepend still resolves after several more', () => {
  const layout = new ListLayout({ count: 500, estimate: 40 })
  const anchor = layout.captureAnchor(layout.offsetOf(100))
  layout.prepend(10, () => 40)
  layout.prepend(20, () => 40)
  layout.prepend(5, () => 40)
  assert.equal(layout.resolveAnchor(anchor), 135)
})

test('scrolling to an index respects alignment and never overscrolls', () => {
  const layout = new ListLayout({ count: 100, estimate: 100 })
  const viewportHeight = 500

  assert.equal(layout.offsetForIndex(50, { viewportHeight }), 5000)
  assert.equal(layout.offsetForIndex(50, { align: 'center', viewportHeight }), 5000 - 200)
  assert.equal(layout.offsetForIndex(50, { align: 'end', viewportHeight }), 5000 - 400)

  // Clamped at both ends rather than scrolling into empty space.
  assert.equal(layout.offsetForIndex(0, { align: 'center', viewportHeight }), 0)
  assert.equal(layout.offsetForIndex(99, { viewportHeight }), 10000 - 500)
  assert.equal(layout.offsetForIndex(99, { align: 'end', viewportHeight }), 10000 - 500)
})

test('the visible range covers the viewport and honours overscan', () => {
  const layout = new ListLayout({ count: 1000, estimate: 50 })

  assert.deepEqual(layout.visibleRange(0, 500), { start: 0, end: 11 })
  assert.deepEqual(layout.visibleRange(500, 500), { start: 10, end: 21 })
  assert.deepEqual(layout.visibleRange(500, 500, 3), { start: 7, end: 24 })

  // Overscan must not push the range outside the list.
  assert.deepEqual(layout.visibleRange(0, 500, 100), { start: 0, end: 111 })
  const atEnd = layout.visibleRange(49500, 500, 100)
  assert.equal(atEnd.end, 1000)
})

test('every item in the visible range actually intersects the viewport', () => {
  const layout = new ListLayout({ count: 800, estimate: 60 })
  const random = rng(808)
  for (let n = 0; n < 1200; n += 1) {
    layout.setHeight(Math.floor(random() * 800), 20 + Math.floor(random() * 180))
  }

  for (let trial = 0; trial < 200; trial += 1) {
    const viewportHeight = 400 + Math.floor(random() * 400)
    const scrollOffset = Math.floor(random() * Math.max(layout.totalHeight() - viewportHeight, 1))
    const { start, end } = layout.visibleRange(scrollOffset, viewportHeight)

    // Nothing before start may intersect, and start itself must.
    if (start > 0) {
      assert.ok(
        layout.offsetOf(start - 1) + layout.heightOf(start - 1) <= scrollOffset,
        `item ${start - 1} was excluded but still intersects`
      )
    }
    assert.ok(layout.offsetOf(start) + layout.heightOf(start) > scrollOffset, `item ${start} does not reach the viewport`)
    assert.ok(layout.offsetOf(end - 1) < scrollOffset + viewportHeight, `item ${end - 1} starts past the viewport`)
  }
})

test('a zero height item does not break positioning around it', () => {
  const layout = new ListLayout({ count: 20, estimate: 50 })
  layout.setHeight(5, 0)
  assert.equal(layout.offsetOf(5), 250)
  assert.equal(layout.offsetOf(6), 250)
  assert.equal(layout.totalHeight(), 19 * 50)
  // A zero height item cannot be landed on, so the neighbour answers instead.
  assert.equal(layout.indexAt(250), 6)
})

test('an empty list answers everything without throwing', () => {
  const layout = new ListLayout({ count: 0, estimate: 50 })
  assert.equal(layout.totalHeight(), 0)
  assert.equal(layout.offsetForIndex(5, { viewportHeight: 100 }), 0)
  assert.deepEqual(layout.visibleRange(0, 100), { start: 0, end: 0 })
  assert.equal(layout.offsetForAnchor({ index: 3, delta: 10, origin: 0 }), 0)
})

test('bad input is rejected rather than silently corrupting the tree', () => {
  assert.throws(() => new ListLayout({ count: 10 }), /estimate must be/)
  assert.throws(() => new ListLayout({ count: -1, estimate: 5 }), /non negative integer/)
  assert.throws(() => new ListLayout({ count: 10, estimate: () => NaN }), /not a usable height/)

  const layout = new ListLayout({ count: 10, estimate: 50 })
  assert.throws(() => layout.setHeight(0, NaN), /not a usable height/)
  assert.throws(() => layout.setHeight(0, -5), /not a usable height/)
  assert.throws(() => layout.prepend(1.5), /non negative integer/)

  // Out of range measurements are ignored rather than throwing, because they
  // arrive from a renderer that may be a frame behind the data.
  assert.equal(layout.setHeight(999, 40), false)
  assert.equal(layout.setHeight(-1, 40), false)
})

test('setHeight reports whether anything actually moved', () => {
  const layout = new ListLayout({ count: 10, estimate: 50 })
  assert.equal(layout.setHeight(4, 50), false, 'measuring the estimate should be a no op')
  assert.equal(layout.setHeight(4, 90), true)
  assert.equal(layout.setHeight(4, 90), false, 'remeasuring the same height should be a no op')
  assert.equal(layout.isMeasured(4), true)
  assert.equal(layout.isMeasured(5), false)
})

test('a million items stay correct, not just fast', () => {
  // Scale is the whole point, so the invariants are checked at the size the
  // library claims to handle rather than only at test sizes.
  const count = 1_000_000
  const layout = new ListLayout({ count, estimate: 72 })
  const random = rng(42)

  for (let i = 0; i < 50_000; i += 1) {
    layout.setHeight(Math.floor(random() * count), 20 + Math.floor(random() * 300))
  }

  const scrollOffset = layout.offsetOf(700_000) + 17
  const anchor = layout.captureAnchor(scrollOffset)
  const positionBefore = screenPosition(layout, anchor.index, scrollOffset)

  for (let i = 0; i < 50_000; i += 1) {
    layout.setHeight(Math.floor(random() * count), 20 + Math.floor(random() * 300))
  }
  layout.prepend(5000, () => 60)

  const restored = layout.offsetForAnchor(anchor)
  const resolved = layout.resolveAnchor(anchor)
  assert.equal(screenPosition(layout, resolved, restored), positionBefore, 'the anchor drifted at scale')

  for (let i = 0; i < layout.count; i += 9973) {
    assert.equal(layout.indexAt(layout.offsetOf(i)), i, `indexAt failed to invert at ${i}`)
  }

  let sum = 0
  for (let i = 0; i < layout.count; i += 1) sum += layout.heightOf(i)
  assert.equal(sum, layout.totalHeight(), 'the tree total drifted from the sum of heights')
})

test('fractional heights do not accumulate error across the tree', () => {
  // Heights are stored as Float32 but summed as Float64 precisely so this
  // holds. Summing Float32 into Float32 would visibly drift by this size.
  const layout = new ListLayout({ count: 200_000, estimate: 72.5 })
  const random = rng(17)
  for (let i = 0; i < 40_000; i += 1) {
    layout.setHeight(Math.floor(random() * 200_000), 20 + random() * 300)
  }
  let sum = 0
  for (let i = 0; i < layout.count; i += 1) sum += layout.heightOf(i)
  assert.equal(sum, layout.totalHeight())
})
