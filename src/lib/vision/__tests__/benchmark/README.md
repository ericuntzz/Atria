## Localization Benchmark

This folder holds the manifest and fixtures for inspection localization benchmarking.

Run:

```bash
npm run benchmark:localization -- --manifest src/lib/vision/__tests__/benchmark/manifest.json
```

Expected pair categories:

- `true_match`
- `same_room_wrong_view`
- `adjacent_room`
- `low_texture`
- `lighting_shift`
- `reflective`

Metrics to watch:

- `FAR` — false accept rate
- `FRR` — false reject rate

Recommended first dataset:

- ~10 `true_match` pairs
- ~10 `same_room_wrong_view` pairs
- ~5 `adjacent_room` pairs
- ~5 `low_texture` pairs
- ~5 `lighting_shift` pairs
- ~5 `reflective` pairs

Use [manifest.example.json](./manifest.example.json) as the template.
