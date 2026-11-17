import { expect, test } from '@playwright/test'

// A canned transcript stands in for Whisper so the test needs no model download.
const chunks = [
  { text: ' Welcome', timestamp: [0.2, 0.7] },
  { text: ' to', timestamp: [0.7, 0.9] },
  { text: ' um', timestamp: [1.2, 1.5] },
  { text: ' the', timestamp: [1.9, 2.1] },
  { text: ' demo.', timestamp: [2.1, 2.7] },
]

test('skip goes straight to Compose; deleting a word shortens the take and exports captions', async ({
  page,
}) => {
  await page.addInitScript((c) => {
    ;(globalThis as { __speechStub?: unknown }).__speechStub = { chunks: c }
  }, chunks)
  await page.goto('./')
  await page.getByRole('button', { name: 'Choose screen' }).click()
  await page.getByRole('switch', { name: '3s countdown' }).click()
  await page.getByRole('button', { name: 'Start recording' }).click()
  await expect(page.getByText('Recording', { exact: true })).toBeVisible()
  await page.waitForTimeout(4000)
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByText(/Take saved/)).toBeVisible()

  // Skip leads to Compose with no captions section.
  await page.getByRole('button', { name: /Annotate/ }).click()
  await expect(
    page.getByRole('region', { name: 'Generate captions' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Skip this step' }).click()
  await expect(page.getByRole('slider', { name: 'Playhead' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Captions' })).toHaveCount(0)

  // Back to Annotate and generate.
  await page.getByRole('button', { name: /Annotate/ }).click()
  await page.getByRole('button', { name: 'Generate captions' }).click()
  const words = page.getByTestId('transcript')
  await expect(words.getByRole('button', { name: 'Welcome' })).toBeVisible()

  // Delete the filler word "um".
  await words.getByRole('button', { name: 'um', exact: true }).click()
  await page.getByRole('button', { name: 'Delete words' }).click()
  await expect(words.getByRole('button', { name: 'um' })).toHaveAttribute(
    'data-status',
    'deleted',
  )
  await page.getByRole('button', { name: 'Continue to Compose' }).click()

  const playhead = page.getByRole('slider', { name: 'Playhead' })
  await expect(playhead).toBeVisible()
  const total = Number(await playhead.getAttribute('aria-valuemax'))
  await expect(page.getByTestId('cut')).toHaveCount(1)
  expect(total).toBeLessThan(4000)
  await expect(page.getByRole('group', { name: 'Captions' })).toBeVisible()

  // Survives a reload (stored in session.json).
  await page.reload()
  await page.getByRole('button', { name: /Compose/ }).click()
  await expect(page.getByTestId('cut')).toHaveCount(1)

  // Export offers caption files.
  await page.getByRole('button', { name: /Export/ }).click()
  const srt = page.getByRole('button', { name: 'Download SRT' })
  await expect(srt).toBeVisible()
  const [dl] = await Promise.all([page.waitForEvent('download'), srt.click()])
  expect(dl.suggestedFilename()).toBe('captions.srt')
})
