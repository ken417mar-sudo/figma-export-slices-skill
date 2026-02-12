# Figma Export Slices (Skill)

通用 Figma 切图导出脚本：按命名规则或节点子树发现图层，导出 PNG/SVG，支持自动英文命名与命名字段映射。

## 前置条件

1. 在 Figma 创建 [Personal Access Token](https://www.figma.com/developers/api#access-tokens)
2. 设置环境变量：`export FIGMA_TOKEN=你的token`

## 通用用法示例

从 Figma 文件 URL 中取得 **File Key**（`figma.com/design/<FILE_KEY>/...`），然后：

```bash
FIGMA_TOKEN=你的token \
FIGMA_FILE_KEY=<你的文件KEY> \
OUTPUT_DIR=./slices \
node scripts/export-slices.mjs --discover --name-regex '\/切图$' --scales 1,2
```

仅导出某个节点下的图层（节点 ID 来自链接中的 `node-id=604-2915`，传参时可用 `604:2915` 或 `604-2915`）：

```bash
node scripts/export-slices.mjs --discover --node-id 604-2915 \
  --name-regex '^icon' --format svg --scales 1 \
  --file <FILE_KEY> --out ./slices
```

更多选项与说明见 **SKILL.md** 或执行 `node scripts/export-slices.mjs --help`。
