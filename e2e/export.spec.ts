/// <reference types="node" />
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'

function ffprobe(path: string): { duration: number; streams: string[] } | null {
  try {
    const out = execFileSync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration:stream=codec_type',
      '-of',
      'json',
      path,
    ]).toString()
    const j = JSON.parse(out)
    return {
      duration: parseFloat(j.format.duration),
      streams: j.streams.map((s: { codec_type: string }) => s.codec_type),
    }
  } catch {
    return null
  }
}

for (const format of ['WebM', 'MP4']) {
  test(`export a take as ${format}`, async ({ page }) => {
    await page.goto('./')
    await page.getByRole('button', { name: 'Choose screen' }).click()
    await page.getByRole('switch', { name: '3s countdown' }).click()
    await page.getByRole('button', { name: 'Start recording' }).click()
    await expect(page.getByText('Recording', { exact: true })).toBeVisible()
    await page.waitForTimeout(2500)
    await page.getByRole('button', { name: 'Stop' }).click()
    await expect(page.getByText(/Take saved/)).toBeVisible()

    await page.getByRole('button', { name: /Export/ }).click()
    await page.getByRole('radio', { name: format, exact: true }).click()
    await page
      .getByRole('region', { name: 'Export settings' })
      .getByRole('button', { name: 'Export' })
      .click()

    const link = page.getByRole('link', { name: /Download recording/ })
    await expect(link).toBeVisible({ timeout: 60_000 })
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      link.click(),
    ])
    expect(download.suggestedFilename()).toBe(
      `recording.${format.toLowerCase()}`,
    )
    const path = await download.path()
    await expect(
      page.getByRole('region', { name: 'Exports this visit' }),
    ).toContainText(`.${format.toLowerCase()}`)

    const info = ffprobe(path)
    test.skip(info === null, 'ffprobe not installed')
    expect(info!.duration).toBeGreaterThan(1.5)
    expect(info!.duration).toBeLessThan(4)
    expect(info!.streams).toContain('video')
    expect(info!.streams).toContain('audio')
  })
}

test('presets, estimate, mute and frame rate', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Choose screen' }).click()
  await page.getByRole('switch', { name: '3s countdown' }).click()
  await page.getByRole('button', { name: 'Start recording' }).click()
  await expect(page.getByText('Recording', { exact: true })).toBeVisible()
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByText(/Take saved/)).toBeVisible()
  await page.getByRole('button', { name: /Export/ }).click()

  const settings = page.getByRole('region', { name: 'Export settings' })
  await expect(settings.getByText(/Estimated size/)).toBeVisible()
  const estimate = async (): Promise<string> =>
    (await settings.getByText(/Estimated size/).innerText()).replace(/\D+/, ' ')
  const before = await estimate()

  // A preset changes the settings (and the estimate); editing one makes it custom.
  await settings.getByRole('radio', { name: /Small file/ }).click()
  await expect(
    settings.getByRole('radio', { name: 'WebM', exact: true }),
  ).toHaveAttribute('data-state', 'off')
  expect(await estimate()).not.toBe(before)
  await settings.getByRole('radio', { name: 'High', exact: true }).click()
  await expect(settings.getByText('Custom settings')).toBeVisible()

  await settings.getByRole('switch', { name: 'Mute' }).click()
  await settings.getByRole('radio', { name: 'WebM', exact: true }).click()
  await settings.getByRole('button', { name: 'Export' }).click()
  const link = page.getByRole('link', { name: /Download recording/ })
  await expect(link).toBeVisible({ timeout: 60_000 })
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    link.click(),
  ])
  const info = ffprobe(await download.path())
  test.skip(info === null, 'ffprobe not installed')
  expect(info!.streams).toContain('video')
  expect(info!.streams).not.toContain('audio')
})
