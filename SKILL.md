---
name: figma-export-slices
description: "Download/export Figma slices (切图) using the bundled export script. Use when asked to refresh slice assets, update slice IDs, or export Figma images for any project."
---

# Figma Slice Export

## Quick start (env vars)
1. Prepare a slices JSON file.
2. Run the exporter with environment variables.

```bash
FIGMA_TOKEN=xxxx \
FIGMA_FILE_KEY=abcd1234 \
FIGMA_SLICES_FILE=./slices.json \
OUTPUT_DIR=./slices \
node scripts/export-slices.mjs
```

## Quick start (CLI args)
```bash
node scripts/export-slices.mjs \
  --token xxxx \
  --file abcd1234 \
  --slices-file ./slices.json \
  --out ./slices \
  --scales 2,3
```

## Slices JSON format
```json
[
  { "id": "123:456", "name": "logo" },
  { "id": "123:789", "name": "icon-home" }
]
```

## Defaults
- Output directory: `./slices`
- Scales: `2,3`
- Format: `png`

## Notes
- Provide slices via `--slices` (JSON string) or `--slices-file` (file path).
- If the Figma file or slice list changes, update the file key or slices JSON.
