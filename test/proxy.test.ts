import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseProxyInput, buildProxyRules, isProxyScheme } from '../src/main/proxy.ts'

function ok(r: ReturnType<typeof parseProxyInput>): Extract<typeof r, { host: string }> {
  assert.ok(!('error' in r), `unexpected error: ${'error' in r ? r.error : ''}`)
  return r as never
}

test('解析整串 socks5 URL（带认证）', () => {
  const r = ok(parseProxyInput('socks5://user:pass@gate.example.com:12321'))
  assert.equal(r.scheme, 'socks5')
  assert.equal(r.host, 'gate.example.com')
  assert.equal(r.port, 12321)
  assert.equal(r.username, 'user')
  assert.equal(r.password, 'pass')
})

test('解析整串 http URL（无认证）', () => {
  const r = ok(parseProxyInput('http://p.example.io:8080'))
  assert.equal(r.scheme, 'http')
  assert.equal(r.host, 'p.example.io')
  assert.equal(r.port, 8080)
  assert.equal(r.username, undefined)
  assert.equal(r.password, undefined)
})

test('分字段解析', () => {
  const r = ok(
    parseProxyInput({
      scheme: 'https',
      host: 'h.example.com',
      port: '443',
      username: 'u',
      password: 'p'
    })
  )
  assert.equal(r.scheme, 'https')
  assert.equal(r.host, 'h.example.com')
  assert.equal(r.port, 443)
  assert.equal(r.username, 'u')
  assert.equal(r.password, 'p')
})

test('socks / socks5 归一化为 socks5', () => {
  assert.equal(ok(parseProxyInput({ scheme: 'socks', host: 'x', port: 1 })).scheme, 'socks5')
  assert.equal(ok(parseProxyInput({ scheme: 'SOCKS5', host: 'x', port: 1 })).scheme, 'socks5')
})

test('scheme 缺省时默认 http', () => {
  assert.equal(ok(parseProxyInput({ host: 'x', port: 3128 })).scheme, 'http')
})

test('分字段账密覆盖 URL 串里的账密', () => {
  const r = ok(
    parseProxyInput({ host: 'socks5://old:oldpass@h:1', username: 'new', password: 'newpass' })
  )
  assert.equal(r.username, 'new')
  assert.equal(r.password, 'newpass')
})

test('非法输入返回 error', () => {
  assert.ok('error' in parseProxyInput({ host: 'h' })) // 缺端口
  assert.ok('error' in parseProxyInput({ host: '', port: 80 })) // 缺主机
  assert.ok('error' in parseProxyInput({ host: 'h', port: 70000 })) // 端口越界
  assert.ok('error' in parseProxyInput({ host: 'h', port: 0 }))
  assert.ok('error' in parseProxyInput('ftp://h:21')) // 不支持的协议
})

test('buildProxyRules 只输出 scheme://host:port，绝不含凭据', () => {
  const rules = buildProxyRules({ scheme: 'socks5', host: 'gate.example.com', port: 12321 })
  assert.equal(rules, 'socks5://gate.example.com:12321')
  assert.ok(!/user|pass|@/.test(rules), '凭据不得出现在 proxyRules 中')
})

test('带认证解析后，rules 仍不含凭据', () => {
  const r = ok(parseProxyInput('http://secret:hunter2@h.example.com:8080'))
  const rules = buildProxyRules(r)
  assert.equal(rules, 'http://h.example.com:8080')
  assert.ok(!rules.includes('secret') && !rules.includes('hunter2'))
})

test('isProxyScheme', () => {
  assert.ok(isProxyScheme('http'))
  assert.ok(isProxyScheme('https'))
  assert.ok(isProxyScheme('socks5'))
  assert.ok(!isProxyScheme('socks4'))
  assert.ok(!isProxyScheme('ftp'))
})
