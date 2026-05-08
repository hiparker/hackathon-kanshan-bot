# 3D 模型资产目录

本目录用于存放后续 3D 角色资产和模型生产说明。正式角色本体应通过 Blender 制作，并导出为 Three.js 可接入的 `glTF` 或 `GLB`。

二进制 GLB 不进 git，本仓库只追踪 `manifest.json`。开发者本地通过拉取脚本把模型下载到本目录。

## 资产清单

`manifest.json` 列出当前需要拉取的所有模型：

```json
{
  "models": [
    {
      "id": "kanshan-model-v5",
      "fileName": "kanshan-model-v5.glb",
      "url": "https://upload.bedebug.com/hackathon-2026/kanshan-model-v5.glb"
    }
  ]
}
```

## 拉取命令

```bash
pnpm assets:fetch          # 已存在则跳过
pnpm assets:fetch -- --force  # 强制重新下载
```

`pnpm install` 完成后会自动通过 `postinstall` 钩子运行 `assets:fetch`，所以正常情况下无需手动调用。新增模型时只追加 `manifest.json` 条目即可，脚本会按文件是否存在做幂等处理。

## 建议目录

| 目录 | 说明 |
| --- | --- |
| `blender` | `.blend` 源文件。 |
| `exports` | 导出的 `.gltf`、`.glb` 或 `.fbx` 文件。 |
| `textures` | 贴图、toon ramp、描边相关贴图。 |
| `materials` | 材质说明和 Three.js toon 材质配置记录。 |
| `rig` | 骨骼命名、绑定说明和权重检查记录。 |

## 导出要求

- 模型必须保持修身北极狐比例。
- 坐标原点位于角色脚底中心。
- 朝向默认使用正面朝向摄像机，鼻吻方向通过模型旋转表达。
- 骨骼命名必须与 `assets/concept/kanshan-arctic-fox-spec.md` 一致。
- 第一批动画片段必须以独立 clip 导出。
- 导出前清理未使用材质、隐藏物体和临时网格。

## Three.js 接入要求

- 优先使用 `.glb` 保持模型、骨骼、材质和动画集中。
- Toon 材质和黑色描边可在 Three.js 内重建。
- 道具挂点应作为骨骼子节点或空节点导出。
