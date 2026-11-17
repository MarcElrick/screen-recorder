import { expect, test } from '@playwright/test'

// Exercises the record-in-memory, write-on-stop path (used when a browser has
// no createWritable) via `?storage=memory`.
test('in-memory take is written to browser storage on stop', async ({
  page,
}) => {
  await page.goto('./?storage=memory')
  await page.getByRole('button', { name: 'Choose screen' }).click()
  await page.getByRole('switch', { name: '3s countdown' }).click()
  await page.getByRole('button', { name: 'Start recording' }).click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByText(/Take saved/)).toBeVisible()
  await expect(page.getByText(/kept in memory/)).toHaveCount(0)

  const sizes = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const out: Record<string, number> = {}
    for await (const [name, h] of (
      root as unknown as {
        entries(): AsyncIterable<[string, FileSystemHandle]>
      }
    ).entries()) {
      if (!name.startsWith('take-') || h.kind !== 'directory') continue
      for await (const [fname, fh] of (
        h as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }
      ).entries()) {
        out[fname] = (await (fh as FileSystemFileHandle).getFile()).size
      }
    }
    return out
  })
  expect(sizes['session.json']).toBeGreaterThan(0)
  expect(sizes['screen.webm']).toBeGreaterThan(0)
})
