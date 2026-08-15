# virtual-list-layout

The positioning engine for a virtualized list, for datasets in the millions, where item heights are not known until they render.

No dependencies. No framework. It does not render anything, it works out where everything is.

## What this is not for

Read this first, because it rules out the most common reason people look for a library like this.

**If you are on React Native and your list jumps when you prepend, you do not need this.** The platform already fixes that, and it fixes it better than any JavaScript layer can. `ScrollView`'s `maintainVisibleContentPosition` records the frame of the first visible child before a mount commit and shifts `contentOffset` by the difference afterwards. It never consults an estimate, so a wrong estimate cannot break it: a bad spacer height displaces the anchor view, and displacing the anchor view is exactly what the native code measures and corrects, in the same commit. It is implemented on iOS old architecture, iOS Fabric and Android since RN 0.72, and the iOS implementation is explicitly aware of `inverted` lists.

The short version is that estimate error changes content height. It does not change visible position. Anything claiming otherwise about React Native prepends, including earlier drafts of this README, is wrong.

FlashList enables `maintainVisibleContentPosition` by default and closed its prepend jump report in v2.3.1. Legend List routes prepends to the same native prop with `maintainVisibleContentPosition={{ data: true }}`. Use those.

## What it is for

What the platform does not fix is the arithmetic on the JavaScript side, because native compensation only applies to items that are actually mounted. Positions for items that have never rendered come from your own layout model, and that model can be wrong in ways that are worse than imprecise.

[Shopify/flash-list#2307](https://github.com/Shopify/flash-list/issues/2307), open and P1, is the sharp example. Unmeasured items are positioned from a rolling average seeded at 200px, so item 250 is placed at 50,000px when it belongs at 75,000px. When the items above it measure, their positions grow, but the items below are still placed from the stale average, so the layout table steps *backwards* at the boundary. A binary search over an array that is no longer sorted does not return a slightly wrong answer, it returns an arbitrary one. The reporter asks for item 250 and gets 333.

That is the class of bug this removes, and it removes it structurally rather than by fixing a case.

**Offsets are prefix sums, not a table.** Positions come from a Fenwick tree over heights rather than a materialized array of offsets. Heights are non negative, so the sequence of offsets is non decreasing by construction. There is no partially rebuilt table that can fall out of order, so the search over it cannot be misled. Measuring an item is `O(log n)` and never triggers a rebuild, which also removes the dense per index layout array that is the practical ceiling on dataset size.

**Position is an anchor, not an offset.** An offset is derived from the heights known when it was read, and those heights change. Storing an item plus how far its top sits above the viewport survives both measurement and insertion. On React Native this mostly duplicates what the platform already guarantees, and it is here for the cases the platform does not cover: react-native-web, which has no native `maintainVisibleContentPosition` at all, and Android before RN 0.72.

It also cannot make an estimate correct. Nothing can. The offset of an item nobody has ever rendered is unknown, and this library guarantees that unknown positions stay *consistent*, not that they are right.

## Install

```sh
npm install virtual-list-layout
```

## Use

```js
import { ListController } from 'virtual-list-layout'

const list = new ListController({
  count: messages.length,
  estimate: 72,          // or (index) => number
  viewportHeight: 800,
  overscan: 3,
})

// The user scrolled.
list.onScroll(event.contentOffset.y)

// An item rendered and reported its real height.
list.measure(index, height)

// Older messages arrived at the top. Nothing moves on screen.
list.prepend(50)

// What to render this frame.
const { items, totalHeight, scrollOffset } = list.frame()
//    items: [{ index, offset, height, measured }, ...]
```

`frame()` gives you the items to mount and where to put them. Rendering is yours.

### Lower level

`ListLayout` is the geometry on its own, if you are building your own scroll state.

```js
import { ListLayout } from 'virtual-list-layout'

const layout = new ListLayout({ count: 1_000_000, estimate: 72 })

layout.offsetOf(999_999)          // O(log n)
layout.indexAt(41_530_112)        // O(log n)
layout.setHeight(4823, 118)       // O(log n)
layout.totalHeight()
layout.visibleRange(offset, viewportHeight, overscan)
layout.offsetForIndex(4823, { align: 'center', viewportHeight })

const anchor = layout.captureAnchor(scrollOffset)
// ...anything at all happens to heights, and items get prepended...
layout.offsetForAnchor(anchor)    // the anchored item has not moved
```

## What is proven

The whole library is pure, so the guarantees are tested rather than asserted. 43 tests, no device involved.

| Property | How it is checked |
| --- | --- |
| Prefix sums and searches are correct | Differential fuzzing against a naive O(n) implementation, 2000 random updates |
| Offsets never step backwards | Measured in every order, including adversarial ones |
| `indexAt` inverts `offsetOf` | Every index across a list of a million |
| The Flash List 2307 mechanism cannot occur | The reported mechanism is reproduced, then shown impossible here |
| The anchored item never moves | 40 random trials, measurements above, below and on the anchor |
| Prepending never moves the anchor | 30 random trials, including buffer reallocation |
| Totals do not drift | Sum of a million Float32 heights equals the tree total, exactly |

## Cost

Measured on an M-series Mac, single thread.

| | 1M items | 5M items |
| --- | --- | --- |
| Build | 11 ms | 52 ms |
| `offsetOf` | 0.19 us | 0.23 us |
| `indexAt` | 0.42 us | 0.79 us |
| `visibleRange` | 0.84 us | 1.15 us |
| `setHeight` | 0.33 us | 0.29 us |
| Prepend 50 | 0.09 ms | 0.02 ms |
| Index memory | 12 MB | 58 MB |

A frame budget at 60fps is 16.7 ms. `visibleRange` at five million items uses about 0.007 percent of it.

Memory is 13 bytes per item slot: a Float32 height, a Float64 tree node, and a measured flag. At a million items the index costs 12 MB, which is almost always less than the data being listed.

## What it does not do

**It does not render.** There is no component here. It tells you which items belong on screen and where, and you mount them.

**It does not measure.** Heights come from your renderer through `measure(index, height)`. What it guarantees is that nothing jumps when they arrive.

**It cannot fix a renderer that fights it.** On React Native the scroll view has its own opinions, notably `maintainVisibleContentPosition`, and a binding that sets a scroll offset while the platform is also adjusting one will still glitch. The engine being correct is necessary, not sufficient.

**Heights must be non negative and finite.** Anything else throws rather than corrupting the tree.

## License

MIT
