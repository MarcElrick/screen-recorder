import { expect, test } from '@playwright/test'

test('record, pause, resume and stop produces screen + camera files with a manifest', async ({
  page,
}) => {
  await page.goto('./')
  await expect(
    page.getByRole('button', { name: 'Start recording' }),
  ).toBeDisabled()

  await page.getByRole('button', { name: 'Choose screen' }).click()
  await expect(
    page.getByRole('button', { name: 'Start recording' }),
  ).toBeEnabled()

  // Skip the countdown to keep the test quick.
  await page.getByRole('switch', { name: '3s countdown' }).click()
  await page.getByRole('button', { name: 'Start recording' }).click()
  await expect(page.getByText('Recording', { exact: true })).toBeVisible()

  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Pause' }).click()
  await expect(page.getByText('Paused', { exact: true })).toBeVisible()
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Resume' }).click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByText(/Take saved/)).toBeVisible()

  const manifest = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    for await (const [name, handle] of (
      root as unknown as {
        entries(): AsyncIterable<[string, FileSystemHandle]>
      }
    ).entries()) {
      if (!name.startsWith('take-') || handle.kind !== 'directory') continue
      const dir = handle as FileSystemDirectoryHandle
      const file = await (await dir.getFileHandle('session.json')).getFile()
      const json = JSON.parse(await file.text())
      const sizes: Record<string, number> = {}
      for (const t of json.tracks) {
        sizes[t.file] = (await (await dir.getFileHandle(t.file)).getFile()).size
      }
      return { json, sizes }
    }
    return null
  })

  expect(manifest).not.toBeNull()
  expect(manifest!.json.pauses).toHaveLength(1)
  expect(manifest!.json.durationMs).toBeGreaterThan(2000)
  expect(manifest!.json.tracks.map((t: { kind: string }) => t.kind)).toEqual([
    'screen',
    'camera',
  ])
  for (const size of Object.values(manifest!.sizes))
    expect(size).toBeGreaterThan(0)
})
