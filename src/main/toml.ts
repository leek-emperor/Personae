/**
 * TOML 段落拼接工具。
 *
 * 抽成独立、无 Electron 依赖的模块，便于单测覆盖 —— 这段「删段 / 替换段」
 * 的边界（子表不被提前截断、删除后不留半截）很容易在改动中悄悄退化，
 * 而它直接决定写入用户 codex 配置是否会损坏文件。
 */

/**
 * 从 TOML 文本里摘掉某个 mcp_servers 段。
 *
 * 范围是「该段 header 到下一个顶层 [ 段之前」，其中要排除它自己的子表
 * （形如 [mcp_servers.<key>.env]），否则会在 env 子表处提前截断，
 * 留下半截配置。
 *
 * replacement 为 null 表示删除该段。
 */
export function spliceTomlSection(raw: string, key: string, replacement: string | null): string {
  const header = `[mcp_servers.${key}]`
  if (!raw.includes(header)) return raw

  const lines = raw.split('\n')
  const start = lines.findIndex((l) => l.trim() === header)
  if (start === -1) return raw

  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    const t = lines[i].trim()
    // 段边界：下一个顶层 [ 段。要排除本段自己的子表（[mcp_servers.<key>.env] 等），
    // 但**不能**用 `[mcp_servers.<key>` 前缀判定 —— 那会把 <key> 是前缀的其他
    // server（如 personae vs personae_old）误当成子表，从而把它一并吞掉。
    // 精确匹配「本段头」或「本段的点分子表」两种形态。
    if (t.startsWith('[') && t !== header && !t.startsWith(`[mcp_servers.${key}.`)) {
      end = i
      break
    }
  }

  const head = lines.slice(0, start)
  const tail = lines.slice(end)
  return replacement === null
    ? [...head, ...tail].join('\n')
    : [...head, replacement, '', ...tail].join('\n')
}
