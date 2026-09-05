import { app, WebContents } from 'electron'
import { readFile } from 'fs/promises'
import { join } from 'path'
import http from 'http'

/**
 * CDP 端口管理。
 *
 * 关键事实：--remote-debugging-port 是「浏览器进程级」开关，不是窗口级。
 * 整个 Electron app 只有一个 CDP server，所有 BrowserWindow 都是它下面的 target。
 * 因此这里只开一个端口，用 0 让系统分配（避免和用户机器上其它进程抢 9222）。
 */

let cachedPort: number | null = null

/** 必须在 app.whenReady() 之前调用 */
export function enableCdp(): void {
  // 0 = 由系统分配空闲端口，实际端口写入 userData/DevToolsActivePort
  app.commandLine.appendSwitch('remote-debugging-port', '0')
  // 仅回环地址可访问
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1')
}

/**
 * 读取实际分配到的端口。
 * DevToolsActivePort 文件格式：第一行端口，第二行 browser ws 路径。
 */
export async function discoverCdpPort(timeoutMs = 10_000): Promise<number> {
  if (cachedPort) return cachedPort

  const portFile = join(app.getPath('userData'), 'DevToolsActivePort')
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      const raw = await readFile(portFile, 'utf8')
      const port = Number.parseInt(raw.split('\n')[0]?.trim() ?? '', 10)
      if (Number.isInteger(port) && port > 0) {
        // 确认 HTTP 端点真的起来了（文件写入早于端口 bind 成功）
        if (await probe(port)) {
          cachedPort = port
          return port
        }
      }
    } catch {
      // 文件还没写出来，继续等
    }
    await sleep(150)
  }

  throw new Error(`未能在 ${timeoutMs}ms 内发现 CDP 端口（${portFile}）`)
}

function probe(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/json/version', timeout: 800 },
      (res) => {
        res.resume()
        resolve(res.statusCode === 200)
      }
    )
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
  })
}

/**
 * 拿某个 webContents 对应的 CDP targetId。
 *
 * 用 Target.getTargetInfo 取权威值，而不是靠 url/title 匹配 —— 多个身份可能
 * 打开同一个站点，url/title 完全一样，匹配会串号。
 *
 * 保持 attach 不 detach：反复 attach/detach 会干扰外部 CDP 客户端，
 * 且 detach 后再次取值需要重新握手，没有收益。窗口关闭时会自动释放；用户手动打开该窗口的
 * DevTools 时会被强制 detach（Electron 的既有行为），此时标记注入会失效，
 * 需要重新打开窗口。
 */
export async function getTargetId(wc: WebContents): Promise<string | null> {
  const dbg = wc.debugger
  try {
    if (!dbg.isAttached()) dbg.attach('1.3')
    const res = (await dbg.sendCommand('Target.getTargetInfo')) as {
      targetInfo?: { targetId?: string }
    }
    return res?.targetInfo?.targetId ?? null
  } catch (err) {
    console.error('[cdp] 获取 targetId 失败:', err)
    return null
  }
}

export type CdpTarget = {
  id: string
  type: string
  title: string
  url: string
}

/** 列出当前所有 CDP target（调试/校验用） */
export async function listTargets(): Promise<CdpTarget[]> {
  const port = await discoverCdpPort()
  const body = await httpGet(port, '/json/list')
  return JSON.parse(body) as CdpTarget[]
}

function httpGet(port: number, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path, timeout: 3000 }, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (c) => (data += c))
      res.on('end', () => resolve(data))
    })
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('CDP HTTP 超时'))
    })
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
