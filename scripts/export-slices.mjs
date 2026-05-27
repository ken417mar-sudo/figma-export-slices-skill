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

const HELP = `Figma slice exporter (SVG-first)

Usage:
  node scripts/export-slices.mjs \\
    --token <FIGMA_TOKEN> \\
    --file <FIGMA_FILE_KEY> \\
    --slices-file <path/to/slices.json> \\
    --out <output/dir>

Options:
  --token            Figma personal access token (or set FIGMA_TOKEN)
  --token-stdin      Read token from stdin (or set FIGMA_TOKEN_STDIN=1)
  --file             Figma file key (or set FIGMA_FILE_KEY)
  --node-id          Optional node id to limit discovery to this subtree (e.g. 604:2915 or 604-2915)
  --slices           JSON string with slices array (or set FIGMA_SLICES)
  --slices-file      Path to JSON file with slices array (or set FIGMA_SLICES_FILE)
  --discover         Auto-discover nodes to export from the Figma file
  --name-regex       Regex for node names to export (or set FIGMA_NAME_REGEX)
  --page-regex       Regex for page names to scan (or set FIGMA_PAGE_REGEX)
  --out              Output directory (or set OUTPUT_DIR). Default: ./slices
  --format           svg (default). Use png/webp to force raster. (or set FIGMA_FORMAT)
  --scales           Comma-separated export scales. Default: 1 for SVG, 2,3 for raster
  --no-svg-fallback  Disable auto PNG fallback when SVG contains a raster <image>
  --current-color    currentColor mode: auto|always|never  (default: auto)
                       auto   – apply if SVG is monochrome
                       always – always apply (single-color theming)
                       never  – keep all authored colors
  --no-english       Disable auto English naming (keep original names)
  --name-map         Write name mapping JSON to this path (default: <out>/slices-name-map.json)
  --help             Show this message

Icon export rules:
  - SVG is the default format. Only fall back to raster when:
      · The Figma node is raster-only (SVG contains <image>), OR
      · You explicitly pass --format png/webp.
  - If an icon is composed of multiple vector sub-nodes, the script walks UP
    to the parent COMPONENT / COMPONENT_SET / GROUP / FRAME so the full icon
    is exported — not just a single fragment.
  - Monochrome icons (auto-detected, or --current-color=always): stroke/fill
    are replaced with currentColor so the icon follows theme / interaction state.
  - Multi-color, brand, or fixed-color SVGs keep their authored colors
    (--current-color=never, or auto-detected as multi-color).

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
// SVG is the default format; fall back to raster only when explicitly requested
// or when the source asset is raster-only (detected automatically).
const FORMAT = getArg("--format") || process.env.FIGMA_FORMAT || "svg";
const SVG_MODE = FORMAT === "svg";
// Scales: SVG is resolution-independent — default to 1x only.
// For raster formats keep the classic 2x,3x default.
const DEFAULT_SCALES = SVG_MODE ? "1" : "2,3";
const SCALES_RAW = getArg("--scales") || process.env.FIGMA_SCALES || DEFAULT_SCALES;
const NO_SVG_FALLBACK = hasArg("--no-svg-fallback") || process.env.FIGMA_NO_SVG_FALLBACK === "1";
// currentColor mode: auto | always | never
const CURRENT_COLOR_MODE =
  getArg("--current-color") || process.env.FIGMA_CURRENT_COLOR_MODE || "auto";
const USE_ENGLISH_NAMES = !hasArg("--no-english") && process.env.FIGMA_NO_ENGLISH !== "1";
const NAME_MAP_PATH = getArg("--name-map") || process.env.FIGMA_NAME_MAP_PATH || null;

// ---------------------------------------------------------------------------
// SVG post-processing helpers
// ---------------------------------------------------------------------------

/**
 * Return true when the SVG contains a bitmap <image> element, which means
 * Figma could not produce a pure-vector export.  In this case the caller
 * should re-export as PNG/WebP.
 */
const svgIsRaster = (svgText) => /<image\b/i.test(svgText);

/**
 * Collect every non-transparent fill/stroke color used in the SVG.
 * Returns a Set of lower-cased color strings.
 */
const collectSvgColors = (svgText) => {
  const colors = new Set();
  const attrRe = /(?:fill|stroke)="([^"]+)"/g;
  const styleRe = /(?:fill|stroke)\s*:\s*([^;}"'\s]+)/g;
  for (const re of [attrRe, styleRe]) {
    let m;
    while ((m = re.exec(svgText)) !== null) {
      const v = m[1].trim().toLowerCase();
      if (v && v !== "none" && v !== "transparent" && !v.startsWith("url(")) {
        // Normalise hex shorthand so #fff === #ffffff
        colors.add(v.replace(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i, "#$1$1$2$2$3$3"));
      }
    }
  }
  return colors;
};

/**
 * Return true when the SVG uses at most one distinct non-transparent color
 * (monochrome — safe to replace with currentColor).
 */
const svgIsMonochrome = (svgText) => collectSvgColors(svgText).size <= 1;

/**
 * Replace all non-transparent fill/stroke values in the SVG with currentColor.
 * Also removes any hardcoded color inside style="" blocks.
 */
const applyCurrentColor = (svgText) => {
  return svgText
    // Attribute form: fill="…" / stroke="…"
    .replace(/\b(fill|stroke)="(?!none\b|transparent\b)([^"]+)"/g, '$1="currentColor"')
    // Inline style form: fill:…; / stroke:…;
    .replace(/\b(fill|stroke)\s*:\s*(?!none\b|transparent\b)[^;}"'\s]+/g, "$1:currentColor");
};

/**
 * Decide whether to apply currentColor and return the (possibly modified) SVG.
 */
const postProcessSvg = (svgText, sliceName) => {
  if (CURRENT_COLOR_MODE === "never") return svgText;

  const mono = svgIsMonochrome(svgText);

  if (CURRENT_COLOR_MODE === "always" || (CURRENT_COLOR_MODE === "auto" && mono)) {
    console.log(`  → currentColor applied (${mono ? "monochrome" : "forced"}: ${sliceName})`);
    return applyCurrentColor(svgText);
  }

  if (CURRENT_COLOR_MODE === "auto" && !mono) {
    const colors = [...collectSvgColors(svgText)];
    console.log(
      `  → colors kept (multi-color [${colors.slice(0, 4).join(", ")}${colors.length > 4 ? ", …" : ""}]: ${sliceName})`
    );
  }

  return svgText;
};

// ---------------------------------------------------------------------------
// Naming helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Vector-composition helpers
// ---------------------------------------------------------------------------

/**
 * Node types that represent "atomic" vector shapes.
 * If a discovered node is of one of these types it is likely a sub-fragment
 * rather than a complete icon; the parent should be used instead.
 */
const VECTOR_LEAF_TYPES = new Set([
  "VECTOR",
  "LINE",
  "ELLIPSE",
  "STAR",
  "POLYGON",
  "BOOLEAN_OPERATION",
]);

/**
 * Node types that are valid containers for a complete icon.
 */
const ICON_CONTAINER_TYPES = new Set([
  "COMPONENT",
  "COMPONENT_SET",
  "FRAME",
  "GROUP",
  "INSTANCE",
]);

/**
 * Given a node discovered by the name regex, walk UP through the `parentMap`
 * to find the nearest ancestor that is an ICON_CONTAINER_TYPES node.
 * Returns the promoted node (or the original if no promotion is needed).
 */
const promoteToContainer = (node, parentMap) => {
  if (!VECTOR_LEAF_TYPES.has(node.type)) return node;
  let current = node;
  while (current) {
    const parent = parentMap.get(current.id);
    if (!parent) break;
    if (ICON_CONTAINER_TYPES.has(parent.type)) {
      console.log(
        `  → promoted "${node.name}" (${node.type}) → "${parent.name}" (${parent.type})`
      );
      return parent;
    }
    current = parent;
  }
  return node; // no suitable container found; export as-is
};

// ---------------------------------------------------------------------------
// Network helpers
// ---------------------------------------------------------------------------

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

const fetchText = async (url, token) => {
  const res = await fetch(url, {
    headers: token ? { "X-Figma-Token": token } : {},
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Figma API error ${res.status}: ${text}`);
  }
  return res.text();
};

const downloadBinary = async (url, targetPath) => {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Download failed ${res.status}: ${text}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  await fs.writeFile(targetPath, Buffer.from(arrayBuffer));
};

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

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

const discoverSlices = async (token) => {
  const nameRegex = parseRegex(NAME_REGEX_RAW);
  const pageRegex = parseRegex(PAGE_REGEX_RAW);
  const found = [];
  // parentMap: nodeId → parentNode (for vector-promotion)
  const parentMap = new Map();

  const shouldExport = (node) => {
    if (node.type === "DOCUMENT" || node.type === "CANVAS") return false;
    if (nameRegex) return nameRegex.test(node.name || "");
    return Array.isArray(node.exportSettings) && node.exportSettings.length > 0;
  };

  const walk = (node, parent) => {
    if (!node) return;
    if (parent) parentMap.set(node.id, parent);
    if (shouldExport(node)) {
      found.push(node);
    }
    if (Array.isArray(node.children)) {
      node.children.forEach((child) => walk(child, node));
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
    walk(nodeData.document, null);
  } else {
    const file = await fetchJson(`https://api.figma.com/v1/files/${FILE_KEY}`, token);
    const pages = file?.document?.children || [];
    const targets = pageRegex ? pages.filter((page) => pageRegex.test(page.name || "")) : pages;
    targets.forEach((page) => walk(page, null));
  }

  if (found.length === 0) {
    const rule = nameRegex ? `name regex '${NAME_REGEX_RAW}'` : "export settings";
    throw new Error(`No nodes found using ${rule}.`);
  }

  // Promote vector-leaf nodes to their parent containers so we always export
  // a complete icon rather than a single sub-fragment.
  const seen = new Map();
  const promoted = new Map(); // dedup by promoted node id
  for (const node of found) {
    const resolved = promoteToContainer(node, parentMap);
    if (!promoted.has(resolved.id)) {
      promoted.set(resolved.id, { node: resolved, originalName: node.name || "" });
    }
  }

  return [...promoted.values()].map(({ node, originalName }) => {
    const fallback = `slice-${node.id.replace(/[:]/g, "-")}`;
    const baseRaw = toEnglishName(node.name || "") || node.name || "";
    const base = safeName(baseRaw, fallback);
    const unique = uniquify(seen, base);
    return { id: node.id, name: unique, originalName };
  });
};

// ---------------------------------------------------------------------------
// Slice loading / validation
// ---------------------------------------------------------------------------

const parseSlices = (json) => {
  const data = JSON.parse(json);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.slices)) return data.slices;
  throw new Error("Invalid slices JSON. Expected array or { slices: [...] }.");
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

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Export one batch of slices at the given scale in `format`.
 * Returns a map of sliceId → { url, format } for post-processing.
 */
const fetchImageUrls = async (token, slices, scale, format) => {
  const ids = slices.map((s) => s.id).join(",");
  const url = `https://api.figma.com/v1/images/${FILE_KEY}?ids=${encodeURIComponent(ids)}&format=${format}&scale=${scale}`;
  const data = await fetchJson(url, token);
  if (data.err) throw new Error(data.err);
  return data.images || {};
};

/**
 * Download one SVG slice, apply currentColor post-processing, and save.
 * Returns the final format used ("svg" or fallback raster format).
 */
const downloadSvgSlice = async (token, slice, imageUrl, outDir) => {
  const svgText = await fetchText(imageUrl);

  // If the SVG wraps a raster <image>, fall back to PNG unless disabled.
  if (!NO_SVG_FALLBACK && svgIsRaster(svgText)) {
    console.warn(
      `  ⚠ SVG for "${slice.name}" contains a bitmap — falling back to PNG.`
    );
    // Re-request as PNG
    const fallbackUrls = await fetchImageUrls(token, [slice], 2, "png");
    const fallbackUrl = fallbackUrls[slice.id];
    if (fallbackUrl) {
      const filename = `${slice.name}@2x.png`;
      const outPath = path.join(outDir, filename);
      await downloadBinary(fallbackUrl, outPath);
      console.log(`  Saved ${filename} (PNG fallback)`);
      return { format: "png", scales: [2], filename };
    }
    console.warn(`  ⚠ PNG fallback URL missing for "${slice.name}".`);
    return null;
  }

  // Apply currentColor post-processing
  const processed = postProcessSvg(svgText, slice.name);

  const filename = `${slice.name}.svg`;
  const outPath = path.join(outDir, filename);
  await fs.writeFile(outPath, processed, "utf8");
  console.log(`  Saved ${filename}`);
  return { format: "svg", scales: [1], filename };
};

/**
 * Export all slices for a given scale in raster format.
 */
const exportRasterScale = async (token, slices, scale, format, outDir) => {
  const images = await fetchImageUrls(token, slices, scale, format);
  for (const slice of slices) {
    const imageUrl = images[slice.id];
    if (!imageUrl) {
      console.warn(`  ⚠ Missing image URL for ${slice.id} (${slice.name}) at ${scale}x`);
      continue;
    }
    const filename = `${slice.name}@${scale}x.${format}`;
    const outPath = path.join(outDir, filename);
    await downloadBinary(imageUrl, outPath);
    console.log(`  Saved ${filename}`);
  }
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

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

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  // Track final export metadata per slice for the name map.
  const sliceResults = new Map(slices.map((s) => [s.id, { ...s, files: [], finalFormat: FORMAT }]));

  if (SVG_MODE) {
    // --- SVG-first path ---
    console.log(`Exporting ${slices.length} slice(s) as SVG…`);
    const images = await fetchImageUrls(token, slices, 1, "svg");

    for (const slice of slices) {
      const imageUrl = images[slice.id];
      if (!imageUrl) {
        console.warn(`  ⚠ Missing SVG URL for ${slice.id} (${slice.name})`);
        continue;
      }
      const result = await downloadSvgSlice(token, slice, imageUrl, OUTPUT_DIR);
      if (!result) continue;
      const entry = sliceResults.get(slice.id);
      entry.files.push(result.filename);
      entry.finalFormat = result.format;
    }
  } else {
    // --- Explicit raster path ---
    const scales = parseScales(SCALES_RAW);
    console.log(`Exporting ${slices.length} slice(s) as ${FORMAT} @ ${scales.join(",")}x…`);
    for (const scale of scales) {
      await exportRasterScale(token, slices, scale, FORMAT, OUTPUT_DIR);
      for (const slice of slices) {
        const entry = sliceResults.get(slice.id);
        entry.files.push(`${slice.name}@${scale}x.${FORMAT}`);
      }
    }
  }

  // Write name map
  const nameMap = [...sliceResults.values()].map((s) => ({
    id: s.id,
    original: s.originalName ?? s.name,
    english: s.name,
    format: s.finalFormat,
    files: s.files,
  }));
  const mapPath = NAME_MAP_PATH || path.join(OUTPUT_DIR, "slices-name-map.json");
  await fs.writeFile(mapPath, JSON.stringify(nameMap, null, 2), "utf8");
  console.log(`\nName map written to ${mapPath}`);
  console.log("FIGMA_SLICES_NAME_MAP=" + JSON.stringify(JSON.stringify(nameMap)));
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
