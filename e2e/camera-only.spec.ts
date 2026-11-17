/// <reference types="node" />
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'

test('record, compose and export a camera-only take', async ({ page }) => {
  await page.goto('./')
  // No screen chosen: the camera alone is enough.
  const start = page.getByRole('button', { name: 'Start recording' })
  await expect(page.getByText(/Camera only/)).toBeVisible()
  await expect(start).toBeEnabled()
  await page.getByRole('switch', { name: '3s countdown' }).click()
  await start.click()
  await expect(page.getByText('Recording', { exact: true })).toBeVisible()
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByText(/Take saved/)).toBeVisible()

  await page.getByRole('button', { name: 'Takes', exact: true }).click()
  await expect(page.getByTestId('take')).toContainText('camera only + mic')

  await page.getByTestId('take').getByRole('button', { name: 'Open' }).click()
  await expect(page.getByRole('slider', { name: 'Playhead' })).toBeVisible()
  await expect(page.getByTestId('bubble')).toHaveCount(0)

  await page.getByRole('button', { name: /Export/ }).click()
  const settings = page.getByRole('region', { name: 'Export settings' })
  await settings.getByRole('radio', { name: 'WebM', exact: true }).click()
  await settings.getByRole('button', { name: 'Export' }).click()
  const link = page.getByRole('link', { name: /Download recording/ })
  await expect(link).toBeVisible({ timeout: 60_000 })
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    link.click(),
  ])
  try {
    const out = execFileSync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type',
      '-of',
      'csv=p=0',
      await download.path(),
    ]).toString()
    expect(out).toContain('video')
    expect(out).toContain('audio')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
})
