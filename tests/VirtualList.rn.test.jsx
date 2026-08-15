import React from 'react'
import { Text } from 'react-native'
import TestRenderer, { act } from 'react-test-renderer'

import { VirtualList } from '../src/VirtualList.js'

const VIEWPORT = 600
const ROW = 100

function scrollEvent(y, contentHeight) {
  return {
    nativeEvent: {
      contentOffset: { x: 0, y },
      layoutMeasurement: { width: 400, height: VIEWPORT },
      contentSize: { width: 400, height: contentHeight },
    },
  }
}

/** Renders the list and drives the layout events a real host would send. */
function mount(props = {}) {
  const data = props.data ?? Array.from({ length: 1000 }, (_, i) => i)
  const ref = React.createRef()
  let tree

  act(() => {
    tree = TestRenderer.create(
      <VirtualList
        ref={ref}
        data={data}
        estimatedItemHeight={ROW}
        renderItem={({ item }) => <Text>{`Item ${item}`}</Text>}
        keyExtractor={(item) => String(item)}
        {...props}
      />
    )
  })

  const scrollView = tree.root.findAllByProps({ scrollEventThrottle: 16 })[0] ?? null

  // The host reports the viewport size.
  const target = scrollView ?? tree.root.findAll((node) => node.props?.onLayout)[0]
  act(() => {
    target.props.onLayout({ nativeEvent: { layout: { width: 400, height: VIEWPORT } } })
  })

  return { tree, ref, scrollView, data }
}

/** Every row currently mounted, in index order. */
function renderedIndices(tree) {
  return tree.root
    .findAllByType(Text)
    .map((node) => Number(String(node.props.children).replace('Item ', '')))
    .sort((a, b) => a - b)
}

/** Feeds each mounted row its real height through onLayout. */
async function reportHeights(tree, heightFor) {
  const rows = tree.root.findAll(
    (node) => node.props?.onLayout && node.props?.style?.position === 'absolute'
  )
  await act(async () => {
    for (const row of rows) {
      const index = Number(
        String(row.findByType(Text).props.children).replace('Item ', '')
      )
      row.props.onLayout({
        nativeEvent: { layout: { width: 400, height: heightFor(index) } },
      })
    }
  })
}

describe('VirtualList', () => {
  it('mounts only the rows the viewport needs', () => {
    const { tree } = mount()
    const indices = renderedIndices(tree)

    // 600px viewport over 100px rows is 7 rows, plus 3 overscan each side.
    expect(indices[0]).toBe(0)
    expect(indices.length).toBeLessThan(15)
    expect(indices).not.toContain(500)
  })

  it('renders the rows for the offset it is scrolled to', () => {
    const { tree, scrollView } = mount()

    act(() => {
      scrollView.props.onScroll(scrollEvent(5000, 100_000))
    })

    const indices = renderedIndices(tree)
    expect(indices).toContain(50)
    expect(indices).not.toContain(0)
  })

  it('reports the full scrollable height, not just the mounted rows', () => {
    const { tree } = mount()
    const inner = tree.root.findAll((node) => node.props?.style?.height !== undefined)
    expect(inner[0].props.style.height).toBe(1000 * ROW)
  })

  it('corrects positions when rows measure taller than the estimate', async () => {
    const { tree } = mount()

    // Every row is really 250px, not the 100px estimated.
    await reportHeights(tree, () => 250)

    const inner = tree.root.findAll((node) => node.props?.style?.height !== undefined)
    // The rows that measured are corrected, the rest still use the estimate,
    // so the total lands between the two extremes rather than staying at 100k.
    expect(inner[0].props.style.height).toBeGreaterThan(1000 * ROW)
  })

  it('scrollToIndex puts the requested row on screen', () => {
    const { tree, ref } = mount()

    act(() => {
      ref.current.scrollToIndex(400)
    })

    expect(renderedIndices(tree)).toContain(400)
  })

  it('scrollToIndex is accurate even when no row has been measured', () => {
    // This is the case behind the FlashList issue: the estimate is wrong by a
    // long way and nothing has measured yet.
    const { tree, ref } = mount({ estimatedItemHeight: 40 })

    act(() => {
      ref.current.scrollToIndex(750)
    })

    expect(renderedIndices(tree)).toContain(750)
  })

  it('holds position when older rows are added at the front', () => {
    const { tree, ref, scrollView } = mount()

    act(() => {
      scrollView.props.onScroll(scrollEvent(5000, 100_000))
    })
    const before = renderedIndices(tree)
    const anchoredIndex = before[3]
    const controller = ref.current.getController()
    const screenBefore =
      controller.layout.offsetOf(anchoredIndex) - controller.scrollOffset

    act(() => {
      ref.current.prepend(200, () => 300)
    })

    const resolved = controller.layout.resolveAnchor(controller.anchor)
    const screenAfter = controller.layout.offsetOf(resolved) - controller.scrollOffset

    expect(screenAfter).toBe(screenBefore)
  })

  it('fires onStartReached once at the top rather than every frame', () => {
    const onStartReached = jest.fn()
    const { scrollView } = mount({ onStartReached })

    act(() => {
      scrollView.props.onScroll(scrollEvent(0, 100_000))
      scrollView.props.onScroll(scrollEvent(0, 100_000))
    })
    expect(onStartReached).toHaveBeenCalledTimes(1)

    // Move away and come back, and it arms again.
    act(() => {
      scrollView.props.onScroll(scrollEvent(5000, 100_000))
      scrollView.props.onScroll(scrollEvent(0, 100_000))
    })
    expect(onStartReached).toHaveBeenCalledTimes(2)
  })

  it('fires onEndReached at the bottom', () => {
    const onEndReached = jest.fn()
    const { scrollView } = mount({ onEndReached })

    act(() => {
      scrollView.props.onScroll(scrollEvent(100_000 - VIEWPORT, 100_000))
    })
    expect(onEndReached).toHaveBeenCalledTimes(1)
  })

  it('renders the empty component when there is no data', () => {
    const { tree } = mount({
      data: [],
      ListEmptyComponent: () => <Text>Nothing here</Text>,
    })
    expect(tree.root.findByType(Text).props.children).toBe('Nothing here')
  })

  it('asks the platform to maintain visible position by default', () => {
    const { scrollView } = mount()
    expect(scrollView.props.maintainVisibleContentPosition).toEqual({ minIndexForVisible: 0 })
  })

  it('can be told not to', () => {
    const { scrollView } = mount({ maintainVisiblePosition: false })
    expect(scrollView.props.maintainVisibleContentPosition).toBeUndefined()
  })

  it('handles a list of a hundred thousand rows without mounting them', () => {
    const { tree } = mount({ data: Array.from({ length: 100_000 }, (_, i) => i) })
    expect(renderedIndices(tree).length).toBeLessThan(15)
  })
})
