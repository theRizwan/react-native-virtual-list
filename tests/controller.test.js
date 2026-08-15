import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ListController } from '../src/controller.js'

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

test('a frame reports only items that are on screen, plus overscan', () => {
  const controller = new ListController({ count: 1000, estimate: 100, viewportHeight: 500, overscan: 2 })
  controller.onScroll(0)
  const frame = controller.frame()

  assert.equal(frame.start, 0)
  assert.equal(frame.end, 8)
  assert.equal(frame.totalHeight, 100_000)
  assert.equal(frame.items.length, 8)
  assert.deepEqual(
    frame.items.map(i => i.offset),
    [0, 100, 200, 300, 400, 500, 600, 700]
  )
})

test('the list does not move when older items are loaded', () => {
  const controller = new ListController({ count: 500, estimate: 80, viewportHeight: 600 })
  controller.onScroll(controller.layout.offsetOf(200))

  const anchoredIndex = controller.anchor.index
  const screenBefore = controller.layout.offsetOf(anchoredIndex) - controller.scrollOffset

  controller.prepend(100, () => 250)

  const resolved = controller.layout.resolveAnchor(controller.anchor)
  const screenAfter = controller.layout.offsetOf(resolved) - controller.scrollOffset

  assert.equal(resolved, anchoredIndex + 100)
  assert.equal(screenAfter, screenBefore, 'loading older items moved the content')
})

// Legend List issue 491 reports that prepending items much taller than their
// estimate jumps the list, because the correction is computed from the
// accumulated estimate error of the rows above the anchor. Here the prepended
// items are deliberately five times their estimate.
test('prepending items far taller than their estimate still does not jump', () => {
  const controller = new ListController({ count: 300, estimate: 100, viewportHeight: 700 })
  controller.onScroll(controller.layout.offsetOf(150))

  const anchored = controller.anchor.index
  const screenBefore = controller.layout.offsetOf(anchored) - controller.scrollOffset

  controller.prepend(40, () => 100)
  // The estimate said 100. They are actually 500, which is the case the report
  // describes as easily thousands of pixels of error in a single pass.
  for (let i = 0; i < 40; i += 1) controller.measure(i, 500)

  const resolved = controller.layout.resolveAnchor(controller.anchor)
  const screenAfter = controller.layout.offsetOf(resolved) - controller.scrollOffset

  assert.equal(resolved, anchored + 40)
  assert.equal(screenAfter, screenBefore, 'the list jumped when tall older items were measured')
})

test('measuring anything above the viewport does not move the viewport', () => {
  const controller = new ListController({ count: 2000, estimate: 72, viewportHeight: 800 })
  controller.onScroll(controller.layout.offsetOf(900))

  const anchored = controller.anchor.index
  const screenBefore = controller.layout.offsetOf(anchored) - controller.scrollOffset

  const random = rng(4)
  for (let n = 0; n < 500; n += 1) {
    controller.measure(Math.floor(random() * 900), 20 + Math.floor(random() * 400))
  }

  const screenAfter = controller.layout.offsetOf(anchored) - controller.scrollOffset
  assert.equal(screenAfter, screenBefore, 'measuring offscreen content above moved the viewport')
})

test('following the end survives appends and re-measurement', () => {
  const controller = new ListController({ count: 100, estimate: 60, viewportHeight: 500 })
  controller.scrollToEnd()
  assert.equal(controller.atEnd, true)
  assert.equal(controller.scrollOffset, 100 * 60 - 500)

  controller.append(20, () => 60)
  assert.equal(controller.scrollOffset, 120 * 60 - 500, 'appending should keep the list at the end')

  // Re-measuring taller than estimated must not strand the list mid content.
  for (let i = 100; i < 120; i += 1) controller.measure(i, 200)
  assert.equal(controller.scrollOffset, controller.maxOffset())
})

test('scrolling away from the end stops the list following it', () => {
  const controller = new ListController({ count: 100, estimate: 60, viewportHeight: 500 })
  controller.scrollToEnd()
  controller.onScroll(1000)
  assert.equal(controller.atEnd, false)

  const before = controller.scrollOffset
  controller.append(20, () => 60)
  assert.equal(controller.scrollOffset, before, 'appending should not drag a scrolled up user down')
})

test('scrollToIndex puts the item on screen even when nothing is measured', () => {
  const controller = new ListController({ count: 5000, estimate: 200, viewportHeight: 800 })

  for (const target of [0, 1, 1234, 4999]) {
    controller.scrollToIndex(target)
    const { start, end } = controller.range()
    assert.ok(target >= start && target < end, `item ${target} was not on screen`)
    assert.equal(controller.takePendingScroll() !== null, true)
    assert.equal(controller.takePendingScroll(), null, 'a pending scroll should only be consumed once')
  }
})

test('an item stays on screen after the list around it is measured', () => {
  // Scrolling to an item then discovering every height was wrong is the
  // initial position problem. The anchor is what keeps the target in view.
  const controller = new ListController({ count: 3000, estimate: 200, viewportHeight: 800 })
  controller.scrollToIndex(1500, { align: 'center' })
  controller.takePendingScroll()

  const random = rng(88)
  for (let n = 0; n < 2000; n += 1) {
    controller.measure(Math.floor(random() * 3000), 40 + Math.floor(random() * 500))
  }

  const { start, end } = controller.range()
  assert.ok(1500 >= start && 1500 < end, 'the target item drifted off screen once heights were known')
})

test('measure reports whether the visible window actually changed', () => {
  const controller = new ListController({ count: 500, estimate: 100, viewportHeight: 500, overscan: 0 })
  controller.onScroll(0)

  // Far below the viewport, so the window is unaffected.
  assert.equal(controller.measure(400, 350), false)
  // Inside the viewport, so it is.
  assert.equal(controller.measure(1, 400), true)
  // Same height again is a no op.
  assert.equal(controller.measure(1, 400), false)
})

test('measureMany applies a batch and reports once', () => {
  const controller = new ListController({ count: 500, estimate: 100, viewportHeight: 500, overscan: 0 })
  controller.onScroll(0)
  assert.equal(controller.measureMany([[300, 120], [301, 130]]), false)
  assert.equal(controller.measureMany([[0, 400], [1, 400]]), true)
  assert.equal(controller.layout.heightOf(0), 400)
  assert.equal(controller.layout.heightOf(301), 130)
})

test('the scroll offset is always inside the scrollable range', () => {
  const controller = new ListController({ count: 50, estimate: 100, viewportHeight: 800 })
  controller.onScroll(1e9)
  assert.equal(controller.scrollOffset, controller.maxOffset())
  controller.onScroll(-500)
  assert.equal(controller.scrollOffset, 0)

  // A viewport taller than the content cannot scroll at all.
  const short = new ListController({ count: 2, estimate: 100, viewportHeight: 800 })
  short.onScroll(400)
  assert.equal(short.maxOffset(), 0)
  assert.equal(short.scrollOffset, 0)
})

test('an empty list produces an empty frame rather than throwing', () => {
  const controller = new ListController({ count: 0, estimate: 100, viewportHeight: 500 })
  const frame = controller.frame()
  assert.deepEqual(frame.items, [])
  assert.equal(frame.totalHeight, 0)
  assert.equal(frame.scrollOffset, 0)
})

test('a long chat session holds its position throughout', () => {
  // Open in the middle, page older content in repeatedly, measure as it
  // arrives, and check the item under the user never moves.
  const controller = new ListController({ count: 2000, estimate: 72, viewportHeight: 700 })
  const random = rng(2026)
  controller.onScroll(controller.layout.offsetOf(1000))

  const anchored = controller.anchor.index
  const screenBefore = controller.layout.offsetOf(anchored) - controller.scrollOffset
  let shift = 0

  for (let page = 0; page < 25; page += 1) {
    const size = 20 + Math.floor(random() * 60)
    controller.prepend(size, () => 72)
    shift += size

    for (let i = 0; i < size; i += 1) {
      controller.measure(i, 30 + Math.floor(random() * 400))
    }
    for (let n = 0; n < 50; n += 1) {
      controller.measure(Math.floor(random() * controller.count), 30 + Math.floor(random() * 400))
    }

    const resolved = controller.layout.resolveAnchor(controller.anchor)
    const screenAfter = controller.layout.offsetOf(resolved) - controller.scrollOffset
    assert.equal(resolved, anchored + shift, `page ${page}: anchor lost its item`)
    assert.equal(screenAfter, screenBefore, `page ${page}: the conversation moved under the user`)
  }
})
