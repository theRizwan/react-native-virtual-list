# react-native-virtual-list

A virtualized list for React Native and react-native-web that keeps its scroll position when item heights are only known after they render.
[![npm](https://img.shields.io/npm/v/react-native-virtual-list?label=npm)](https://www.npmjs.com/package/react-native-virtual-list)
[![downloads](https://img.shields.io/npm/dm/react-native-virtual-list?label=downloads)](https://www.npmjs.com/package/react-native-virtual-list)
[![tests](https://img.shields.io/github/actions/workflow/status/theRizwan/react-native-virtual-list/ci.yml?label=tests)](https://github.com/theRizwan/react-native-virtual-list/actions/workflows/ci.yml)
[![last release](https://img.shields.io/github/release-date/theRizwan/react-native-virtual-list?label=last%20release)](https://github.com/theRizwan/react-native-virtual-list/releases)
[![license](https://img.shields.io/npm/l/react-native-virtual-list?label=license)](./LICENSE)

Docs: **<https://therizwan.github.io/react-native-virtual-list/>**


```sh
npm install react-native-virtual-list
```

```jsx
import { VirtualList } from 'react-native-virtual-list'

<VirtualList
  data={messages}
  estimatedItemHeight={72}
  keyExtractor={(item) => item.id}
  renderItem={({ item }) => <Message {...item} />}
  onStartReached={loadOlder}
/>
```

## Should you use this

Probably not, and it is worth being straight about that before you install anything.

If you are on React Native and you want the fastest list with the most users behind it, use [FlashList](https://github.com/Shopify/flash-list). It has 1.8 million weekly downloads, a team at Shopify behind it, per type recycling pools, and it enables `maintainVisibleContentPosition` by default. [Legend List](https://github.com/LegendApp/legend-list) is also good and is built with chat in mind.

Neither of those is going to be beaten here, and this does not try to.

**The case for this one is narrow.** Two things:

**react-native-web does not implement `maintainVisibleContentPosition` at all.** Not partially, not with caveats. The string does not appear anywhere in react-native-web 0.21.2. On native, the platform holds your scroll position when you insert content above the viewport, and it does it by measuring real frames rather than trusting any estimate, which is why it cannot be fooled by a bad guess. On web you get none of that, so every list has to hold position itself. This one does, by tracking an item and its offset rather than a scroll position.

**Item positions here cannot go out of order.** Offsets are prefix sums over a Fenwick tree rather than an array of positions that gets partially rebuilt. That rules out a specific failure where a partially corrected position table stops being sorted and the binary search over it returns an item nowhere near the one you asked for. That is not hypothetical, it is [Shopify/flash-list#2307](https://github.com/Shopify/flash-list/issues/2307), where asking for item 250 renders item 333. There is a test in this repo that reproduces that mechanism and shows it cannot happen here.

If you are on native only, and FlashList works for you, use FlashList.

## Props

| Prop | Meaning |
| --- | --- |
| `data` | The array |
| `renderItem` | `({ item, index }) => element` |
| `keyExtractor` | `(item, index) => string`, worth setting |
| `estimatedItemHeight` | A starting guess, corrected by measurement. Default 100 |
| `overscan` | Rows to keep mounted either side of the viewport. Default 3 |
| `onStartReached` | Fires once when the top is reached, rearms when you scroll away |
| `onEndReached` | Same at the bottom |
| `maintainVisiblePosition` | Passes `maintainVisibleContentPosition` to the scroll view. Default true |
| `ListEmptyComponent` | Rendered when `data` is empty |

### Ref

```js
ref.current.scrollToIndex(4823, { align: 'center', animated: true })
ref.current.scrollToEnd()
ref.current.prepend(50)          // older messages arrived at the top
ref.current.getController()      // the layout underneath, if you need it
```

`prepend` is explicit rather than inferred from `data` growing, because only you know which end changed, and guessing wrong is what makes a list jump.

## Using the layout on its own

The positioning is independent of React and is exported if you want to build your own list on it.

```js
import { ListLayout } from 'react-native-virtual-list'

const layout = new ListLayout({ count: 1_000_000, estimate: 72 })

layout.offsetOf(999_999)          // O(log n)
layout.indexAt(41_530_112)        // O(log n)
layout.setHeight(4823, 118)       // O(log n)
layout.visibleRange(offset, viewportHeight, overscan)

const anchor = layout.captureAnchor(scrollOffset)
// heights change, items get prepended, whatever happens
layout.offsetForAnchor(anchor)    // the anchored item has not moved
```

## What is tested

56 automated tests, a manual pass on a physical iOS device, and a browser pass on react-native-web.

**43 unit tests** covering the layout and the controller, including differential fuzzing of the tree against a naive O(n) implementation, the anchor holding its screen position across 40 random measurement trials and 30 prepend trials, and a run at a million items checking that offsets stay ordered, `indexAt` inverts `offsetOf`, and the total does not drift from the sum of the heights.

**13 render tests** driving the real component through `react-test-renderer` with the layout events a host would send: that only the visible rows mount, that a hundred thousand rows still mount fewer than fifteen, that measurement corrects positions, that `scrollToIndex` lands on the right row when nothing has been measured, and that prepending does not move the anchored row.

**A manual pass on a physical iOS device**, covering scrolling, prepending and `scrollToIndex`. That is what the automated tests cannot reach: real scroll momentum and native layout commit ordering.

**A browser pass on react-native-web**, which is the case the library exists for. A real app under Vite with `react-native` aliased to `react-native-web`, 1000 rows of varying height with the estimate deliberately wrong, scrolled into the middle and then prepended 200 rows at a time, four times over, to 2000 rows. A probe reads the real `getBoundingClientRect().top` of a tracked row before and after each prepend, independently of anything the library reports about itself. Every round the scroll position was adjusted by exactly the amount the content grew, and the tracked row held its screen position to the pixel.

That pass is the reason this is 0.1.1 rather than 0.1.0. In 0.1.0 web prepending was broken: the layout maths was right, and the component never wrote the corrected offset back to the scroll view, so the list jumped by the full height of the inserted content. On native the platform hides that, because `maintainVisibleContentPosition` does the correction itself. On web nothing does. The fix applies the correction on web only, since doing it on both would compensate twice.

## Cost

| | 1M items | 5M items |
| --- | --- | --- |
| Build | 11 ms | 52 ms |
| `visibleRange` | 0.84 us | 1.15 us |
| `setHeight` | 0.33 us | 0.29 us |
| Prepend 50 | 0.09 ms | 0.02 ms |
| Index memory | 12 MB | 58 MB |

13 bytes per item slot. At a million items the index is 12 MB, which is usually less than the data being listed.

## What it does not do

**No recycling.** Rows mount and unmount rather than being reused with new props. FlashList's recycling pools are faster for long fast scrolls through uniform rows. This trades that for simpler behaviour and no stale state in reused rows.

**Android has not been run.** iOS is covered on real hardware and web is covered in a browser, but nothing here has been exercised on Android. It should behave like iOS, because both go through the platform's own `maintainVisibleContentPosition`, but that is reasoning rather than evidence.

**No columns, no masonry, no sticky headers.** Single column vertical lists only.

**It cannot make an estimate correct.** The position of a row nobody has rendered is unknown. What is guaranteed is that unknown positions stay consistent and ordered, not that they are right.

## License

MIT
