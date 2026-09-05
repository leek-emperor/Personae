#!/usr/bin/env node
/**
 * SVG → PNG / .icns / .ico 图标生成脚本。
 *
 * 为什么用 Electron 渲染而不是 rsvg-convert / inkscape / ImageMagick：
 * 本机（以及大多数干净环境）都没装这些工具，实测 rsvg-convert、inkscape、
 * convert、magick、cairosvg 全部缺失；`sips` 虽在但不支持 SVG 输入。
 * 而本项目必然装了 Electron，其内置 Chromium 是最靠谱的 SVG 渲染器，
 * 且渲染结果与 app 里看到的一致。零新增依赖。
 *
 * .icns 用系统 iconutil 生成（macOS 自带）。
 * .ico 自己按格式拼字节 —— 它只是一个头 + 若干 PNG 的容器，
 * 不值得为此引入一个 npm 包。
 *
 * 用法：
 *   node scripts/make-icons.mjs [源SVG路径]
 * 默认源：design/logo/icon.svg
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const src = resolve(root, process.argv[2] ?? 'design/logo/icon.svg')

if (!existsSync(src)) {
  console.error(`✗ 找不到源 SVG: ${src}`)
  process.exit(1)
}

const buildDir = join(root, 'build')
const work = join(tmpdir(), `mib-icons-${Date.now()}`)
mkdirSync(work, { recursive: true })

// ── 用 Electron 把 SVG 渲染成各尺寸 PNG ─────────────────────────────
// 走 ELECTRON_RUN_AS_NODE 是不行的（那样没有 GUI 也没有 Chromium 渲染），
// 必须以正常 Electron 模式跑一个 offscreen 窗口。
const SIZES = [16, 32, 64, 128, 256, 512, 1024]

const renderer = join(work, 'render.cjs')
writeFileSync(
  renderer,
  `const { app, BrowserWindow } = require('electron')
const { writeFileSync, readFileSync } = require('fs')
const { join } = require('path')

const svgPath = ${JSON.stringify(src)}
const outDir = ${JSON.stringify(work)}
const sizes = ${JSON.stringify(SIZES)}

app.disableHardwareAcceleration()

// 必须挡掉默认的 window-all-closed 退出行为。
// 我们是「建窗口→截图→销毁→建下一个」的循环，每次 destroy 都会让窗口数归零，
// Electron 默认会据此退出整个 app —— 表现是只渲染出第一个尺寸就崩，
// 子进程报 "No rendezvous client, terminating process (parent died?)"。
app.on('window-all-closed', () => {})

app.whenReady().then(async () => {
  // 通过临时文件引用 SVG，而不是内联成 data URL。
  // 实测：稍长的 SVG 会让 data:text/html;base64,... 超长，
  // loadURL 直接报 ERR_FAILED (-2)。走 file:// 没有长度限制。
  const localSvg = join(outDir, 'source.svg')
  writeFileSync(localSvg, readFileSync(svgPath))

  for (const size of sizes) {
    const htmlPath = join(outDir, 'page-' + size + '.html')
    writeFileSync(
      htmlPath,
      '<!doctype html><meta charset="utf-8">' +
        '<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}' +
        'img{display:block;width:' + size + 'px;height:' + size + 'px}</style>' +
        '<img src="file://' + localSvg + '">'
    )

    // 重试：offscreen 窗口连续创建时首次 load 偶发失败（ERR_FAILED），
    // 与尺寸无关，纯粹是时序问题。失败就重建窗口再试。
    let png = null
    let lastErr = null
    for (let attempt = 1; attempt <= 4 && !png; attempt++) {
      const win = new BrowserWindow({
        width: size,
        height: size,
        show: false,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        useContentSize: true,
        webPreferences: {
          offscreen: true,
          // Retina 屏上 capturePage 默认按 devicePixelRatio 输出（2x），
          // 会让 512 请求得到 1024 图。锁成 1 保证请求尺寸 == 输出像素。
          zoomFactor: 1,
          deviceScaleFactor: 1
        }
      })
      try {
        await win.loadFile(htmlPath)
        // 等 SVG 解码 + 合成一帧。offscreen 下 did-finish-load 早于实际绘制，
        // 不等会拿到空白帧。
        await new Promise((r) => setTimeout(r, 340))
        const img = await win.webContents.capturePage()
        if (img.isEmpty()) throw new Error('capturePage 返回空图')
        // 双保险：即使上面的 scale 设置没生效，也强制缩到目标尺寸
        const actual = img.getSize()
        const fixed =
          actual.width === size ? img : img.resize({ width: size, height: size, quality: 'best' })
        png = fixed.toPNG()
      } catch (err) {
        lastErr = err
        await new Promise((r) => setTimeout(r, 220 * attempt))
      } finally {
        if (!win.isDestroyed()) win.destroy()
      }
    }

    if (!png) throw new Error('渲染 ' + size + 'px 失败: ' + (lastErr && lastErr.message))

    writeFileSync(join(outDir, size + '.png'), png)
    console.log('  rendered ' + size + 'x' + size)
  }

  app.quit()
})
`,
  'utf8'
)

const electronBin = (() => {
  const p = join(
    root,
    'node_modules',
    'electron',
    'dist',
    'Electron.app',
    'Contents',
    'MacOS',
    'Electron'
  )
  if (existsSync(p)) return p
  // 非 macOS / 其他布局
  const alt = join(root, 'node_modules', '.bin', 'electron')
  if (existsSync(alt)) return alt
  throw new Error('找不到 electron，请先 pnpm install')
})()

console.log(`源: ${src}`)
console.log('用 Electron 内置 Chromium 渲染 PNG…')
execFileSync(electronBin, [renderer], { stdio: 'inherit', cwd: root })

for (const s of SIZES) {
  if (!existsSync(join(work, `${s}.png`))) throw new Error(`渲染缺失: ${s}.png`)
}

// ── build/icon.png（electron-builder 要求 ≥512）────────────────────
mkdirSync(buildDir, { recursive: true })
writeFileSync(join(buildDir, 'icon.png'), readFileSync(join(work, '1024.png')))
console.log('\n✓ build/icon.png (1024×1024)')

// renderer/主进程里 `?asset` import 的那份
writeFileSync(join(root, 'resources', 'icon.png'), readFileSync(join(work, '512.png')))
console.log('✓ resources/icon.png (512×512)')

// ── build/icon.icns（macOS）────────────────────────────────────────
// iconutil 要求严格的命名，且 @2x 必须是对应逻辑尺寸的两倍像素。
// 这里的映射是「逻辑名 → 实际像素文件」，注意 @2x 取的是 2 倍那张。
const iconset = join(work, 'icon.iconset')
mkdirSync(iconset, { recursive: true })
const ICNS_MAP = [
  ['16.png', 'icon_16x16.png'],
  ['32.png', 'icon_16x16@2x.png'],
  ['32.png', 'icon_32x32.png'],
  ['64.png', 'icon_32x32@2x.png'],
  ['128.png', 'icon_128x128.png'],
  ['256.png', 'icon_128x128@2x.png'],
  ['256.png', 'icon_256x256.png'],
  ['512.png', 'icon_256x256@2x.png'],
  ['512.png', 'icon_512x512.png'],
  ['1024.png', 'icon_512x512@2x.png']
]
for (const [from, to] of ICNS_MAP) {
  writeFileSync(join(iconset, to), readFileSync(join(work, from)))
}
try {
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(buildDir, 'icon.icns')], {
    stdio: 'pipe'
  })
  console.log('✓ build/icon.icns')
} catch (err) {
  console.warn(`⚠ 生成 .icns 失败（非 macOS 可忽略）: ${err.message}`)
}

// ── build/icon.ico（Windows）──────────────────────────────────────
// ICO = 6 字节文件头 + 每图 16 字节目录项 + 各 PNG 原始数据。
// 现代 Windows 支持 PNG 压缩的 ICO，直接塞 PNG 即可。
function buildIco(pngPaths) {
  const imgs = pngPaths.map((p) => {
    const buf = readFileSync(p.file)
    return { size: p.size, buf }
  })

  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: 1 = icon
  header.writeUInt16LE(imgs.length, 4)

  const dirSize = 16 * imgs.length
  let offset = 6 + dirSize
  const dirs = []
  for (const img of imgs) {
    const d = Buffer.alloc(16)
    // 256 要写成 0
    d.writeUInt8(img.size >= 256 ? 0 : img.size, 0) // width
    d.writeUInt8(img.size >= 256 ? 0 : img.size, 1) // height
    d.writeUInt8(0, 2) // 调色板数
    d.writeUInt8(0, 3) // reserved
    d.writeUInt16LE(1, 4) // color planes
    d.writeUInt16LE(32, 6) // bpp
    d.writeUInt32LE(img.buf.length, 8)
    d.writeUInt32LE(offset, 12)
    dirs.push(d)
    offset += img.buf.length
  }

  return Buffer.concat([header, ...dirs, ...imgs.map((i) => i.buf)])
}

const icoSizes = [16, 32, 64, 128, 256]
writeFileSync(
  join(buildDir, 'icon.ico'),
  buildIco(icoSizes.map((s) => ({ size: s, file: join(work, `${s}.png`) })))
)
console.log(`✓ build/icon.ico (含 ${icoSizes.join('/')})`)

rmSync(work, { recursive: true, force: true })
console.log('\n完成。')
