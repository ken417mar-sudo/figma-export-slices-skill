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
- Format: `svg` (SVG-first; falls back to PNG automatically when Figma can only produce a raster asset)
- Scales: `1` for SVG (resolution-independent), `2,3` for PNG/WebP

## currentColor mode (--current-color)
| Mode | Behaviour |
|------|-----------|
| `auto` *(default)* | Apply `currentColor` when the SVG uses **≤ 1** distinct non-transparent color (monochrome). Multi-color SVGs keep authored colors. |
| `always` | Replace every `fill`/`stroke` with `currentColor` regardless of color count. |
| `never` | Keep all authored colors — useful for brand logos or fixed-palette illustrations. |

## Notes
- Provide slices via `--slices` (JSON string) or `--slices-file` (file path).
- If `--discover` is set without `--name-regex`, nodes with export settings are used.
- If `--discover` is set with `--name-regex`, nodes matching the regex are used.

### Icon export rules (enforced by the script)
1. **SVG first** — `--format svg` is the default. Only use `--format png` / `--format webp` when SVG is genuinely not appropriate for the target platform.
2. **Auto raster fallback** — If Figma can only produce an SVG that wraps a `<image>` bitmap (e.g. the source layer is a rasterised photo), the script automatically re-exports the node as PNG @2x and logs a warning. Disable with `--no-svg-fallback`.
3. **Complete icon export** — During discovery, if a matched node is a bare VECTOR / ELLIPSE / BOOLEAN_OPERATION leaf it is automatically promoted to its nearest parent COMPONENT / FRAME / GROUP so the exported asset is the whole icon, not a single path fragment.
4. **currentColor for monochrome icons** — In `auto` mode (default), the script checks each exported SVG for the number of distinct colors. Monochrome SVGs get all `fill` / `stroke` values replaced with `currentColor` so they follow theme / interaction state in code. Multi-color, brand, or fixed-palette SVGs are left untouched.
5. **Multi-color SVGs keep authored colors** — Do not force `currentColor` on icons that intentionally use multiple colors (logos, illustrations, status badges). Use `--current-color=never` to override completely.
