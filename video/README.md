# Chroni video

A 45-second promo for Chroni, with captions and no voice. It is 1920×1080 at 30 fps.

- `scene.html` holds the whole animation. Each frame is drawn by `renderAt(t)` for a time `t` in seconds. Open the file in a browser to watch it loop, or add `?t=12` to freeze on one moment.
- The build-log scene uses the same log as `bench/demo.sh` and shows what Chroni's `squeeze()` really outputs for it (896 lines down to 18, 11.5k tokens down to 182).
- `render.mjs` steps through every frame in Chrome and pipes the frames to ffmpeg.

```bash
./build.sh                  # -> out/chroni-45s.mp4
./build.sh stills 3,12,40   # -> out/still-<t>.png
```

To change the wording, edit `CAPTIONS` in `scene.html`. To change the timing, edit `SCENES`.
