# Figma Export Slices (Skill)

通用 Figma 切图导出脚本：按命名规则或节点子树发现图层，导出 PNG/SVG，支持自动英文命名与命名字段映射。

## 前置条件：Figma Token 授权

使用本脚本前，需要先在 Figma 创建 **Personal Access Token**，用于调用 Figma API 读取文件与导出切图。

### 如何创建 Token（他人使用必读）

1. **登录 Figma**（浏览器或桌面端均可）。
2. **打开账号设置**  
   点击左上角头像 → **Settings**（或直接访问 [Figma Account Settings](https://www.figma.com/settings)）。
3. **找到 Personal access tokens**  
   在设置页中滚动到 **Personal access tokens** 区域（通常在靠下位置）。
4. **生成新 Token**  
   - 在「Add a token description」输入框里填写说明（如 `export-slices-skill`）；  
   - 按 **Enter** 或 **Generate token** 生成；  
   - **仅此一次**会显示完整 token 字符串，请立即复制保存（关闭后无法再查看）。
5. **在本地使用**  
   - 在终端执行：`export FIGMA_TOKEN=你复制的token`；  
   - 或在运行命令前加上：`FIGMA_TOKEN=你复制的token`（见下方示例）。

**说明**：Token 代表你的 Figma 账号权限，请勿提交到代码库或分享给他人。仅对你有权访问的 Figma 文件有效。官方文档：[Figma API – Access tokens](https://www.figma.com/developers/api#access-tokens)、[管理 Personal access tokens](https://help.figma.com/hc/en-us/articles/8085703771159-Manage-personal-access-tokens)。

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

## 自动英文命名与命名字段返回给模型

- **自动英文命名**：发现的图层名会按内置词表转成英文再作为导出文件名（例如 `icon/导航/设备状态/切图` → `icon-nav-device-status-slice`）。使用 `--no-english` 可关闭，保留 Figma 原名。
- **与 Figma 图层名做关联并返回给模型**：  
  脚本会生成 **`slices-name-map.json`**（在输出目录下），每条记录包含：
  - `id`：Figma 节点 id  
  - `original`：Figma 图层原名  
  - `english`：转成英文后的文件名（不含 @1x、扩展名）  
  - `files`：实际导出的文件名列表（如 `["icon-nav-device-status-slice@1x.svg"]`）  
  同时在 stdout 末尾会打印一行 **`FIGMA_SLICES_NAME_MAP=...`**（整份 name map 的 JSON 字符串），便于模型从输出中直接拿到「Figma 图层名 ↔ 英文切图名」的对应关系。
