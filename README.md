# Screen Recorder

Free, open-source, local-only screen recorder with synchronised camera and audio feeds. Runs entirely in the browser (no server, no upload), with a path to a native app later.

## Goals

- Record screen + camera (+ audio) in sync, with pause/resume
- Place the camera feed anywhere on the screen recording
- Export the result (Phase 1: WebM via MediaRecorder; MP4 later)
- Zero install; engine kept framework-free so it can be wrapped in Tauri/Electron

## Layout

- `src/engine/` – framework-free capture, compositing and export behind interfaces (`CaptureSource`, `Compositor`, `Encoder`)
- `src/ui/` – Svelte 5 UI

## Development

```sh
pnpm install
pnpm dev          # dev server
pnpm check        # typecheck
pnpm lint         # eslint
pnpm format       # prettier --write
pnpm test         # unit tests (vitest)
pnpm test:e2e     # Playwright (set CHROMIUM_PATH to use a preinstalled Chromium)
pnpm build
```

Status: Record, Compose and Export all work. Takes are recorded as separate screen and camera WebM files (repaired with a duration and seek index on stop), previewed in Compose with WebCodecs in a worker, and exported as MP4 or WebM with WebCodecs (H.264 where the browser can encode it, otherwise VP9) muxed with mediabunny.

## License

MIT
