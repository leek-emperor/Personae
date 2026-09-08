/**
 * 把地址栏输入规范化成可加载的 URL。
 *
 * 抽成独立、无 Electron 依赖的纯函数，便于单测覆盖 —— 地址栏判定的边界
 * （什么算域名、什么当搜索词）很容易在改动中悄悄退化。
 *
 * 判定顺序刻意保守：带协议的直接用；形似域名的补 https；其余当搜索词。
 * 不做 http 回落，避免把用户明确的 https 意图降级。
 */
export function normalizeInput(raw: string): string {
  const s = raw.trim()
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(s)) return `http://${s}`
  // 形似域名：含点、无空格、点后是字母
  if (/^[^\s/]+\.[a-z]{2,}(:\d+)?(\/|\?|#|$)/i.test(s)) return `https://${s}`
  return `https://www.baidu.com/s?wd=${encodeURIComponent(s)}`
}
