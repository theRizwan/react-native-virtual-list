import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SumTree } from '../src/sum-tree.js'

/** Deterministic PRNG so a failure is reproducible from the seed alone. */
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

/** The obvious O(n) implementation, used as the thing to disagree with. */
class NaiveSums {
  constructor(capacity) {
    this.values = new Float64Array(capacity)
  }
  add(i, delta) {
    this.values[i] += delta
  }
  prefix(i) {
    let sum = 0
    for (let k = 0; k < i; k += 1) sum += this.values[k]
    return sum
  }
  lowerBound(target) {
    let sum = 0
    let pos = 0
    while (pos < this.values.length && sum + this.values[pos] <= target) {
      sum += this.values[pos]
      pos += 1
    }
    return pos
  }
}

test('prefix sums match a naive implementation under random updates', () => {
  const size = 200
  const tree = new SumTree(size)
  const naive = new NaiveSums(size)
  const random = rng(1234)

  for (let round = 0; round < 2000; round += 1) {
    const i = Math.floor(random() * size)
    const delta = Math.round(random() * 200) - 100
    tree.add(i, delta)
    naive.add(i, delta)
  }

  for (let i = 0; i <= size; i += 1) {
    assert.equal(tree.prefix(i), naive.prefix(i), `prefix disagreed at ${i}`)
  }
})

test('lowerBound matches a naive scan for every reachable target', () => {
  const size = 64
  const tree = new SumTree(size)
  const naive = new NaiveSums(size)
  const random = rng(99)

  for (let i = 0; i < size; i += 1) {
    const value = 1 + Math.floor(random() * 50)
    tree.add(i, value)
    naive.add(i, value)
  }

  const total = naive.prefix(size)
  for (let target = 0; target <= total; target += 1) {
    assert.equal(tree.lowerBound(target), naive.lowerBound(target), `lowerBound disagreed at target ${target}`)
  }
})

test('rebuild produces the same tree as repeated adds', () => {
  const size = 300
  const random = rng(7)
  const values = new Float64Array(size)
  for (let i = 0; i < size; i += 1) values[i] = Math.round(random() * 100)

  const built = new SumTree(size)
  built.rebuild(values)

  const added = new SumTree(size)
  for (let i = 0; i < size; i += 1) added.add(i, values[i])

  for (let i = 0; i <= size; i += 1) {
    assert.equal(built.prefix(i), added.prefix(i), `rebuild disagreed at ${i}`)
  }
})

test('rebuild clears whatever was there before', () => {
  const tree = new SumTree(16)
  for (let i = 0; i < 16; i += 1) tree.add(i, 1000)
  tree.rebuild(new Float64Array(16))
  assert.equal(tree.total(), 0)
})

test('capacities that are not powers of two still descend correctly', () => {
  // The descent starts at the highest power of two below capacity, so sizes
  // either side of a power of two are where an off by one would show up.
  for (const size of [1, 2, 3, 7, 8, 9, 15, 16, 17, 31, 33, 63, 65]) {
    const tree = new SumTree(size)
    const naive = new NaiveSums(size)
    for (let i = 0; i < size; i += 1) {
      tree.add(i, 10)
      naive.add(i, 10)
    }
    assert.equal(tree.total(), size * 10, `total wrong at capacity ${size}`)
    for (let target = 0; target <= size * 10; target += 5) {
      assert.equal(tree.lowerBound(target), naive.lowerBound(target), `capacity ${size}, target ${target}`)
    }
  }
})

test('an empty tree answers without blowing up', () => {
  const tree = new SumTree(0)
  assert.equal(tree.total(), 0)
  assert.equal(tree.prefix(0), 0)
  assert.equal(tree.lowerBound(0), 0)
})

test('adding zero is a no op rather than a walk up the tree', () => {
  const tree = new SumTree(8)
  tree.add(3, 0)
  assert.equal(tree.total(), 0)
})
