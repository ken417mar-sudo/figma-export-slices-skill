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
  node scripts/export-slices.mjs \\
    --token <FIGMA_TOKEN> \\
    --file <FIGMA_FILE_KEY> \\
    --slices-file <path/to/slices.json> \\
    --out <output/dir> \\
    --scales 2,3

Options:
  --token         Figma personal access token (or set FIGMA_TOKEN)
  --token-stdin   Read token from stdin (or set FIGMA_TOKEN_STDIN=1)
  --file          Figma file key (or set FIGMA_FILE_KEY)
  --node-id       Optional node id to limit discovery to this subtree (e.g. 604:2915 or 604-2915)
  --slices        JSON string with slices array (or set FIGMA_SLICES)
  --slices-file   Path to JSON file with slices array (or set FIGMA_SLICES_FILE)
  --discover      Auto-discover nodes to export from the Figma file
  --name-regex    Regex for node names to export (or set FIGMA_NAME_REGEX)
  --page-regex    Regex for page names to scan (or set FIGMA_PAGE_REGEX)
  --out           Output directory (or set OUTPUT_DIR). Default: ./slices
  --scales        Comma-separated export scales. Default: 2,3
  --format        png (default). Override with FIGMA_FORMAT
  --no-english    Disable auto English naming (keep original names)
  --name-map      Write name mapping JSON to this path (default: <out>/slices-name-map.json)
  --help          Show this message

Slices JSON format:
  [
    { "id": "123:456", "name": "logo" },
    { "id": "123:789", "name": "icon-home" }
  ]

Discovery rules:
  - If --discover is set and --name-regex is provided, export nodes whose names match the regex.
  - If --discover is set and no --name-regex is provided, export nodes with export settings.

Naming:
  - By default, slice names are auto-converted to English (e.g. 图标/查看/切图 -> icon-view-slice).
  - Use --no-english to keep original names. The name mapping (original -> english, id, files) is
    written to <out>/slices-name-map.json and printed as FIGMA_SLICES_NAME_MAP for the model.
`;

if (hasArg("--help")) {
  console.log(HELP);
  process.exit(0);
}

const TOKEN_FROM_ARGS = getArg("--token");
const TOKEN_STDIN = hasArg("--token-stdin") || process.env.FIGMA_TOKEN_STDIN === "1";
const FILE_KEY = getArg("--file") || process.env.FIGMA_FILE_KEY;
const NODE_ID_RAW = getArg("--node-id") || process.env.FIGMA_NODE_ID;
const NODE_ID = NODE_ID_RAW ? String(NODE_ID_RAW).replace(/-/g, ":") : null;
const SLICES_RAW = getArg("--slices") || process.env.FIGMA_SLICES;
const SLICES_FILE = getArg("--slices-file") || process.env.FIGMA_SLICES_FILE;
const DISCOVER = hasArg("--discover") || process.env.FIGMA_DISCOVER === "1";
const NAME_REGEX_RAW = getArg("--name-regex") || process.env.FIGMA_NAME_REGEX;
const PAGE_REGEX_RAW = getArg("--page-regex") || process.env.FIGMA_PAGE_REGEX;
const OUTPUT_DIR = getArg("--out") || process.env.OUTPUT_DIR || path.resolve(process.cwd(), "slices");
const FORMAT = getArg("--format") || process.env.FIGMA_FORMAT || "png";
const SCALES_RAW = getArg("--scales") || process.env.FIGMA_SCALES || "2,3";
const USE_ENGLISH_NAMES = !hasArg("--no-english") && process.env.FIGMA_NO_ENGLISH !== "1";
const NAME_MAP_PATH = getArg("--name-map") || process.env.FIGMA_NAME_MAP_PATH || null;

const parseSlices = (json) => {
  const data = JSON.parse(json);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.slices)) return data.slices;
  throw new Error("Invalid slices JSON. Expected array or { slices: [...] }.");
};

const parseRegex = (raw) => {
  if (!raw) return null;
  try {
    return new RegExp(raw);
  } catch (err) {
    throw new Error(`Invalid regex '${raw}': ${err.message}`);
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

// 常见设计/UI 中文 → 英文（用于切图文件名）
const NAME_ZH_TO_EN = {
  切图: "slice",
  图标: "icon",
  查看: "view",
  发送: "send",
  分析: "analyze",
  跑数: "run",
  导航: "nav",
  设备状态: "device-status",
  特色功能: "features",
  安全防护: "security",
  空间清理: "cleanup",
  原厂驱动: "driver",
  联想服务: "service",
  软件商店: "store",
  头像: "avatar",
  工具栏: "toolbar",
  下拉: "dropdown",
  最小化: "minimize",
  关闭: "close",
  弹窗拦截: "popup-block",
  查杀图标: "scan-icon",
  隔离图标: "quarantine-icon",
  信任图标: "trust-icon",
  浏览器: "browser",
  保护状态: "protection",
  状态: "status",
  图片: "image",
  logo: "logo",
  icon: "icon",
  image: "image",
};

const toEnglishSegment = (segment) => {
  const s = String(segment).trim();
  if (!s) return "";
  const en = NAME_ZH_TO_EN[s];
  if (en) return en;
  if (/^[a-zA-Z0-9_-]+$/.test(s)) return s.toLowerCase();
  return s;
};

const toEnglishName = (rawName) => {
  if (!rawName || !USE_ENGLISH_NAMES) return rawName;
  const parts = String(rawName)
    .split(/[-/\s]+/)
    .map(toEnglishSegment)
    .filter(Boolean);
  return parts.join("-") || rawName;
};

const safeName = (name, fallback) => {
  const base = String(name || "")
    .trim()
    .replace(/[\\/]/g, "-")
    .replace(/[<>:"|?*]/g, "")
    .replace(/\s+/g, "-");
  return base || fallback;
};

const uniquify = (names, base) => {
  const count = (names.get(base) || 0) + 1;
  names.set(base, count);
  return count === 1 ? base : `${base}-${count}`;
};

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8").trim();
};

const fetchJson = async (url, token) => {
  const res = await fetch(url, {
    headers: { "X-Figma-Token": token },
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

const discoverSlices = async (token) => {
  const nameRegex = parseRegex(NAME_REGEX_RAW);
  const pageRegex = parseRegex(PAGE_REGEX_RAW);
  const found = [];

  const shouldExport = (node) => {
    if (node.type === "DOCUMENT" || node.type === "CANVAS") return false;
    if (nameRegex) return nameRegex.test(node.name || "");
    return Array.isArray(node.exportSettings) && node.exportSettings.length > 0;
  };

  const walk = (node) => {
    if (!node) return;
    if (shouldExport(node)) {
      found.push({ id: node.id, name: node.name || "" });
    }
    if (Array.isArray(node.children)) {
      node.children.forEach(walk);
    }
  };

  if (NODE_ID) {
    const nodesRes = await fetchJson(
      `https://api.figma.com/v1/files/${FILE_KEY}/nodes?ids=${encodeURIComponent(NODE_ID)}`,
      token
    );
    const nodeData = nodesRes?.nodes?.[NODE_ID];
    if (!nodeData?.document) {
      throw new Error(`Node ${NODE_ID} not found or not accessible.`);
    }
    walk(nodeData.document);
  } else {
    const file = await fetchJson(`https://api.figma.com/v1/files/${FILE_KEY}`, token);
    const pages = file?.document?.children || [];
    const targets = pageRegex ? pages.filter((page) => pageRegex.test(page.name || "")) : pages;
    targets.forEach(walk);
  }

  if (found.length === 0) {
    const rule = nameRegex ? `name regex '${NAME_REGEX_RAW}'` : "export settings";
    throw new Error(`No nodes found using ${rule}.`);
  }

  const seen = new Map();
  return found.map((node) => {
    const fallback = `slice-${node.id.replace(/[:]/g, "-")}`;
    const baseRaw = toEnglishName(node.name || "") || node.name || "";
    const base = safeName(baseRaw, fallback);
    const unique = uniquify(seen, base);
    return { id: node.id, name: unique, originalName: node.name || "" };
  });
};

const loadSlices = async (token) => {
  if (SLICES_FILE) {
    const text = await fs.readFile(SLICES_FILE, "utf8");
    return parseSlices(text);
  }
  if (SLICES_RAW) {
    return parseSlices(SLICES_RAW);
  }
  if (DISCOVER) {
    return discoverSlices(token);
  }
  return undefined;
};

const validateSlices = (slices) => {
  if (!Array.isArray(slices) || slices.length === 0) {
    throw new Error("No slices provided. Use --slices/--slices-file or --discover.");
  }
  for (const slice of slices) {
    if (!slice || typeof slice.id !== "string" || typeof slice.name !== "string") {
      throw new Error("Each slice must have string fields: id, name.");
    }
    if (slice.originalName === undefined) slice.originalName = slice.name;
  }
};

const exportScale = async (token, slices, scale) => {
  const ids = slices.map((slice) => slice.id).join(",");
  const url = `https://api.figma.com/v1/images/${FILE_KEY}?ids=${encodeURIComponent(ids)}&format=${FORMAT}&scale=${scale}`;
  const data = await fetchJson(url, token);
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
  let token = TOKEN_FROM_ARGS || process.env.FIGMA_TOKEN;
  if (!token && TOKEN_STDIN) {
    token = await readStdin();
  }

  if (!token) {
    console.error("Missing FIGMA_TOKEN. Use --token, --token-stdin, or set FIGMA_TOKEN.");
    console.log(HELP);
    process.exit(1);
  }
  if (!FILE_KEY) {
    console.error("Missing FIGMA_FILE_KEY. Use --file or set FIGMA_FILE_KEY.");
    console.log(HELP);
    process.exit(1);
  }

  const slices = await loadSlices(token);
  validateSlices(slices);

  const scales = parseScales(SCALES_RAW);
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  for (const scale of scales) {
    await exportScale(token, slices, scale);
  }

  const nameMap = slices.map((s) => ({
    id: s.id,
    original: s.originalName ?? s.name,
    english: s.name,
    files: scales.map((scale) => `${s.name}@${scale}x.${FORMAT}`),
  }));
  const mapPath = NAME_MAP_PATH || path.join(OUTPUT_DIR, "slices-name-map.json");
  await fs.writeFile(mapPath, JSON.stringify(nameMap, null, 2), "utf8");
  console.log(`Name map written to ${mapPath}`);
  console.log("FIGMA_SLICES_NAME_MAP=" + JSON.stringify(JSON.stringify(nameMap)));
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
