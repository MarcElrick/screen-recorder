import { expect, it } from 'vitest'
import { formatTime } from './format'

it('formats mm:ss and h:mm:ss', () => {
  expect(formatTime(0)).toBe('00:00')
  expect(formatTime(65_900)).toBe('01:05')
  expect(formatTime(3_725_000)).toBe('1:02:05')
})
