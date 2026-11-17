/// <reference types="node" />
import { readFile } from 'node:fs/promises'
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

  // Split before "demo." if it isn't already a caption start (how the words
  // group depends on the audio the fake device produced), then reword the first.
  const cueBoxes = page.getByTestId('cues').getByRole('textbox')
  await page.getByRole('tab', { name: 'Captions' }).click()
  const before = await cueBoxes.count()
  await page.getByRole('tab', { name: 'Transcript' }).click()
  await words.getByRole('button', { name: 'demo.', exact: true }).click()
  const split = page.getByRole('button', { name: 'New caption here' })
  const canSplit = await split.isEnabled()
  if (canSplit) await split.click()
  await page.getByRole('tab', { name: 'Captions' }).click()
  await expect(cueBoxes).toHaveCount(canSplit ? before + 1 : before)
  await cueBoxes.first().fill('Hello,\nfriends')
  await cueBoxes.first().blur()
  await expect(
    page.getByRole('button', { name: 'Use spoken words' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Continue to Compose' }).click()

  const playhead = page.getByRole('slider', { name: 'Playhead' })
  await expect(playhead).toBeVisible()
  const total = Number(await playhead.getAttribute('aria-valuemax'))
  await expect(page.getByTestId('cut')).toHaveCount(1)
  expect(total).toBeLessThan(4000)
  await expect(page.getByRole('group', { name: 'Captions' })).toBeVisible()

  // The caption shows in the Compose preview (white text near the bottom).
  await playhead.focus()
  await page.keyboard.press('ArrowRight') // 1 s
  await expect
    .poll(
      async () => {
        const png = await page.locator('canvas').first().screenshot()
        return page.evaluate(async (b64) => {
          const img = new Image()
          img.src = `data:image/png;base64,${b64}`
          await img.decode()
          const c = document.createElement('canvas')
          c.width = img.width
          c.height = img.height
          const ctx = c.getContext('2d')!
          ctx.drawImage(img, 0, 0)
          const y0 = Math.floor(img.height * 0.75)
          const d = ctx.getImageData(0, y0, img.width, img.height - y0).data
          let white = 0
          for (let i = 0; i < d.length; i += 4)
            if (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235) white++
          return white
        }, png.toString('base64'))
      },
      { timeout: 10_000 },
    )
    .toBeGreaterThan(30)

  // Survives a reload (stored in session.json).
  await page.reload()
  await page.getByRole('button', { name: /Compose/ }).click()
  await expect(page.getByTestId('cut')).toHaveCount(1)

  // Export offers caption files.
  await page.getByRole('button', { name: /Export/ }).click()
  const srtButton = page.getByRole('button', { name: 'Download SRT' })
  await expect(srtButton).toBeVisible()
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    srtButton.click(),
  ])
  expect(dl.suggestedFilename()).toBe('captions.srt')
  const srt = await readFile((await dl.path())!, 'utf8')
  expect(srt).toContain('Hello,\nfriends')
  expect(srt).toContain('demo.')
})
