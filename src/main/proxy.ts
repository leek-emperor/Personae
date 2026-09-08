/**
 * 代理输入的解析与规范化。
 *
 * 抽成不依赖任何 Electron 对象的纯函数：
 *   · 用户可能粘进整串 `socks5://user:pass@host:port`，也可能分字段填；
 *     解析规则很容易在改动中悄悄退化，必须能被单测覆盖。
 *   · 决策（怎么解析、生成什么 proxyRules）与副作用（调 session.setProxy）分离。
 *
 * 关键约束：**凭据绝不进 proxyRules**。Chromium 不认 proxyRules 里的
 * `user:pass@`（会被当成 host 的一部分导致解析失败），代理认证必须走
 * `app.on('login')`。所以 buildProxyRules 只输出 scheme://host:port。
 */

/** 支持的代理协议。差别很小，一并支持。 */
export type ProxyScheme = 'http' | 'https' | 'socks5'

export type ParsedProxy = {
  scheme: ProxyScheme
  host: string
  port: number
  username?: string
  password?: string
}

/** 分字段输入（界面直接填），任一可缺省，交给 parse 校验 */
export type ProxyFields = {
  scheme?: string
  host?: string
  port?: string | number
  username?: string
  password?: string
}

const SCHEMES: readonly ProxyScheme[] = ['http', 'https', 'socks5']

function normalizeScheme(raw: string | undefined): ProxyScheme | null {
  const s = (raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/:\/\/$/, '')
    .replace(/:$/, '')
  // socks 常被写成 socks / socks5；统一到 socks5（Chromium 只认 socks5 / socks4）
  if (s === 'socks' || s === 'socks5') return 'socks5'
  if (s === 'http') return 'http'
  if (s === 'https') return 'https'
  return null
}

function normalizePort(raw: string | number | undefined): number | null {
  if (raw === undefined || raw === '') return null
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw).trim(), 10)
  if (!Number.isInteger(n) || n < 1 || n > 65535) return null
  return n
}

/**
 * 解析一整串代理 URL，如 `socks5://user:pass@host:12321`。
 * 返回 null 表示不是可解析的 URL 串（调用方可回退到分字段解析）。
 *
 * 不用 `new URL()`：它对 socks scheme 的 host/port 解析在各 runtime 间不一致，
 * 且会对含特殊字符的凭据做百分号解码，反而引入歧义。这里用显式正则，行为可控。
 */
function parseUrlString(raw: string): ParsedProxy | { error: string } | null {
  const s = raw.trim()
  const m = /^([a-z0-9]+):\/\/(.+)$/i.exec(s)
  if (!m) return null

  const scheme = normalizeScheme(m[1])
  if (!scheme) return { error: `不支持的代理协议「${m[1]}」，仅支持 http / https / socks5` }

  let rest = m[2]
  let username: string | undefined
  let password: string | undefined

  // 凭据部分在最后一个 @ 之前（host 不含 @，密码理论上可能含 @ 也在此之前）
  const at = rest.lastIndexOf('@')
  if (at !== -1) {
    const cred = rest.slice(0, at)
    rest = rest.slice(at + 1)
    const colon = cred.indexOf(':')
    if (colon === -1) {
      username = cred || undefined
    } else {
      username = cred.slice(0, colon) || undefined
      password = cred.slice(colon + 1) || undefined
    }
  }

  // 剩下的是 host:port，去掉可能的尾部路径
  const hostPort = rest.replace(/\/.*$/, '')
  const lastColon = hostPort.lastIndexOf(':')
  if (lastColon === -1) return { error: '代理地址缺少端口，格式应为 host:port' }
  const host = hostPort.slice(0, lastColon).trim()
  const port = normalizePort(hostPort.slice(lastColon + 1))
  if (!host) return { error: '代理地址缺少主机' }
  if (port === null) return { error: '代理端口无效（应为 1–65535）' }

  return { scheme, host, port, username, password }
}

/**
 * 把用户输入解析成结构化代理配置。
 *
 * 接受两种形态：
 *   1. 整串 URL：`{ host: 'socks5://user:pass@host:port' }` 或直接传 raw
 *   2. 分字段：`{ scheme, host, port, username, password }`
 * 若 host 字段本身是个带 scheme 的 URL 串，优先按 URL 解析（用户常整串粘贴）。
 *
 * 返回 `{ error }` 表示输入非法，调用方据此提示用户。
 */
export function parseProxyInput(input: ProxyFields | string): ParsedProxy | { error: string } {
  const fields: ProxyFields = typeof input === 'string' ? { host: input } : input

  // host 里带 :// 说明用户粘了整串，走 URL 解析
  if (fields.host && /:\/\//.test(fields.host)) {
    const r = parseUrlString(fields.host)
    if (r) {
      if ('error' in r) return r
      // 分字段里若另填了账密，以显式字段为准（覆盖 URL 里的）
      return {
        ...r,
        username: fields.username?.trim() || r.username,
        password:
          fields.password !== undefined && fields.password !== '' ? fields.password : r.password
      }
    }
  }

  const scheme = normalizeScheme(fields.scheme) ?? 'http'
  const host = (fields.host ?? '').trim().replace(/^[a-z0-9]+:\/\//i, '')
  const port = normalizePort(fields.port)
  if (!host) return { error: '代理地址缺少主机' }
  if (port === null) return { error: '代理端口无效（应为 1–65535）' }

  const username = fields.username?.trim() || undefined
  const password =
    fields.password !== undefined && fields.password !== '' ? fields.password : undefined
  return { scheme, host, port, username, password }
}

/**
 * 生成 Electron ProxyConfig.proxyRules。
 *
 * **只含 scheme://host:port，不含任何凭据** —— 认证走 app.on('login')。
 * socks5 走 `socks5://`；http/https 都用 `scheme://` 前缀，Chromium 能识别。
 */
export function buildProxyRules(p: Pick<ParsedProxy, 'scheme' | 'host' | 'port'>): string {
  return `${p.scheme}://${p.host}:${p.port}`
}

/** 是否为受支持的协议字符串（界面下拉校验用） */
export function isProxyScheme(s: string): s is ProxyScheme {
  return (SCHEMES as readonly string[]).includes(s)
}
