import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeInput } from '../src/main/url-input.ts'

test('带协议的输入原样返回', () => {
  assert.equal(normalizeInput('https://example.com'), 'https://example.com')
  assert.equal(normalizeInput('http://example.com/x?y=1'), 'http://example.com/x?y=1')
  assert.equal(normalizeInput('  https://example.com  '), 'https://example.com')
})

test('localhost / 127.0.0.1 补 http', () => {
  assert.equal(normalizeInput('localhost:3000'), 'http://localhost:3000')
  assert.equal(normalizeInput('127.0.0.1'), 'http://127.0.0.1')
  assert.equal(normalizeInput('localhost/path'), 'http://localhost/path')
})

test('形似域名补 https', () => {
  assert.equal(normalizeInput('example.com'), 'https://example.com')
  assert.equal(normalizeInput('sub.example.co.uk/path'), 'https://sub.example.co.uk/path')
  assert.equal(normalizeInput('example.com:8080'), 'https://example.com:8080')
})

test('不带协议的 https 意图不被降级为 http', () => {
  // 域名一律补 https，绝不回落 http
  assert.ok(normalizeInput('github.com').startsWith('https://'))
})

test('其余当作搜索词', () => {
  assert.equal(normalizeInput('hello world'), 'https://www.baidu.com/s?wd=hello%20world')
  assert.equal(
    normalizeInput('多身份浏览器'),
    `https://www.baidu.com/s?wd=${encodeURIComponent('多身份浏览器')}`
  )
})

test('含空格即便有点也当搜索词（不是合法域名）', () => {
  assert.ok(normalizeInput('foo bar.baz').startsWith('https://www.baidu.com/s?wd='))
})
