import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const hasArg = (name) => args.includes(name);
const getArg = (name) => {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
};

const HELP = `Figma slice exporter

Usage:
  node scripts/export-slices.mjs \
    --token <FIGMA_TOKEN> \
    --file <FIGMA_FILE_KEY> \
    --slices-file <path/to/slices.json> \
    --out <output/dir> \
    --scales 2,3

Options:
  --token        Figma personal access token (or set FIGMA_TOKEN)
  --file         Figma file key (or set FIGMA_FILE_KEY)
  --slices       JSON string with slices array (or set FIGMA_SLICES)
  --slices-file  Path to JSON file with slices array (or set FIGMA_SLICES_FILE)
  --out          Output directory (or set OUTPUT_DIR). Default: ./slices
  --scales       Comma-separated export scales. Default: 2,3
  --format       png (default). Override with FIGMA_FORMAT
  --help         Show this message

Slices JSON format:
  [
    { "id": "123:456", "name": "logo" },
    { "id": "123:789", "name": "icon-home" }
  ]
`;

if (hasArg("--help")) {
  console.log(HELP);
  process.exit(0);
}

const TOKEN = getArg("--token") || process.env.FIGMA_TOKEN;
const FILE_KEY = getArg("--file") || process.env.FIGMA_FILE_KEY;
const SLICES_RAW = getArg("--slices") || process.env.FIGMA_SLICES;
const SLICES_FILE = getArg("--slices-file") || process.env.FIGMA_SLICES_FILE;
const OUTPUT_DIR = getArg("--out") || process.env.OUTPUT_DIR || path.resolve(process.cwd(), "slices");
const FORMAT = getArg("--format") || process.env.FIGMA_FORMAT || "png";
const SCALES_RAW = getArg("--scales") || process.env.FIGMA_SCALES || "2,3";

const parseSlices = (json) => {
  const data = JSON.parse(json);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.slices)) return data.slices;
  throw new Error("Invalid slices JSON. Expected array or { slices: [...] }.");
};

const loadSlices = async () => {
  if (SLICES_FILE) {
    const text = await fs.readFile(SLICES_FILE, "utf8");
    return parseSlices(text);
  }
  if (SLICES_RAW) {
    return parseSlices(SLICES_RAW);
  }
  return undefined;
};

const validateSlices = (slices) => {
  if (!Array.isArray(slices) || slices.length === 0) {
    throw new Error("No slices provided. Use --slices or --slices-file.");
  }
  for (const slice of slices) {
    if (!slice || typeof slice.id !== "string" || typeof slice.name !== "string") {
      throw new Error("Each slice must have string fields: id, name.");
    }
  }
};

const parseScales = (raw) => {
  const values = String(raw)
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (values.length === 0) {
    throw new Error("Invalid scales. Example: --scales 2,3");
  }
  return values;
};

const fetchJson = async (url) => {
  const res = await fetch(url, {
    headers: { "X-Figma-Token": TOKEN },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Figma API error ${res.status}: ${text}`);
  }
  return res.json();
};

const downloadFile = async (url, targetPath) => {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Download failed ${res.status}: ${text}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  await fs.writeFile(targetPath, Buffer.from(arrayBuffer));
};

const exportScale = async (slices, scale) => {
  const ids = slices.map((slice) => slice.id).join(",");
  const url = `https://api.figma.com/v1/images/${FILE_KEY}?ids=${encodeURIComponent(ids)}&format=${FORMAT}&scale=${scale}`;
  const data = await fetchJson(url);
  if (data.err) {
    throw new Error(data.err);
  }
  const images = data.images || {};

  for (const slice of slices) {
    const imageUrl = images[slice.id];
    if (!imageUrl) {
      console.warn(`Missing image URL for ${slice.id} (${slice.name}) at ${scale}x`);
      continue;
    }
    const filename = `${slice.name}@${scale}x.${FORMAT}`;
    const outPath = path.join(OUTPUT_DIR, filename);
    await downloadFile(imageUrl, outPath);
    console.log(`Saved ${filename}`);
  }
};

const main = async () => {
  if (!TOKEN) {
    console.error("Missing FIGMA_TOKEN. Use --token or set FIGMA_TOKEN.");
    console.log(HELP);
    process.exit(1);
  }
  if (!FILE_KEY) {
    console.error("Missing FIGMA_FILE_KEY. Use --file or set FIGMA_FILE_KEY.");
    console.log(HELP);
    process.exit(1);
  }

  const slices = await loadSlices();
  validateSlices(slices);

  const scales = parseScales(SCALES_RAW);
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  for (const scale of scales) {
    await exportScale(slices, scale);
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
