import { BrowserWindow, WebContentsView, session, app, ipcMain } from 'electron'
import { writeFile, readFile, mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import { is } from '@electron-toolkit/utils'
import { getTargetId } from './cdp'
import { identityColor } from '../shared/colors'

export const DEFAULT_HOME = 'https://www.baidu.com'

/** 顶栏高度，与 chrome.html 里的 --h 保持一致 */
const CHROME_HEIGHT = 44

export type Identity = {
  /** 稳定 id，作为 partition 名与 agent-browser session 名的基础 */
  id: string
  name: string
  homeUrl: string
  createdAt: number
}

export type IdentityState = Identity & {
  partition: string
  isOpen: boolean
  /** CDP targetId，窗口打开后才有；窗口重建会变 */
  targetId: string | null
  currentUrl: string | null
  title: string | null
}

type Listener = () => void

/**
 * 身份（partition）管理器。
 *
 * 设计约束（决定了 agent-browser 能不能可靠指定身份）：
 *   1. 一个身份 = 一个 persist: partition = 一个 BrowserWindow，严格一对一
 *   2. 所有跳转都拦在本窗口内，不产生新 target、不外溢到系统浏览器
 *   3. partition ↔ targetId 映射由主进程维护 —— CDP 侧看不到 partition 概念，
 *      这层映射是外部 agent 能定位身份的唯一依据
 */
class IdentityManager {
  private identities = new Map<string, Identity>()
  private windows = new Map<string, BrowserWindow>()
  /** 顶栏视图（本地 chrome.html） */
  private chromes = new Map<string, WebContentsView>()
  /** 内容视图（第三方网页，partition 生效处；agent 操作的就是它） */
  private contents = new Map<string, WebContentsView>()
  /** 每个身份的状态推送函数 */
  private pushers = new Map<string, () => void>()
  private targetIds = new Map<string, string>()
  private listeners = new Set<Listener>()
  private storePath = join(app.getPath('userData'), 'identities.json')

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.storePath, 'utf8')
      const list = JSON.parse(raw) as Identity[]
      for (const it of list) this.identities.set(it.id, it)
    } catch {
      // 首次启动，无存档
    }
  }

  private async persist(): Promise<void> {
    try {
      await mkdir(dirname(this.storePath), { recursive: true })
      await writeFile(this.storePath, JSON.stringify([...this.identities.values()], null, 2))
    } catch (err) {
      console.error('[identity] 持久化失败:', err)
    }
  }

  onChange(fn: Listener): void {
    this.listeners.add(fn)
  }

  private emit(): void {
    for (const fn of this.listeners) {
      try {
        fn()
      } catch (err) {
        console.error('[identity] listener 报错:', err)
      }
    }
  }

  partitionOf(id: string): string {
    return `persist:identity_${id}`
  }

  /** agent-browser 的 --session 名，与身份一一对应 */
  sessionNameOf(id: string): string {
    return `identity_${id}`
  }

  list(): IdentityState[] {
    return [...this.identities.values()]
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((it) => {
        const win = this.windows.get(it.id)
        const alive = !!win && !win.isDestroyed()
        // url / title 必须读内容视图而非外壳窗口 —— 外壳本身不加载远端内容
        const cwc = this.contents.get(it.id)?.webContents
        const contentAlive = alive && !!cwc && !cwc.isDestroyed()
        return {
          ...it,
          partition: this.partitionOf(it.id),
          isOpen: alive,
          targetId: this.targetIds.get(it.id) ?? null,
          currentUrl: contentAlive ? cwc.getURL() : null,
          title: contentAlive ? cwc.getTitle() : null
        }
      })
  }

  async add(name: string, homeUrl = DEFAULT_HOME): Promise<IdentityState> {
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const identity: Identity = {
      id,
      name: name.trim() || `身份 ${this.identities.size + 1}`,
      homeUrl: homeUrl.trim() || DEFAULT_HOME,
      createdAt: Date.now()
    }
    this.identities.set(id, identity)
    await this.persist()
    this.emit()
    return this.list().find((x) => x.id === id)!
  }

  async remove(id: string): Promise<void> {
    this.closeWindow(id)
    this.identities.delete(id)
    this.targetIds.delete(id)
    await this.persist()
    this.emit()
    // 身份色按列表序号取，删掉靠前的一个会让后面所有身份的颜色前移。
    // 主界面靠 emit 重渲染就够了，但各窗口顶栏是 push 模式，
    // 不主动重推的话色点会停在旧颜色，和主界面对不上。
    this.pushAll()
  }

  /** 重推所有已打开窗口的顶栏状态。用于身份集合发生变化后同步派生信息（如身份色）。 */
  private pushAll(): void {
    for (const push of this.pushers.values()) push()
  }

  /**
   * 打开（或聚焦）该身份的窗口。
   * 返回时 targetId 已解析完成，保证调用方拿到的映射可直接给 agent 用。
   */
  async openWindow(id: string): Promise<IdentityState> {
    const identity = this.identities.get(id)
    if (!identity) throw new Error(`身份不存在: ${id}`)

    const existing = this.windows.get(id)
    if (existing && !existing.isDestroyed()) {
      existing.show()
      existing.focus()
      return this.list().find((x) => x.id === id)!
    }

    const partition = this.partitionOf(id)
    // 显式先建 session，确保 partition 在 window 创建前就存在
    const sess = session.fromPartition(partition)
    void sess

    // ── 窗口结构：顶栏 + 内容区 ────────────────────────────────────
    // 用 WebContentsView（Electron 30+ 的官方方案）而不是 <webview> 标签：
    //   · <webview> 官方已不推荐，且 agent-browser 连 webview target 时会报
    //     "No page found"（它假设连接解析到 page 级 target）
    //   · WebContentsView 的内容区就是一个独立的 type=page target，
    //     agent-browser 可以正常操作，「一身份一 target」的前提得以保持
    //
    // 顶栏是本地 chrome.html，内容区加载第三方网页，两者进程隔离。
    const win = new BrowserWindow({
      width: 1180,
      height: 820,
      title: `${identity.name} — ${partition}`,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#2b2d31',
      webPreferences: {
        // 外壳窗口本身不加载远端内容，只做容器
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    // 顶栏：本地页面 + 专用 preload
    const chrome = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/chrome.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    // 内容区：身份 partition 生效在这里，且刻意不给 preload
    const content = new WebContentsView({
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })

    win.contentView.addChildView(chrome)
    win.contentView.addChildView(content)

    // 外壳窗口自身必须加载点东西，并且必须有非空 title。
    //
    // 原因（实测踩到）：改成 WebContentsView 结构后外壳不再 loadURL，
    // 它在 CDP 里就成了一个 url 和 title 全空的 page target。
    // agent-browser 遍历 tab 时 attach 到这种空 target 会直接挂住
    // （`tab list` 无响应、超时也不返回），导致身份定位失败。
    //
    // 用 about:blank 而非 data:text/html —— data URL 里的中文会被按 latin-1
    // 解读成乱码（实测 "账号B" 显示为 "è´¦å·B"），title 不可读。
    //
    // 绑在 did-finish-load 上而不是 loadURL().then()：后者只在首次加载后跑一次，
    // 实测存在竞态 —— 有身份的外壳 title 会停在 "about:blank"。
    // 事件方式对每次加载都生效，且不依赖 promise 时序。
    const shellTitle = `[shell] ${identity.name}`
    const setShellTitle = (): void => {
      if (win.isDestroyed()) return
      // setTitle 对 BrowserWindow 直接有效，且不需要等 JS 执行
      win.setTitle(shellTitle)
      void win.webContents
        .executeJavaScript(`document.title = ${JSON.stringify(shellTitle)}`)
        .catch(() => {
          /* 外壳已销毁或页面尚不可执行脚本，setTitle 已兜底 */
        })
    }
    win.webContents.on('did-finish-load', setShellTitle)
    // 页面标题被外部改动时也拉回来，避免退化成空 title
    win.webContents.on('page-title-updated', (e) => {
      if (win.isDestroyed()) return
      if (win.webContents.getTitle() !== shellTitle) {
        e.preventDefault()
        setShellTitle()
      }
    })
    // 立刻同步设一次，不等任何事件。
    // 必要性（实测）：about:blank 加载极快，did-finish-load 可能在上面注册
    // 完成之前就已经触发过，导致该身份的外壳 title 永远停在 "about:blank"。
    // 现象是并发打开多个身份时，后打开的那个 title 不对。
    win.setTitle(shellTitle)
    // 加载完成后再补一次：loadURL 会把 title 重置为 URL 本身
    void win.webContents.loadURL('about:blank').then(setShellTitle, setShellTitle)

    const layout = (): void => {
      if (win.isDestroyed()) return
      const { width, height } = win.getContentBounds()
      chrome.setBounds({ x: 0, y: 0, width, height: CHROME_HEIGHT })
      content.setBounds({
        x: 0,
        y: CHROME_HEIGHT,
        width,
        height: Math.max(0, height - CHROME_HEIGHT)
      })
    }
    layout()
    win.on('resize', layout)

    this.windows.set(id, win)
    this.chromes.set(id, chrome)
    this.contents.set(id, content)

    // ── 约束 2：把跳转全部限制在内容区之内 ─────────────────────────
    // target="_blank" / window.open 默认会新建 target 或甩给系统浏览器，
    // 两者都会破坏「一身份一 target」的前提，所以一律改为本视图导航。
    content.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) {
        void content.webContents.loadURL(url)
      } else {
        console.warn(`[identity:${id}] 忽略非 http(s) 跳转: ${url}`)
      }
      return { action: 'deny' }
    })

    content.webContents.on('did-create-window', (child) => {
      console.warn(`[identity:${id}] 出现子窗口，已关闭以维持单 target`)
      child.close()
    })

    // ── 顶栏状态同步 ──────────────────────────────────────────────
    const pushState = (): void => {
      if (win.isDestroyed() || chrome.webContents.isDestroyed()) return
      const wc = content.webContents
      chrome.webContents.send('chrome:state', {
        url: wc.getURL() || null,
        title: wc.getTitle() || null,
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
        loading: wc.isLoading(),
        identityName: identity.name,
        // 每次推送时重算序号：中途删掉别的身份后颜色要跟着主界面一起变，
        // 缓存下来反而会和列表不一致。
        identityColor: identityColor([...this.identities.keys()].indexOf(id)),
        partition
      })
    }
    this.pushers.set(id, pushState)

    const notify = (): void => {
      pushState()
      this.emit()
    }
    content.webContents.on('did-navigate', notify)
    content.webContents.on('did-navigate-in-page', notify)
    content.webContents.on('page-title-updated', notify)
    content.webContents.on('did-start-loading', pushState)
    content.webContents.on('did-stop-loading', notify)
    // 窗口标题跟随内容页，便于用户在 Dock / 窗口列表里区分身份
    content.webContents.on('page-title-updated', (_e, title) => {
      if (!win.isDestroyed()) win.setTitle(`${identity.name} — ${title}`)
    })

    win.on('closed', () => {
      this.windows.delete(id)
      this.chromes.delete(id)
      this.contents.delete(id)
      this.pushers.delete(id)
      this.targetIds.delete(id)
      this.emit()
    })

    win.once('ready-to-show', () => win.show())

    // 顶栏与内容并行加载
    const chromeHtml =
      is.dev && process.env['ELECTRON_RENDERER_URL']
        ? `${process.env['ELECTRON_RENDERER_URL']}/chrome.html`
        : join(__dirname, '../renderer/chrome.html')

    await Promise.all([
      chromeHtml.startsWith('http')
        ? chrome.webContents.loadURL(chromeHtml)
        : chrome.webContents.loadFile(chromeHtml),
      content.webContents.loadURL(identity.homeUrl)
    ])

    // 顶栏 title 带上身份名，便于在 CDP target 列表里区分是哪个身份的框架页
    // （否则多身份的顶栏 title 全是 "导航栏"，排查时无法分辨）。
    // 同时绑 did-finish-load：并发打开多身份时单次调用可能赶在加载完成前，
    // 导致 title 停在 "chrome.html"。
    const chromeTitle = `[chrome] ${identity.name}`
    const setChromeTitle = (): void => {
      if (chrome.webContents.isDestroyed()) return
      void chrome.webContents
        .executeJavaScript(`document.title = ${JSON.stringify(chromeTitle)}`)
        .catch(() => {
          /* 顶栏已销毁，忽略 */
        })
    }
    chrome.webContents.on('did-finish-load', setChromeTitle)
    setChromeTitle()

    pushState()

    // 解析并登记 targetId —— 这是 agent 定位身份的关键。
    // 注意用 content 而不是 win：agent 要操作的是内容页，不是顶栏。
    const targetId = await getTargetId(content.webContents)
    if (targetId) {
      this.targetIds.set(id, targetId)
    } else {
      console.error(`[identity:${id}] targetId 解析失败，agent 将无法定位该身份`)
    }

    this.emit()
    return this.list().find((x) => x.id === id)!
  }

  closeWindow(id: string): void {
    const win = this.windows.get(id)
    if (win && !win.isDestroyed()) win.close()
    this.windows.delete(id)
    this.targetIds.delete(id)
    // pushers 也要清：pushState 内部虽有 isDestroyed 守卫、调用不会出错，
    // 但反复开关窗口会让这个 Map 一直增长。
    this.pushers.delete(id)
    this.emit()
  }

  /** 供 MCP / 工具层查询：身份 → CDP target 映射 */
  mapping(): Array<{
    id: string
    name: string
    partition: string
    sessionName: string
    targetId: string | null
    url: string | null
    isOpen: boolean
  }> {
    return this.list().map((it) => ({
      id: it.id,
      name: it.name,
      partition: it.partition,
      sessionName: this.sessionNameOf(it.id),
      targetId: it.targetId,
      url: it.currentUrl,
      isOpen: it.isOpen
    }))
  }

  closeAll(): void {
    for (const id of [...this.windows.keys()]) this.closeWindow(id)
  }

  /** 由顶栏 webContents 反查它属于哪个身份 */
  private identityOfChrome(wcId: number): string | null {
    for (const [id, view] of this.chromes) {
      if (!view.webContents.isDestroyed() && view.webContents.id === wcId) return id
    }
    return null
  }

  /**
   * 注册顶栏导航 IPC。
   *
   * 关键点：动作一律作用在**内容视图**上，绝不作用在外壳窗口或顶栏，
   * 否则会把顶栏自己导航掉，或产生额外 target 破坏身份映射。
   */
  registerChromeIpc(): void {
    const contentOf = (wcId: number): WebContentsView | null => {
      const id = this.identityOfChrome(wcId)
      return id ? (this.contents.get(id) ?? null) : null
    }

    ipcMain.on('chrome:back', (e) => {
      const wc = contentOf(e.sender.id)?.webContents
      if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
    })

    ipcMain.on('chrome:forward', (e) => {
      const wc = contentOf(e.sender.id)?.webContents
      if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
    })

    ipcMain.on('chrome:reload', (e) => {
      const wc = contentOf(e.sender.id)?.webContents
      if (!wc) return
      // 加载中则停止，否则刷新 —— 与顶栏按钮的双态一致
      if (wc.isLoading()) wc.stop()
      else wc.reload()
    })

    ipcMain.on('chrome:home', (e) => {
      const id = this.identityOfChrome(e.sender.id)
      if (!id) return
      const home = this.identities.get(id)?.homeUrl ?? DEFAULT_HOME
      void this.contents.get(id)?.webContents.loadURL(home)
    })

    ipcMain.on('chrome:navigate', (e, raw: string) => {
      const wc = contentOf(e.sender.id)?.webContents
      if (!wc || !raw) return
      void wc.loadURL(normalizeInput(raw))
    })

    ipcMain.on('chrome:refresh', (e) => {
      const id = this.identityOfChrome(e.sender.id)
      if (id) this.pushers.get(id)?.()
    })

    ipcMain.on('chrome:ready', (e) => {
      const id = this.identityOfChrome(e.sender.id)
      if (id) this.pushers.get(id)?.()
    })
  }
}

/**
 * 把地址栏输入规范化成可加载的 URL。
 *
 * 判定顺序刻意保守：带协议的直接用；形似域名的补 https；其余当搜索词。
 * 不做 http 回落，避免把用户明确的 https 意图降级。
 */
function normalizeInput(raw: string): string {
  const s = raw.trim()
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(s)) return `http://${s}`
  // 形似域名：含点、无空格、点后是字母
  if (/^[^\s/]+\.[a-z]{2,}(:\d+)?(\/|\?|#|$)/i.test(s)) return `https://${s}`
  return `https://www.baidu.com/s?wd=${encodeURIComponent(s)}`
}

export const identityManager = new IdentityManager()
