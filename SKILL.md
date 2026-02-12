---
name: figma-export-slices
description: "Download/export Figma slices (切图) using the bundled export script. Use when asked to refresh slice assets, auto-discover exportable layers, or export Figma images for any project."
---

# Figma Slice Export

## Quick start (auto-discover)
If the Figma file already marks exportable layers (export settings), you can export them directly:

```bash
FIGMA_TOKEN=xxxx \
FIGMA_FILE_KEY=abcd1234 \
OUTPUT_DIR=./slices \
node scripts/export-slices.mjs --discover
```

## Quick start (name regex)
Export nodes that match a naming rule:

```bash
FIGMA_TOKEN=xxxx \
FIGMA_FILE_KEY=abcd1234 \
OUTPUT_DIR=./slices \
node scripts/export-slices.mjs --discover --name-regex "切图|icon"
```

Optionally limit to specific pages:

```bash
node scripts/export-slices.mjs \
  --token xxxx \
  --file abcd1234 \
  --discover \
  --page-regex "首页|主页面" \
  --out ./slices
```

## Quick start (explicit slices)
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
- If `--discover` is set without `--name-regex`, nodes with export settings are used.
- If `--discover` is set with `--name-regex`, nodes matching the regex are used.
