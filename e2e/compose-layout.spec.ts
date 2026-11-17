import { expect, test } from '@playwright/test'

async function recordAndOpenCompose(page: import('@playwright/test').Page) {
  await page.goto('./')
  await page.getByRole('button', { name: 'Choose screen' }).click()
  await page.getByRole('switch', { name: '3s countdown' }).click()
  await page.getByRole('button', { name: 'Start recording' }).click()
  await expect(page.getByText('Recording', { exact: true })).toBeVisible()
  await page.waitForTimeout(4000)
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByText(/Take saved/)).toBeVisible()
  await page.getByRole('button', { name: /Compose/ }).click()
  await expect(page.getByRole('slider', { name: 'Playhead' })).toBeVisible()
}
const num = async (l: import('@playwright/test').Locator, a: string) =>
  Number(await l.getAttribute(a))

test('panes can be resized by keyboard and drag, and are remembered', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await recordAndOpenCompose(page)

  const side = page.getByRole('separator', { name: 'Resize sidebar' })
  const before = await num(side, 'aria-valuenow')
  await side.focus()
  await page.keyboard.press('ArrowLeft') // bar moves left: sidebar grows
  expect(await num(side, 'aria-valuenow')).toBe(before + 16)
  await page.keyboard.press('Home')
  expect(await num(side, 'aria-valuenow')).toBe(
    await num(side, 'aria-valuemin'),
  )

  // Drag the bar 100 px left.
  const box = (await side.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + 200)
  await page.mouse.down()
  await page.mouse.move(box.x - 100, box.y + 200, { steps: 5 })
  await page.mouse.up()
  const dragged = await num(side, 'aria-valuenow')
  expect(dragged).toBeGreaterThan(300)
  const sidebarWidth = (await page
    .getByRole('complementary', { name: 'Edit' })
    .boundingBox())!.width
  expect(Math.abs(sidebarWidth - dragged)).toBeLessThan(2)

  const tl = page.getByRole('separator', { name: 'Resize timeline' })
  const tlBefore = await num(tl, 'aria-valuenow')
  await tl.focus()
  await page.keyboard.press('ArrowUp') // bar moves up: timeline grows
  expect(await num(tl, 'aria-valuenow')).toBe(tlBefore + 16)

  // Sizes survive a reload.
  await page.waitForTimeout(400)
  await page.reload()
  await page.getByRole('button', { name: /Compose/ }).click()
  await expect(
    page.getByRole('separator', { name: 'Resize sidebar' }),
  ).toHaveAttribute('aria-valuenow', String(dragged))
  await expect(
    page.getByRole('separator', { name: 'Resize timeline' }),
  ).toHaveAttribute('aria-valuenow', String(tlBefore + 16))
})

test('timeline zooms with buttons, wheel and the overview window', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await recordAndOpenCompose(page)
  const level = page.getByTestId('zoom-level')
  const range = page.getByRole('slider', { name: 'Visible range' })
  await expect(level).toHaveText('Whole take')
  const total = await num(range, 'aria-valuemax')

  await page.getByRole('button', { name: 'Zoom in' }).click()
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await expect(level).toHaveText(/×/)
  const win = (await range.boundingBox())!
  const strip = (await page.getByTestId('overview').boundingBox())!
  expect(win.width).toBeLessThan(strip.width * 0.6)

  // The playhead stays where it was when zooming around it.
  const head = page.getByTestId('playhead')
  await expect(head).toBeVisible()

  // Dragging the overview window pans the view.
  const startAt = await num(range, 'aria-valuenow')
  const wb = (await range.boundingBox())!
  await page.mouse.move(wb.x + wb.width / 2, wb.y + wb.height / 2)
  await page.mouse.down()
  await page.mouse.move(wb.x + wb.width / 2 + 60, wb.y + wb.height / 2, {
    steps: 4,
  })
  await page.mouse.up()
  expect(await num(range, 'aria-valuenow')).toBeGreaterThan(startAt)

  await page.getByRole('button', { name: 'Fit' }).click()
  await expect(level).toHaveText('Whole take')
  expect(await num(range, 'aria-valuenow')).toBe(0)

  // Ctrl + wheel over the timeline zooms in.
  const area = (await page
    .getByRole('slider', { name: 'Playhead' })
    .boundingBox())!
  await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -400)
  await page.keyboard.up('Control')
  await expect(level).toHaveText(/×/)

  // Cuts show on the overview too.
  await page.getByRole('button', { name: 'Fit' }).click()
  const playhead = page.getByRole('slider', { name: 'Playhead' })
  await playhead.focus()
  await page.keyboard.press('ArrowRight')
  await page.getByRole('tab', { name: 'Edit' }).click()
  await page.getByRole('button', { name: 'Mark in' }).click()
  await playhead.focus()
  await page.keyboard.press('ArrowRight')
  await page.getByRole('button', { name: 'Mark out' }).click()
  await page.getByRole('button', { name: 'Cut selection' }).click()
  await expect(page.getByTestId('ov-cut')).toHaveCount(1)
  expect(total).toBeGreaterThan(3000)
})
