import { app } from 'electron'
import http from 'http'
import { join } from 'path'
import { existsSync } from 'fs'
import { writeFile, mkdir } from 'fs/promises'
import { identityManager } from './identity'
import { discoverCdpPort, listTargets } from './cdp'

/**
 * Agent 接入层。
 *
 * 职责：把「身份 → CDP target」这层只有主进程知道的映射，暴露给外部 agent
 * （codex / claude code）。agent-browser 本身不认识 partition，必须靠这个
 * 映射才能定位到正确的身份窗口。
 *
 * 同时把捆绑的 agent-browser 路径、推荐命令一并给出，避免 agent 猜。
 */

const HOST = '127.0.0.1'
let server: http.Server | null = null
let boundPort = 0

/** 捆绑的 agent-browser 二进制路径；开发期回落到 PATH 上的可执行文件 */
export function agentBrowserPath(): string {
  const platformDir = `${process.platform}-${process.arch}`
  const exe = process.platform === 'win32' ? 'agent-browser.exe' : 'agent-browser'

  // 打包后同时兼容两种位置：
  //   · Resources/bin/…            ← extraResources（当前配置，推荐）
  //   · app.asar.unpacked/resources/bin/… ← 仅靠 asarUnpack 时的落点
  // 两者路径不同，只认一个会在改配置后静默失效。
  const candidates = app.isPackaged
    ? [
        join(process.resourcesPath, 'bin', platformDir, exe),
        join(process.resourcesPath, 'bin', exe),
        join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'bin', platformDir, exe),
        join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'bin', exe)
      ]
    : [
        join(app.getAppPath(), 'resources', 'bin', platformDir, exe),
        join(app.getAppPath(), 'resources', 'bin', exe)
      ]

  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  // 开发期兜底：用 PATH 上的
  return exe
}

/**
 * 捆绑的官方 skill 目录（来自 agent-browser 的 skill-data/ + skills/）。
 *
 * agent-browser 有 `skills get <name>` 子命令，用来输出**与当前二进制版本匹配**的
 * 操作说明。这一点很重要：它的 SKILL.md 刻意不写命令语法，就是为了避免 agent
 * 凭过时文档猜 flag（实测本机 0.25.4 就没有官方 electron skill 里提到的
 * `tab --url` 和 `--pin-tab`）。
 *
 * 注意：agent-browser 默认会从二进制所在位置向上查找 `skills/` 目录，
 * 可能撞到无关项目的同名目录，所以必须显式传 AGENT_BROWSER_SKILLS_DIR。
 */
export function skillsDir(): string | null {
  // 同 agentBrowserPath：打包后兼容 extraResources 与 asarUnpack 两种落点
  const candidates = app.isPackaged
    ? [
        join(process.resourcesPath, 'skills'),
        join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'skills')
      ]
    : [join(app.getAppPath(), 'resources', 'skills')]

  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}

async function buildInfo(): Promise<Record<string, unknown>> {
  let cdpPort: number | null = null
  let cdpError: string | null = null
  try {
    cdpPort = await discoverCdpPort(3000)
  } catch (err) {
    cdpError = err instanceof Error ? err.message : String(err)
  }

  const bin = agentBrowserPath()
  const identities = identityManager.mapping()
  const skills = skillsDir()

  return {
    app: app.getName(),
    cdpPort,
    cdpError,
    agentBrowserPath: bin,
    // 判断是否用的是捆绑二进制而非 PATH 上的。
    // 必须忽略大小写：开发期路径是 resources/bin/…，打包后是
    // Contents/Resources/bin/…（大写 R），写死小写会在打包版误报 false。
    // 只有回落到 PATH 时 bin 才是裸的 "agent-browser"（不含分隔符）。
    agentBrowserBundled: /[/\\]/.test(bin),
    skillsDir: skills,
    identities,
    // 明确告诉 agent 该怎么用，避免它按通用浏览器思路操作
    usage: {
      note: 'Each identity is an isolated partition backed by exactly one content view (CDP type=page). Several identities often have the same site open, so their title and url are identical — always locate a view by the targetId given below, never by title, url or index.',
      steps: [
        '1. GET /identities to list identities and their targetId',
        '2. <bin> --session <sessionName> --cdp <cdpPort> --no-pin-tab batch "tab <targetId>" "snapshot -i"',
        '3. click / fill etc. use the @eN refs returned above (a ref is only valid inside the same batch)'
      ],
      warning:
        'Two things to watch: (1) --no-pin-tab is required — --pin-tab triggers Target.createTarget, which Electron does not support, and the state is sticky enough to poison the session permanently; (2) an @eN ref is only valid inside a single agent-browser process, so snapshot and the actions using it must go in the same batch. Prefer the bundled MCP server (scripts/mcp-server.mjs), which already handles all of this.',
      examples: identities
        .filter((i) => i.isOpen && i.targetId)
        .map((i) => ({
          identity: i.name,
          partition: i.partition,
          targetId: i.targetId,
          snapshot: `"${bin}" --session ${i.sessionName} --cdp ${cdpPort ?? '<port>'} --no-pin-tab batch "tab ${i.targetId}" "snapshot -i"`,
          getUrl: `"${bin}" --session ${i.sessionName} --cdp ${cdpPort ?? '<port>'} --no-pin-tab batch "tab ${i.targetId}" "get url"`
        }))
    }
  }
}

function sendJson(res: http.ServerResponse, code: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  })
  res.end(payload)
}

export async function startAgentBridge(): Promise<number> {
  if (server) return boundPort

  server = http.createServer((req, res) => {
    // 仅回环访问；拒绝带 Host 头指向外部的请求
    const url = new URL(req.url ?? '/', `http://${HOST}`)

    void (async () => {
      try {
        switch (url.pathname) {
          case '/':
          case '/info':
            sendJson(res, 200, await buildInfo())
            return

          case '/identities':
            sendJson(res, 200, { identities: identityManager.mapping() })
            return

          case '/targets': {
            // 原始 CDP target 列表，用于核对映射是否正确
            try {
              sendJson(res, 200, { targets: await listTargets() })
            } catch (err) {
              sendJson(res, 503, {
                error: err instanceof Error ? err.message : String(err)
              })
            }
            return
          }

          case '/open': {
            const id = url.searchParams.get('id')
            if (!id) {
              sendJson(res, 400, { error: 'missing id parameter' })
              return
            }
            try {
              const state = await identityManager.openWindow(id)
              sendJson(res, 200, { ok: true, identity: state })
            } catch (err) {
              sendJson(res, 404, {
                error: err instanceof Error ? err.message : String(err)
              })
            }
            return
          }

          default:
            sendJson(res, 404, {
              error: 'not found',
              routes: ['/info', '/identities', '/targets', '/open?id=<id>']
            })
        }
      } catch (err) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
      }
    })()
  })

  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject)
    // 端口 0：系统分配，避免固定端口冲突
    server!.listen(0, HOST, () => resolve())
  })

  const addr = server.address()
  boundPort = typeof addr === 'object' && addr ? addr.port : 0

  // 把接入信息写到固定位置，让 codex / MCP 脚本能发现本次运行的端口
  await writeBridgeFile()

  console.log(`[agent-bridge] http://${HOST}:${boundPort}/info`)
  return boundPort
}

/** 固定路径的发现文件：外部进程据此找到本次运行的 bridge 端口 */
export function bridgeFilePath(): string {
  return join(app.getPath('userData'), 'agent-bridge.json')
}

async function writeBridgeFile(): Promise<void> {
  try {
    const file = bridgeFilePath()
    await mkdir(join(file, '..'), { recursive: true })
    let cdpPort: number | null = null
    try {
      cdpPort = await discoverCdpPort(3000)
    } catch {
      /* 端口还没就绪，info 接口里会再报 */
    }
    await writeFile(
      file,
      JSON.stringify(
        {
          bridgeUrl: `http://${HOST}:${boundPort}`,
          cdpPort,
          agentBrowserPath: agentBrowserPath(),
          skillsDir: skillsDir(),
          pid: process.pid,
          updatedAt: new Date().toISOString()
        },
        null,
        2
      )
    )
  } catch (err) {
    console.error('[agent-bridge] 写发现文件失败:', err)
  }
}

/** 身份状态变化时刷新发现文件里的 cdpPort（首次可能尚未就绪） */
export function refreshBridgeFile(): void {
  void writeBridgeFile()
}

export function bridgePort(): number {
  return boundPort
}

export function stopAgentBridge(): void {
  server?.close()
  server = null
}
