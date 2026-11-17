/// <reference types="node" />
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'

test('cut a section, undo it, and export without it', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Choose screen' }).click()
  await page.getByRole('switch', { name: '3s countdown' }).click()
  await page.getByRole('button', { name: 'Start recording' }).click()
  await expect(page.getByText('Recording', { exact: true })).toBeVisible()
  await page.waitForTimeout(4000)
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByText(/Take saved/)).toBeVisible()
  await page.getByRole('button', { name: /Compose/ }).click()

  const playhead = page.getByRole('slider', { name: 'Playhead' })
  await expect(playhead).toBeVisible()
  const total = Number(await playhead.getAttribute('aria-valuemax'))
  expect(total).toBeGreaterThan(3000)

  await playhead.focus()
  await page.keyboard.press('ArrowRight') // 1 s
  await page.getByRole('button', { name: 'Mark in' }).click()
  await playhead.focus()
  await page.keyboard.press('ArrowRight') // 2 s
  await page.getByRole('button', { name: 'Mark out' }).click()
  await expect(page.getByTestId('selection')).toBeVisible()
  await page.getByRole('button', { name: 'Cut selection' }).click()

  await expect(page.getByTestId('cut')).toHaveCount(1)
  const cut = Number(await playhead.getAttribute('aria-valuemax'))
  expect(Math.abs(total - cut - 1000)).toBeLessThan(150)

  // Undo restores, redo cuts again.
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByTestId('cut')).toHaveCount(0)
  expect(Number(await playhead.getAttribute('aria-valuemax'))).toBe(total)
  await page.getByRole('button', { name: 'Redo' }).click()
  await expect(page.getByTestId('cut')).toHaveCount(1)

  // Trim the end at the playhead.
  await page.getByRole('button', { name: 'Trim end' }).click()
  expect(Number(await playhead.getAttribute('aria-valuemax'))).toBeLessThan(cut)

  // Export honours the edit.
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
      'format=duration',
      '-of',
      'csv=p=0',
      await download.path(),
    ]).toString()
    const dur = parseFloat(out)
    // 4 s take minus the 1 s cut, then trimmed at ~2 s of edited time.
    expect(dur).toBeLessThan(cut / 1000 - 0.3)
    expect(dur).toBeGreaterThan(0.5)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
})

test('dragging on the timeline highlights a selection', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Choose screen' }).click()
  await page.getByRole('switch', { name: '3s countdown' }).click()
  await page.getByRole('button', { name: 'Start recording' }).click()
  await expect(page.getByText('Recording', { exact: true })).toBeVisible()
  await page.waitForTimeout(3000)
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByText(/Take saved/)).toBeVisible()
  await page.getByRole('button', { name: /Compose/ }).click()

  const area = page.getByRole('slider', { name: 'Playhead' })
  await expect(area).toBeVisible()
  const box = (await area.boundingBox())!
  const y = box.y + box.height / 2
  await page.mouse.move(box.x + box.width * 0.2, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.4, y, { steps: 5 })
  const sel = page.getByTestId('selection')
  await expect(sel).toBeVisible() // visible while still dragging
  await page.mouse.up()
  const s = (await sel.boundingBox())!
  expect(s.width / box.width).toBeGreaterThan(0.15)
  expect(s.width / box.width).toBeLessThan(0.25)
})
