# 刘看山北极狐三视图制作 Brief

本 brief 用于指导设计师、3D 建模师或图像生成工具制作刘看山北极狐三视图。`source-image` 目录中的图片是唯一风格参考来源。成稿必须保持样图的简笔画识别：白色一体身体、黑色粗描边、长鼻吻、黑椭圆鼻头、尖耳、点眼、小圆尾和线状四肢。

## 目标

制作一只适合 3D toon 建模的刘看山北极狐 IP。角色需要支持 Three.js 中的 360 度旋转、骨骼动画和道具挂载。Three.js 是浏览器 3D 渲染库。骨骼动画指用骨骼控制模型姿态的动画方式。

## 必须保持的气质

- 呆萌、安静、有陪伴感。
- 白色身体干净完整，像一笔勾出的简笔画角色。
- 头部和身体连成一体，不画明显脖子。
- 鼻吻长而平，黑色鼻头明显。
- 眼睛是黑色点眼或短弧眼。
- 狐耳尖而克制，不能像狗耳、兔耳或写实狐耳。
- 四肢是黑色线条感，但在 3D 中要有可绑定骨骼的结构。
- 尾巴以小圆尾或短弯尾为主，不能做成厚重的大蓬尾。
- 线条简洁，保留手绘简笔画的低细节感。

## 三视图交付

| 视图 | 要求 |
| --- | --- |
| 正面 | 一体化白色身体，两只尖耳，两只点眼，小黑鼻，线状手脚。尾巴可从一侧露出，形状为小圆形或短弯形。 |
| 侧面 | 长鼻吻最清楚，黑鼻头在最前端，单只点眼，鼻吻下缘有简洁口线或下颌线，细线手脚，小圆尾或短弯尾在身后。 |
| 背面 | 不显示鼻吻、鼻头和眼睛。重点显示两只尖耳、完整白色背部轮廓、后侧小尾巴、手臂挂点和两条细腿。 |

## 比例约束

- 角色总高设为 1.0。
- 正面身体宽度控制在 0.52 到 0.66。
- 侧面鼻吻从脸部伸出的长度控制在 0.28 到 0.40。
- 黑色鼻头长度控制在鼻吻长度的 0.28 到 0.38。
- 腿长控制在总高的 0.18 到 0.26。
- 尾巴外露宽度控制在身体宽度的 0.12 到 0.22。
- 黑色外轮廓统一粗细，内部手脚线条可略细。
- 不画细碎毛发、写实阴影和复杂纹理。

## 负面要求

- 不要画成普通狗。
- 不要画成狼。
- 不要画成写实狐狸。
- 不要画成无鼻吻胖球。
- 不要把尾巴画成厚重的大蓬尾。
- 不要只画右朝向侧面。
- 不要把手脚随意贴在身体上。
- 不要堆复杂毛发细节。
- 不要增加复杂眼睛、牙齿、爪子和肌肉结构。
- 不要使用强写实光影和厚涂质感。

## 图像生成提示词

### 中文提示词

白色北极狐 IP 角色，刘看山样图风格，简笔画，黑色粗描边，头身一体的白色圆润身体，长而平的鼻吻，鼻吻前端有黑色椭圆鼻头，黑色点状眼睛，两个克制的尖狐耳，小圆尾或短弯尾，黑色线状手臂和细短腿，呆萌安静，有陪伴感，适合 3D toon 建模，正面、侧面、背面三视图，统一比例，白底，干净线稿，低细节，高识别度。

### English prompt

A white arctic fox mascot in the Liu Kanshan doodle style, simple hand-drawn character, thick black outline, one-piece white rounded body with no visible neck, long flat snout, black oval nose tip at the end of the snout, black dot eyes, small pointed fox ears, small round tail or short curved tail, black line-like arms and short thin legs, calm cute companion personality, suitable for 3D toon modeling, front view side view back view turnaround sheet, consistent proportions, clean white background, minimal details, highly recognizable silhouette.

### Negative prompt

ordinary dog, wolf, realistic fox, no snout, fat ball body, huge fluffy tail, oversized ears, rabbit ears, complex fur, realistic fur texture, detailed eyes, teeth, claws, muscles, messy limbs, only side view, noisy background, detailed painting, heavy shading, aggressive expression, realistic anatomy.
