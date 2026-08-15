import { useCallback, useRef, useState } from 'react'

import { ListController } from './controller.js'

/**
 * Wires the controller to React's lifecycle.
 *
 * The controller is kept in a ref rather than in state because it is mutable
 * and every scroll event touches it. State holds only a version counter, which
 * is bumped when the set of visible items actually changes, so a scroll that
 * does not reveal a new item does not re-render.
 */
export function useVirtualList({
  count,
  estimate = 100,
  overscan = 3,
  viewportHeight = 0,
  onVisibleRangeChange,
}) {
  const controllerRef = useRef(null)
  if (controllerRef.current === null) {
    controllerRef.current = new ListController({ count, estimate, overscan, viewportHeight })
  }
  const controller = controllerRef.current

  const [, setVersion] = useState(0)
  const rerender = useCallback(() => setVersion(v => v + 1), [])

  // Reconcile the item count. Growth at the end is an append; growth at the
  // front has to be declared through prepend(), because only the caller knows
  // which end changed.
  if (count > controller.count) {
    controller.append(count - controller.count)
  } else if (count < controller.count) {
    controllerRef.current = new ListController({ count, estimate, overscan, viewportHeight })
  }

  if (viewportHeight !== controller.viewportHeight) {
    controller.setViewportHeight(viewportHeight)
  }

  const lastRange = useRef({ start: -1, end: -1 })

  const commit = useCallback(() => {
    const range = controller.range()
    if (range.start !== lastRange.current.start || range.end !== lastRange.current.end) {
      lastRange.current = range
      onVisibleRangeChange?.(range)
      rerender()
      return true
    }
    return false
  }, [controller, onVisibleRangeChange, rerender])

  const onScroll = useCallback(
    offset => {
      controller.onScroll(offset)
      commit()
    },
    [controller, commit]
  )

  // Measurements arrive one item at a time from onLayout. Batching them into a
  // microtask means a screen of items causes one re-render rather than one per
  // row, which matters because every measurement can move everything below it.
  const pending = useRef([])
  const flushing = useRef(false)

  const measure = useCallback(
    (index, height) => {
      pending.current.push([index, height])
      if (flushing.current) return
      flushing.current = true
      queueMicrotask(() => {
        flushing.current = false
        const batch = pending.current
        pending.current = []
        const moved = controller.measureMany(batch)
        if (moved) commit()
        else rerender()
      })
    },
    [controller, commit, rerender]
  )

  const prepend = useCallback(
    (n, estimateFor) => {
      controller.prepend(n, estimateFor)
      rerender()
    },
    [controller, rerender]
  )

  const scrollToIndex = useCallback(
    (index, options) => {
      const offset = controller.scrollToIndex(index, options)
      rerender()
      return offset
    },
    [controller, rerender]
  )

  const scrollToEnd = useCallback(() => {
    const offset = controller.scrollToEnd()
    rerender()
    return offset
  }, [controller, rerender])

  // Computed every render rather than memoised. The controller is mutable, so
  // any dependency list would go stale, and the work is one O(log n) lookup
  // plus a walk over the items actually on screen.
  const frame = controller.frame()

  return { controller, frame, onScroll, measure, prepend, scrollToIndex, scrollToEnd }
}
