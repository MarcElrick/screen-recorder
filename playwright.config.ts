import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
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
    },
    // Needs `pnpm exec playwright install firefox`; run with --project=firefox.
    {
      name: 'firefox',
      use: {
        browserName: 'firefox',
        launchOptions: {
          firefoxUserPrefs: {
            'media.navigator.streams.fake': true,
            'media.navigator.permission.disabled': true,
            'media.getusermedia.screensharing.enabled': true,
            'media.getdisplaymedia.screencapture.enabled': true,
          },
        },
      },
    },
  ],
  use: { baseURL: 'http://localhost:4173/screen-recorder/' },
  webServer: {
    command: 'pnpm build && pnpm preview --port 4173 --strictPort',
    url: 'http://localhost:4173/screen-recorder/',
    reuseExistingServer: !process.env.CI,
  },
})
