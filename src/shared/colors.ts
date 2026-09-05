/**
 * 身份色板 —— 主进程与渲染进程共用。
 *
 * 为什么要放在共享模块里：这套颜色同时出现在两个地方 —— 主界面的身份列表
 * （CSS 变量 --id-0..5）和每个身份窗口顶栏的色点（主进程推给 chrome.html）。
 * 两边一旦不一致，颜色就失去了「跨窗口认身份」的作用，反而误导人。
 * 所以只在这里定义一次，CSS 那边的 --id-N 必须与本数组逐项对应。
 *
 * 取色原则：六个色相在深底上都能拉开距离，且刻意避开纯红 —— 红色留给错误态。
 * 超过 6 个身份就回头复用，这是有意的：颜色是辅助识别，
 * 真正的唯一标识始终是身份名称和 partition。
 */
export const IDENTITY_COLORS = [
  '#5b9cff',
  '#2dd4a0',
  '#a78bfa',
  '#fbbf5c',
  '#f472b6',
  '#38d0e8'
] as const

/** 按身份在列表中的序号取色。Map 的插入顺序稳定，两端算出的结果一致。 */
export function identityColor(index: number): string {
  return IDENTITY_COLORS[index % IDENTITY_COLORS.length]
}
