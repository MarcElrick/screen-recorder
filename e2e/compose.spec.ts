import { expect, test } from '@playwright/test'

test('compose: scrub, move the bubble, and the placement persists', async ({
  page,
}) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Choose screen' }).click()
  await page.getByRole('switch', { name: '3s countdown' }).click()
  await page.getByRole('button', { name: 'Start recording' }).click()
  await expect(page.getByText('Recording', { exact: true })).toBeVisible()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Resume' }).click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByText(/Take saved/)).toBeVisible()

  await page.getByRole('button', { name: /Compose/ }).click()
  const playhead = page.getByRole('slider', { name: 'Playhead' })
  await expect(playhead).toBeVisible()
  const max = Number(await playhead.getAttribute('aria-valuemax'))
  expect(max).toBeGreaterThan(2000)

  // Scrub with the keyboard and by clicking the timeline.
  await playhead.focus()
  await page.keyboard.press('ArrowRight')
  await expect(playhead).toHaveAttribute('aria-valuenow', '1000')
  const box = (await playhead.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + 30)
  const mid = Number(await playhead.getAttribute('aria-valuenow'))
  expect(Math.abs(mid - max / 2)).toBeLessThan(max * 0.05)

  // Play advances the playhead.
  await page.getByRole('button', { name: 'Play' }).click()
  await expect
    .poll(async () => Number(await playhead.getAttribute('aria-valuenow')))
    .toBeGreaterThan(mid)
  await page.getByRole('button', { name: 'Pause' }).click()

  // Move the bubble to the top-left and switch to a rounded rectangle.
  const bubble = page.getByTestId('bubble')
  await expect(bubble).toBeVisible()
  await page.getByRole('radio', { name: 'Top left' }).click()
  await page.getByRole('radio', { name: 'Rounded' }).click()
  const before = (await bubble.boundingBox())!
  await page.mouse.move(
    before.x + before.width / 2,
    before.y + before.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(before.x + 200, before.y + 120, { steps: 5 })
  await page.mouse.up()
  const after = (await bubble.boundingBox())!
  expect(after.x).toBeGreaterThan(before.x + 100)
  await expect(
    page.getByRole('status').filter({ hasText: 'Saved' }),
  ).toBeVisible()

  const saved = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    for await (const [name, h] of (
      root as unknown as {
        entries(): AsyncIterable<[string, FileSystemHandle]>
      }
    ).entries()) {
      if (!name.startsWith('take-')) continue
      const f = await (
        await (h as FileSystemDirectoryHandle).getFileHandle('session.json')
      ).getFile()
      return JSON.parse(await f.text())
    }
  })
  expect(saved.compose.bubble.shape).toBe('rounded')
  expect(saved.compose.edit.ranges).toHaveLength(1)

  // Reload: the placement comes back.
  await page.reload()
  await page.getByRole('button', { name: /Compose/ }).click()
  const reloaded = page.getByTestId('bubble')
  await expect(reloaded).toBeVisible()
  const rb = (await reloaded.boundingBox())!
  expect(Math.abs(rb.x - after.x)).toBeLessThan(4)
})
