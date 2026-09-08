import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IDENTITY_COLORS, identityColor } from '../src/shared/colors.ts'

test('按序号取色，与色板逐项对应', () => {
  IDENTITY_COLORS.forEach((c, i) => {
    assert.equal(identityColor(i), c)
  })
})

test('超出色板长度回头复用（取模）', () => {
  const n = IDENTITY_COLORS.length
  assert.equal(identityColor(n), IDENTITY_COLORS[0])
  assert.equal(identityColor(n + 2), IDENTITY_COLORS[2])
})

test('色板不含纯红（红色留给错误态）', () => {
  assert.ok(!IDENTITY_COLORS.some((c) => /^#ff0000$/i.test(c)))
})
