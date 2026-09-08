import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spliceTomlSection } from '../src/main/toml.ts'

const SERVER = `[mcp_servers.personae]
command = "/app/bin"
args = ["/app/mcp.mjs"]

[mcp_servers.personae.env]
ELECTRON_RUN_AS_NODE = "1"`

test('不含目标段时原样返回', () => {
  const raw = `[mcp_servers.other]\ncommand = "x"\n`
  assert.equal(spliceTomlSection(raw, 'personae', 'REPLACED'), raw)
})

test('删除段时连同 .env 子表一起删掉，不留半截', () => {
  const raw = `${SERVER}\n\n[mcp_servers.other]\ncommand = "x"\n`
  const out = spliceTomlSection(raw, 'personae', null)
  assert.ok(!out.includes('[mcp_servers.personae]'))
  assert.ok(!out.includes('ELECTRON_RUN_AS_NODE'), 'env 子表应被一并删除')
  assert.ok(out.includes('[mcp_servers.other]'), '不相关段应保留')
})

test('替换段时子表不会导致提前截断', () => {
  const raw = `${SERVER}\n\n[other]\nk = 1\n`
  const replacement = `[mcp_servers.personae]\ncommand = "/new"`
  const out = spliceTomlSection(raw, 'personae', replacement)
  assert.ok(out.includes('command = "/new"'))
  // 旧的 env 子表应被替换掉，而不是残留在新段后面
  assert.ok(!out.includes('ELECTRON_RUN_AS_NODE'))
  // 后续不相关段完整保留
  assert.ok(out.includes('[other]\nk = 1'))
})

test('段在文件末尾（其后无其他段）也能删干净', () => {
  const raw = `[other]\nk = 1\n\n${SERVER}\n`
  const out = spliceTomlSection(raw, 'personae', null)
  assert.ok(!out.includes('personae'))
  assert.ok(out.includes('[other]'))
})

test('只删指定 key，同前缀的其他 server 不受影响', () => {
  const raw = `[mcp_servers.personae]\ncommand = "a"\n\n[mcp_servers.personae_old]\ncommand = "b"\n`
  const out = spliceTomlSection(raw, 'personae', null)
  assert.ok(!out.includes('[mcp_servers.personae]'))
  assert.ok(out.includes('[mcp_servers.personae_old]'), '同前缀的不同 key 应保留')
})
