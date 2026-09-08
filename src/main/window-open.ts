/**
 * 「window.open / target=_blank」的决策逻辑。
 *
 * 刻意抽成不依赖任何 Electron 对象的纯函数：
 *   · 决策规则是这套弹窗方案的核心，必须能被单测覆盖；
 *   · 把「怎么判定」和「判定后怎么操作 WebContents」分开，identity.ts 只负责后者。
 *
 * 设计原则（面向开源通用）：不猜网站意图、不看 features、不维护域名清单。
 * 唯一区分「该弹 / 不该弹」的依据是 Web 平台自己的概念 —— **用户激活**
 * （transient activation）：弹窗前很短时间内有没有真实的人为输入。
 * 这正是主流浏览器弹窗拦截器的底层逻辑。
 */

export type WindowOpenDisposition =
  'default' | 'foreground-tab' | 'background-tab' | 'new-window' | 'other'

export type WindowOpenDecision =
  /** 压回当前内容视图内导航：等价于普通链接跳转，无 opener，安全 */
  | 'same-window'
  /** 放行为受控子窗口：保留 opener（OAuth 需要），归属该身份 shell */
  | 'allow-child'
  /** 忽略：非 http(s) 协议，或被弹窗拦截器挡下的非用户激活弹窗 */
  | 'ignore'

export type WindowOpenInput = {
  url: string
  disposition: WindowOpenDisposition
  /** 弹窗发生前很短时间内是否有真实用户输入（由主进程按 input-event 时间戳判定） */
  userActivated: boolean
  /** 弹窗拦截器是否开启（默认开）。关闭时不再要求用户激活 */
  popupBlockerEnabled: boolean
}

/** http/https 之外的协议一律不接管（javascript:/data:/file: 等，纯安全考虑） */
function isHttp(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/**
 * 决定一次 window.open / target=_blank 该如何处理。
 *
 * 规则顺序（越靠前优先级越高）：
 *   1. 非 http(s)                        → ignore（安全底线）
 *   2. 不是新窗口语义（target=_blank 等） → same-window（维持「一身份一主 target」）
 *   3. 新窗口语义：
 *        拦截器开 且 非用户激活           → ignore（挡广告/pop-under）
 *        否则                            → allow-child（放行为受控子窗口）
 *
 * 注意 disposition 的含义：带 features 的 window.open 会是 'new-window'，
 * 而 <a target=_blank> / 无 features 的 window.open 多是 foreground/background-tab。
 * 我们只把 'new-window' 当作「需要独立窗口」的信号，其余 http(s) 都压回同窗。
 */
export function classifyWindowOpen(input: WindowOpenInput): WindowOpenDecision {
  const { url, disposition, userActivated, popupBlockerEnabled } = input

  if (!isHttp(url)) return 'ignore'
  if (disposition !== 'new-window') return 'same-window'

  if (popupBlockerEnabled && !userActivated) return 'ignore'
  return 'allow-child'
}
