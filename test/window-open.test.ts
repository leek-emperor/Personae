import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyWindowOpen, type WindowOpenInput } from '../src/main/window-open.ts'

/** 造一个默认「用户点击触发的新窗口、拦截器开」的输入，各用例只改关心的字段 */
function input(over: Partial<WindowOpenInput> = {}): WindowOpenInput {
  return {
    url: 'https://example.com/oauth',
    disposition: 'new-window',
    userActivated: true,
    popupBlockerEnabled: true,
    ...over
  }
}

test('非 http(s) 协议一律忽略', () => {
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,x',
    'file:///etc/passwd',
    'about:blank'
  ]) {
    assert.equal(classifyWindowOpen(input({ url })), 'ignore', url)
  }
})

test('target=_blank / 无 features 的普通链接压回同窗', () => {
  for (const disposition of ['foreground-tab', 'background-tab', 'default', 'other'] as const) {
    assert.equal(classifyWindowOpen(input({ disposition })), 'same-window', disposition)
  }
})

test('用户点击触发的新窗口放行为子窗口（OAuth 弹窗）', () => {
  assert.equal(classifyWindowOpen(input({ userActivated: true })), 'allow-child')
})

test('拦截器开启时，非用户激活的新窗口被拦截（广告 / pop-under）', () => {
  assert.equal(classifyWindowOpen(input({ userActivated: false })), 'ignore')
})

test('拦截器关闭时，即使非用户激活也放行', () => {
  assert.equal(
    classifyWindowOpen(input({ userActivated: false, popupBlockerEnabled: false })),
    'allow-child'
  )
})

test('拦截判定只作用于新窗口，不影响普通链接', () => {
  // 非用户激活 + 拦截器开，但这是普通链接 → 仍走同窗，不该被「拦截」成 ignore
  assert.equal(
    classifyWindowOpen(input({ disposition: 'foreground-tab', userActivated: false })),
    'same-window'
  )
})

test('协议判定优先于一切：非 http 的新窗口即便用户激活也忽略', () => {
  assert.equal(classifyWindowOpen(input({ url: 'tel:123', userActivated: true })), 'ignore')
})
