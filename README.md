# Figma 切图导出

从 [figma-export-slices](https://github.com/ken417mar-sudo/figma-export-slices) 安装的导出脚本。

## 使用前

1. 在 Figma 中创建 [Personal Access Token](https://www.figma.com/developers/api#access-tokens)
2. 设置环境变量：`export FIGMA_TOKEN=你的token`

## 本项目中使用的导出命令

导出「名称以 `/切图` 结尾」的图层，生成 @1x 和 @2x PNG：

```bash
cd figma-export-slices
FIGMA_TOKEN=你的token \
FIGMA_FILE_KEY=nyq9YWeE2nC9WoXXu2FfqD \
OUTPUT_DIR=../slices \
node scripts/export-slices.mjs --discover --name-regex '\/切图$' --scales 1,2
```

输出目录：项目下的 `slices/`。
