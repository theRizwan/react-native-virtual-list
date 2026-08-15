import React, { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react'
import { ScrollView, View } from 'react-native'

import { useVirtualList } from './useVirtualList.js'

/**
 * A virtualized list that positions items itself.
 *
 * Items are absolutely positioned inside a container of the full scrollable
 * height, so the only thing the scroll view has to know is how tall the content
 * is. Heights are reported back through onLayout and corrected in place.
 *
 * On React Native the platform maintains visible position across insertions
 * through the scroll view itself. On react-native-web it does not, because
 * react-native-web does not implement maintainVisibleContentPosition at all, so
 * the anchor kept by the controller is what holds the position there.
 */
export const VirtualList = forwardRef(function VirtualList(
  {
    data,
    renderItem,
    keyExtractor,
    estimatedItemHeight = 100,
    overscan = 3,
    onStartReached,
    onStartReachedThreshold = 0,
    onEndReached,
    onEndReachedThreshold = 0,
    maintainVisiblePosition = true,
    ListEmptyComponent,
    style,
    contentContainerStyle,
    onScroll: onScrollProp,
    ...rest
  },
  ref
) {
  const scrollRef = useRef(null)
  const [viewportHeight, setViewportHeight] = useState(0)

  const { controller, frame, onScroll, measure, prepend, scrollToIndex, scrollToEnd } =
    useVirtualList({
      count: data.length,
      estimate: estimatedItemHeight,
      overscan,
      viewportHeight,
    })

  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex(index, options = {}) {
        const offset = scrollToIndex(index, options)
        scrollRef.current?.scrollTo({ y: offset, animated: options.animated ?? false })
        return offset
      },
      scrollToEnd(options = {}) {
        const offset = scrollToEnd()
        scrollRef.current?.scrollTo({ y: offset, animated: options.animated ?? false })
        return offset
      },
      prepend,
      getController: () => controller,
    }),
    [controller, prepend, scrollToEnd, scrollToIndex]
  )

  const reachedStart = useRef(false)
  const reachedEnd = useRef(false)

  const handleScroll = useCallback(
    event => {
      const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent
      onScroll(contentOffset.y)

      // Edge callbacks latch, so a user sitting at an edge does not fire them
      // on every frame, and they reset once the user moves back off the edge.
      const nearStart = contentOffset.y <= onStartReachedThreshold
      if (nearStart && !reachedStart.current) {
        reachedStart.current = true
        onStartReached?.()
      } else if (!nearStart) {
        reachedStart.current = false
      }

      const distanceToEnd = contentSize.height - contentOffset.y - layoutMeasurement.height
      const nearEnd = distanceToEnd <= onEndReachedThreshold
      if (nearEnd && !reachedEnd.current) {
        reachedEnd.current = true
        onEndReached?.()
      } else if (!nearEnd) {
        reachedEnd.current = false
      }

      onScrollProp?.(event)
    },
    [onScroll, onScrollProp, onStartReached, onStartReachedThreshold, onEndReached, onEndReachedThreshold]
  )

  const handleLayout = useCallback(event => {
    setViewportHeight(event.nativeEvent.layout.height)
  }, [])

  if (data.length === 0 && ListEmptyComponent) {
    return (
      <View style={style} onLayout={handleLayout}>
        {React.isValidElement(ListEmptyComponent) ? ListEmptyComponent : <ListEmptyComponent />}
      </View>
    )
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={style}
      contentContainerStyle={contentContainerStyle}
      onLayout={handleLayout}
      onScroll={handleScroll}
      scrollEventThrottle={16}
      maintainVisibleContentPosition={
        maintainVisiblePosition ? { minIndexForVisible: 0 } : undefined
      }
      {...rest}
    >
      <View style={{ height: frame.totalHeight }}>
        {frame.items.map(item => {
          const value = data[item.index]
          const key = keyExtractor ? keyExtractor(value, item.index) : String(item.index)
          return (
            <VirtualListItem
              key={key}
              index={item.index}
              offset={item.offset}
              onMeasure={measure}
            >
              {renderItem({ item: value, index: item.index })}
            </VirtualListItem>
          )
        })}
      </View>
    </ScrollView>
  )
})

/**
 * One row. It reports its measured height upward and is positioned absolutely,
 * so a height correction moves the rows below it without reflowing the ones
 * above.
 */
function VirtualListItem({ index, offset, onMeasure, children }) {
  const handleLayout = useCallback(
    event => {
      onMeasure(index, event.nativeEvent.layout.height)
    },
    [index, onMeasure]
  )

  return (
    <View
      onLayout={handleLayout}
      style={{ position: 'absolute', top: offset, left: 0, right: 0 }}
    >
      {children}
    </View>
  )
}
