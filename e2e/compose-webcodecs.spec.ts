import { expect, test } from '@playwright/test'

test('compose renders in a worker with WebCodecs frames, and they are not black', async ({
  page,
}) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Choose screen' }).click()
  await page.getByRole('switch', { name: '3s countdown' }).click()
  await page.getByRole('button', { name: 'Start recording' }).click()
  await expect(page.getByText('Recording', { exact: true })).toBeVisible()
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByText(/Take saved/)).toBeVisible()
  await page.getByRole('button', { name: /Compose/ }).click()

  const canvas = page.getByLabel('Composed preview')
  await expect(canvas).toHaveAttribute('data-frames', 'worker')

  // The canvas belongs to the worker, so inspect it through a screenshot.
  const lit = async (): Promise<number> => {
    const png = (await canvas.screenshot()).toString('base64')
    return page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const bmp = await createImageBitmap(
        new Blob([bytes], { type: 'image/png' }),
      )
      const c = new OffscreenCanvas(bmp.width, bmp.height)
      const g = c.getContext('2d')!
      g.drawImage(bmp, 0, 0)
      const d = g.getImageData(0, 0, c.width, c.height).data
      let n = 0
      for (let i = 0; i < d.length; i += 4 * 97)
        if (d[i] + d[i + 1] + d[i + 2] > 30) n++
      return n
    }, png)
  }
  await expect.poll(lit).toBeGreaterThan(10)

  // Scrubbing still produces frames.
  const playhead = page.getByRole('slider', { name: 'Playhead' })
  await playhead.focus()
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(500)
  expect(await lit()).toBeGreaterThan(10)
  await page.keyboard.press('ArrowLeft')
  await page.waitForTimeout(500)
  expect(await lit()).toBeGreaterThan(10)
})
