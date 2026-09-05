#!/usr/bin/env node
/**
 * 把 agent-browser 原生二进制捆绑进 resources/bin/<platform>-<arch>/。
 *
 * 目的：打包后用户开箱即用，不依赖用户机器上有 node / npm / agent-browser。
 *
 * 注意：我们只用 --cdp 连接本 app 自己的 Chromium，不需要 agent-browser 去
 * 启动浏览器，所以「agent-browser install」（下载 ~684MB Chrome for Testing）
 * 这一步完全不需要执行。捆绑体积只有二进制本身。
 *
 * 查找顺序：
 *   1. 环境变量 AGENT_BROWSER_BIN 指定的文件
 *   2. node_modules/agent-browser/bin/agent-browser-<platform>-<arch>
 *   3. PATH 上的 agent-browser（解析 symlink 到真实原生二进制）
 */
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  chmodSync,
  statSync,
  realpathSync,
  cpSync,
  readdirSync,
  rmSync
} from 'node:fs'
import { join, dirname } from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const PLATFORM = process.env.TARGET_PLATFORM || process.platform
const ARCH = process.env.TARGET_ARCH || process.arch
const EXE = PLATFORM === 'win32' ? 'agent-browser.exe' : 'agent-browser'
const NATIVE_NAME = `agent-browser-${PLATFORM}-${ARCH}${PLATFORM === 'win32' ? '.exe' : ''}`

function findSource() {
  if (process.env.AGENT_BROWSER_BIN) {
    const p = process.env.AGENT_BROWSER_BIN
    if (!existsSync(p)) throw new Error(`AGENT_BROWSER_BIN 指向的文件不存在: ${p}`)
    return p
  }

  const local = join(root, 'node_modules', 'agent-browser', 'bin', NATIVE_NAME)
  if (existsSync(local)) return local

  try {
    const which = PLATFORM === 'win32' ? 'where agent-browser' : 'command -v agent-browser'
    const found = execSync(which, { encoding: 'utf8' }).trim().split('\n')[0]
    if (found && existsSync(found)) {
      // symlink → 真实原生二进制
      const real = realpathSync(found)
      return real
    }
  } catch {
    /* 不在 PATH 上 */
  }

  throw new Error(
    [
      '找不到 agent-browser 二进制。任选一种方式：',
      '  1) npm i -D agent-browser          （推荐，版本随项目锁定）',
      '  2) npm i -g agent-browser',
      '  3) AGENT_BROWSER_BIN=/path/to/bin node scripts/bundle-agent-browser.mjs',
      '',
      `当前查找目标: ${NATIVE_NAME}`
    ].join('\n')
  )
}

const src = findSource()
const outDir = join(root, 'resources', 'bin', `${PLATFORM}-${ARCH}`)
const dest = join(outDir, EXE)

mkdirSync(outDir, { recursive: true })
copyFileSync(src, dest)
if (PLATFORM !== 'win32') chmodSync(dest, 0o755)

const mb = (statSync(dest).size / 1024 / 1024).toFixed(1)
console.log(`✓ 已捆绑 agent-browser`)
console.log(`  源:   ${src}`)
console.log(`  目标: ${dest}`)
console.log(`  体积: ${mb} MB`)
console.log(`  平台: ${PLATFORM}-${ARCH}`)

// ── 捆绑 core skill ──────────────────────────────────────────────────
// agent-browser 的 `skills get core --full` 输出与二进制版本匹配的命令语法。
//
// 为什么是 core 而不是 skills/agent-browser：后者在 0.36+ 只是一个 3.4K 的
// discovery stub（自称 "not the usage guide"），真实语法在 skill-data/core
// 里（实测 --full 有 152 行命令示例）。
//
// 只捆 core。skill-data/ 里其余专项 skill 都不适用本项目：
//   · electron 假设 agent 自己去 `open -a "Slack" --remote-debugging-port=9222`
//     启动并连接第三方 app，而本项目是 app 主动暴露自己的身份窗口，方向相反；
//     它写的固定端口 9222、"先退出再带 flag 重启" 都会误导 agent。
//   · slack / dogfood / derive-client / 云端环境与本项目无关。
function bundleSkills() {
  const pkgRoot = (() => {
    let d = dirname(src)
    for (let i = 0; i < 4; i++) {
      d = dirname(d)
      if (existsSync(join(d, 'package.json')) && existsSync(join(d, 'skill-data'))) return d
    }
    return null
  })()

  if (!pkgRoot) {
    console.log(`\n⚠ 未找到 agent-browser 的 skill-data 目录，跳过 skill 捆绑`)
    console.log(`  影响：load_skill 工具不可用，agent 需自行用 --help 探查语法`)
    return
  }

  const core = join(pkgRoot, 'skill-data', 'core')
  if (!existsSync(core)) {
    console.log(`\n⚠ 未找到 skill-data/core，跳过 skill 捆绑`)
    return
  }

  const skillsOut = join(root, 'resources', 'skills')
  rmSync(skillsOut, { recursive: true, force: true })
  mkdirSync(skillsOut, { recursive: true })
  // 目录名必须是 core，`skills get core` 按目录名查找
  cpSync(core, join(skillsOut, 'core'), { recursive: true })

  // 排除 templates/：裸 `agent-browser open` 的独立 shell 脚本，
  // 假设自己启动浏览器，与本项目「连接已有身份窗口」的模式冲突。
  rmSync(join(skillsOut, 'core', 'templates'), { recursive: true, force: true })

  const refDir = join(skillsOut, 'core', 'references')
  const refs = existsSync(refDir) ? readdirSync(refDir).length : 0

  console.log(`\n✓ 已捆绑 core skill${refs ? `（含 ${refs} 份 references）` : ''}`)
  console.log(`  目标: ${skillsOut}/core`)
  console.log(`  排除: 专项 skill（electron/slack 等）与 templates/，均与本项目场景不符`)
}

bundleSkills()
