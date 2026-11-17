import { expect, test } from '@playwright/test'

test('rename, open and delete a take', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Choose screen' }).click()
  await page.getByRole('switch', { name: '3s countdown' }).click()
  await page.getByRole('button', { name: 'Start recording' }).click()
  await expect(page.getByText('Recording', { exact: true })).toBeVisible()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByText(/Take saved/)).toBeVisible()

  await page.getByRole('button', { name: 'Takes', exact: true }).click()
  const take = page.getByTestId('take')
  await expect(take).toHaveCount(1)
  await expect(take).toContainText('screen + camera')

  await take.getByRole('button', { name: 'Rename' }).click()
  await page.getByRole('textbox', { name: 'Take name' }).fill('My demo')
  await page.keyboard.press('Enter')
  await expect(take).toContainText('My demo')

  // Survives a reload.
  await page.reload()
  await page.getByRole('button', { name: 'Takes', exact: true }).click()
  await expect(page.getByTestId('take')).toContainText('My demo')

  // Open goes to Compose with that take.
  await page.getByTestId('take').getByRole('button', { name: 'Open' }).click()
  await expect(page.getByRole('slider', { name: 'Playhead' })).toBeVisible()

  // Delete asks first, then removes it.
  await page.getByRole('button', { name: 'Takes', exact: true }).click()
  await page.getByTestId('take').getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByTestId('take')).toHaveCount(1)
  await page.getByTestId('take').getByRole('button', { name: 'Delete' }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete' })
    .click()
  await expect(page.getByText('No saved takes yet.')).toBeVisible()
})
