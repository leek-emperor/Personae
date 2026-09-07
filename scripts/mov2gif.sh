#!/usr/bin/env bash
#
# 把 macOS 录屏（.mov）转成适合放进 README 的 GIF。
#
#   ./scripts/mov2gif.sh <输入.mov> [输出.gif] [宽度] [帧率]
#
# 默认输出 docs/demo.gif，宽 960px，12fps。
#
# 为什么要两趟（palettegen / paletteuse）：
# GIF 只有 256 色，ffmpeg 直接转会用固定调色板，画面会糊、有色带。
# 先扫一遍整段视频统计实际用到的颜色生成专属调色板，再套用，
# 同样体积下清晰度差别很大。
#
# stats_mode=diff：让调色板偏向「帧间变化的区域」，也就是正在动的部分，
# 静态背景占用的颜色配额更少 —— 录屏这种大片静止画面的素材尤其明显。
#
# dither=bayer:bayer_scale=5：有序抖动。默认的 sierra2_4a 误差扩散
# 会在每帧产生大量噪点差异，导致 GIF 帧间压缩失效、体积暴涨；
# bayer 的图案是固定的，静止区域帧与帧完全相同，能被有效压缩。

set -euo pipefail

IN="${1:-}"
OUT="${2:-docs/demo.gif}"
WIDTH="${3:-960}"
FPS="${4:-12}"

if [ -z "$IN" ] || [ ! -f "$IN" ]; then
  cat <<EOF
用法: $0 <输入.mov> [输出.gif] [宽度] [帧率]

例:
  $0 ~/Desktop/rec.mov
  $0 ~/Desktop/rec.mov docs/demo.gif 800 10

录屏方法（macOS 自带，无需装软件）:
  1. 按 Shift + Command + 5
  2. 选「录制所选部分」，框住应用窗口
  3. 点「录制」，操作完点菜单栏的停止按钮
  4. 录屏默认存到桌面，然后跑这个脚本
EOF
  exit 1
fi

command -v ffmpeg >/dev/null || { echo "需要 ffmpeg：brew install ffmpeg"; exit 1; }

mkdir -p "$(dirname "$OUT")"
PALETTE="$(mktemp -t gifpalette).png"
trap 'rm -f "$PALETTE"' EXIT

echo "输入 : $IN"
echo "输出 : $OUT  (${WIDTH}px @ ${FPS}fps)"
echo

echo "[1/2] 分析配色…"
# -update 1 + -frames:v 1：明确告诉 ffmpeg 这是「写单张图」而不是图片序列。
# 不加会有 "does not contain an image sequence pattern" 警告，
# 虽然当前版本仍能出图，但属于未定义写法，换版本可能直接失败。
ffmpeg -v warning -i "$IN" \
  -vf "fps=${FPS},scale=${WIDTH}:-1:flags=lanczos,palettegen=stats_mode=diff" \
  -update 1 -frames:v 1 -y "$PALETTE"

echo "[2/2] 生成 GIF…"
ffmpeg -v warning -i "$IN" -i "$PALETTE" \
  -lavfi "fps=${FPS},scale=${WIDTH}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" \
  -y "$OUT"

SIZE=$(du -h "$OUT" | cut -f1)
DIMS=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height \
       -of csv=p=0:s=x "$OUT" 2>/dev/null || echo "?")

echo
echo "✓ $OUT  ($SIZE, $DIMS)"
echo

# GitHub 单文件上限 100MB，但 README 里的 GIF 超过 ~10MB 就会明显拖慢加载，
# 移动端更糟。给出可操作的收缩建议而不是只报数字。
BYTES=$(stat -f%z "$OUT" 2>/dev/null || stat -c%s "$OUT")
if [ "$BYTES" -gt 10485760 ]; then
  echo "⚠ 超过 10MB，README 里加载会很慢。试试："
  echo "    $0 \"$IN\" \"$OUT\" 800 10     # 降到 800px / 10fps"
  echo "  或先把录屏剪短一些（GIF 体积与时长基本成正比）。"
else
  echo "体积合适，可以直接放进 README。"
fi
