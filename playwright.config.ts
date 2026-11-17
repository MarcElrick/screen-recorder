import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  use: {
    baseURL: 'http://localhost:4173/screen-recorder/',
    permissions: ['camera', 'microphone'],
    launchOptions: {
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        '--auto-select-desktop-capture-source=Entire screen',
        '--enable-usermedia-screen-capturing',
        '--headless=new',
      ],
      executablePath: process.env.CHROMIUM_PATH || undefined,
    },
  },
  webServer: {
    command: 'pnpm build && pnpm preview --port 4173 --strictPort',
    url: 'http://localhost:4173/screen-recorder/',
    reuseExistingServer: !process.env.CI,
  },
})
