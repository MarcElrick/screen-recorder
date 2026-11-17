import { expect, test } from '@playwright/test'

test('a recording interrupted by closing the tab can be recovered', async ({
  context,
}) => {
  const first = await context.newPage()
  await first.goto('./')
  await first.getByRole('button', { name: 'Choose screen' }).click()
  await first.getByRole('switch', { name: '3s countdown' }).click()
  await first.getByRole('button', { name: 'Start recording' }).click()
  await expect(first.getByText('Recording', { exact: true })).toBeVisible()
  await first.waitForTimeout(3500)
  // Simulate a crash: the page goes away mid-recording, with no Stop.
  await first.close({ runBeforeUnload: false })

  const page = await context.newPage()
  await page.goto('./')
  const banner = page.getByRole('region', { name: 'Unfinished recording' })
  await expect(banner).toBeVisible()
  await banner.getByRole('button', { name: 'Recover' }).click()

  // Lands in Compose with the recovered take, which has real length.
  const playhead = page.getByRole('slider', { name: 'Playhead' })
  await expect(playhead).toBeVisible()
  const max = Number(await playhead.getAttribute('aria-valuemax'))
  expect(max).toBeGreaterThan(1500)
  await expect(banner).toBeHidden()

  await page.getByRole('button', { name: 'Takes', exact: true }).click()
  await expect(page.getByTestId('take')).toContainText('Recovered')
})
