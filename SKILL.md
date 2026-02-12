---
name: figma-export-slices
description: "Download/export Figma slices (切图) using the bundled export script. Use when asked to refresh slice assets, auto-discover exportable layers, or export Figma images for any project."
---

# Figma Slice Export

## Quick start (auto-discover)
If the Figma file already marks exportable layers (export settings), you can export them directly:

```bash
FIGMA_TOKEN=xxxx \
FIGMA_FILE_KEY=<FILE_KEY> \
OUTPUT_DIR=./slices \
node scripts/export-slices.mjs --discover
```

## Quick start (name regex)
Export nodes that match a naming rule:

```bash
FIGMA_TOKEN=xxxx \
FIGMA_FILE_KEY=<FILE_KEY> \
OUTPUT_DIR=./slices \
node scripts/export-slices.mjs --discover --name-regex "切图|icon"
```

Optionally limit to specific pages:

```bash
node scripts/export-slices.mjs \
  --token xxxx \
  --file <FILE_KEY> \
  --discover \
  --page-regex "首页|主页面" \
  --out ./slices
```

## Quick start (explicit slices)
```bash
node scripts/export-slices.mjs \
  --token xxxx \
  --file <FILE_KEY> \
  --slices-file ./slices.json \
  --out ./slices \
  --scales 2,3
```

## Limit to a node (--node-id)
Export only layers under a specific frame (get node id from Figma URL `node-id=604-2915`):

```bash
node scripts/export-slices.mjs --discover --node-id 604-2915 \
  --name-regex '^icon' --format svg --file <FILE_KEY> --out ./slices
```

## English naming & name map for model
- By default, layer names are auto-converted to English (e.g. 图标/切图 → icon-slice). Use `--no-english` to keep original names.
- A mapping file `slices-name-map.json` is written to the output dir (and `FIGMA_SLICES_NAME_MAP` printed to stdout) with `id`, `original`, `english`, `files` for each slice.

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
