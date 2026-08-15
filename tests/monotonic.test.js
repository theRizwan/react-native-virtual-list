import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ListLayout } from '../src/layout.js'

/**
 * Reproduces the failure mode reported against FlashList v2 in Shopify/flash-list
 * issue 2307, then shows the same sequence against this layout.
 *
 * The reported mechanism is that unmeasured items are positioned using a
 * rolling average height, and the whole layout table is rebuilt from that
 * average. When the items above the viewport are measured and turn out to be
 * taller than the average, their positions grow, but the items below are still
 * placed from the stale average. The table then steps backwards at the
 * boundary between the two, and a binary search over a table that is not
 * sorted can return anything.
 */

const REAL_HEIGHT = 300
const SEEDED_AVERAGE = 200
const COUNT = 500
const BOUNDARY = 250

/** A layout table built the way the issue describes. */
function rollingAverageTable(measuredUpTo) {
  const offsets = new Float64Array(COUNT)
  let running = 0
  for (let i = 0; i < COUNT; i += 1) {
    offsets[i] = running
    running += i < measuredUpTo ? REAL_HEIGHT : SEEDED_AVERAGE
  }
  return offsets
}

/** The binary search such a table is consumed by. */
function binarySearch(offsets, target) {
  let low = 0
  let high = offsets.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (offsets[mid] <= target) low = mid
    else high = mid - 1
  }
  return low
}

test('the reported mechanism does produce a table that steps backwards', () => {
  // Before anything is measured, item 250 is placed using the seeded average.
  const before = rollingAverageTable(0)
  assert.equal(before[BOUNDARY], BOUNDARY * SEEDED_AVERAGE)
  assert.equal(before[BOUNDARY], 50_000)

  // Once the items above it are measured they take their real height, so the
  // same item is now positioned 25,000px further down.
  const after = rollingAverageTable(BOUNDARY)
  assert.equal(after[BOUNDARY], BOUNDARY * REAL_HEIGHT)
  assert.equal(after[BOUNDARY], 75_000)

  // The table is rebuilt only as far as the measured frontier, so the next
  // item is still placed from the stale average and lands above its
  // predecessor. This is the backward jump the issue describes.
  const stale = new Float64Array(after)
  stale[BOUNDARY + 1] = (BOUNDARY + 1) * SEEDED_AVERAGE
  assert.ok(stale[BOUNDARY + 1] < stale[BOUNDARY], 'expected the table to step backwards')
  assert.equal(stale[BOUNDARY + 1], 50_200)

  // A binary search assumes the array is sorted. Once it is not, the answer is
  // simply wrong, which is why the reporter sees a different item than asked
  // for rather than one that is merely a little off.
  const wanted = stale[BOUNDARY]
  const found = binarySearch(stale, wanted)
  assert.notEqual(found, BOUNDARY, 'the search should be misled by the unsorted table')
})

test('this layout cannot produce a table that steps backwards', () => {
  // The same sequence: seed everything at the wrong estimate, then measure the
  // items above the boundary and ask where things are.
  const layout = new ListLayout({ count: COUNT, estimate: SEEDED_AVERAGE })
  for (let i = 0; i < BOUNDARY; i += 1) layout.setHeight(i, REAL_HEIGHT)

  assert.equal(layout.offsetOf(BOUNDARY), BOUNDARY * REAL_HEIGHT)

  // Offsets are prefix sums over non negative heights, so the sequence is non
  // decreasing by construction. There is no partially rebuilt table to fall
  // out of order, because there is no table.
  for (let i = 1; i < COUNT; i += 1) {
    assert.ok(
      layout.offsetOf(i) >= layout.offsetOf(i - 1),
      `offset stepped backwards between ${i - 1} and ${i}`
    )
  }

  // And the lookup still returns the item that was asked for.
  assert.equal(layout.indexAt(layout.offsetOf(BOUNDARY)), BOUNDARY)
})

test('measuring in any order leaves the offsets sorted', () => {
  // The order measurements arrive in is decided by the renderer, not by us, so
  // the ordering property has to survive an adversarial arrival order.
  const layout = new ListLayout({ count: 300, estimate: SEEDED_AVERAGE })
  const order = [...Array(300).keys()].sort((a, b) => ((a * 7919) % 300) - ((b * 7919) % 300))

  for (const index of order) {
    layout.setHeight(index, 50 + ((index * 37) % 400))
    for (let i = 1; i < 300; i += 1) {
      assert.ok(layout.offsetOf(i) >= layout.offsetOf(i - 1), `offsets unsorted after measuring ${index}`)
    }
  }
})

test('scrolling to an unmeasured item lands on that item, not a neighbour', () => {
  // The estimate is wrong by 50 percent, which is the condition in the report.
  const layout = new ListLayout({ count: COUNT, estimate: SEEDED_AVERAGE })

  for (const target of [10, 100, BOUNDARY, 400, 499]) {
    const offset = layout.offsetForIndex(target, { viewportHeight: 800 })
    // Alignment clamps at the very end of the list, so the guarantee is that
    // the target is on screen rather than exactly at the top.
    const { start, end } = layout.visibleRange(offset, 800)
    assert.ok(target >= start && target < end, `item ${target} was not on screen after scrolling to it`)
  }
})
