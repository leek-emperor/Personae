import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {
    build: {
      rollupOptions: {
        input: {
          // 主窗口 preload
          index: resolve('src/preload/index.ts'),
          // 身份窗口顶栏（导航栏）专用 preload，权限面刻意做得很小
          chrome: resolve('src/preload/chrome.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    build: {
      rollupOptions: {
        input: {
          // 控制台（身份管理 UI）
          index: resolve('src/renderer/index.html'),
          // 身份窗口的导航栏
          chrome: resolve('src/renderer/chrome.html')
        }
      }
    },
    plugins: [react()]
  }
})
