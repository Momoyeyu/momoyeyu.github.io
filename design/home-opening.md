# 首页开场设计

首页以「Code Is Elegant」和墨羽开场，下方文案为「在字里行间，理清思绪。」。羽毛沿羽轴向羽尖逐渐晕散，文章卡片在退场完成前接入；没有第二幕书页。

## 视觉

全站共用 [五色基础色表](palette.md)，深浅主题交换色彩角色。首屏、导航和文章区采用同一背景；标题延续衬线字体，正文保留无衬线。羽毛由透明素材 `/img/home/ink-feather.webp` 提供，水墨效果由原生 WebGL 实现，不引入动画库。

水墨渲染使用连续低频噪声扭曲、软边侵蚀与相邻纹理晕染，形成墨色沿羽轴化开的过程。画布只覆盖原图区域，0 为完整素材，1 为透明，反向滚动会沿原路径还原。纹理只上传一次，静止或离屏时不持续绘制，页面替换时释放 WebGL 资源。低动态模式、手机与图形上下文不可用时显示静态羽毛。

## 滚动节奏

- 桌面开场外层 190svh，内部 sticky 舞台 100svh。
- 进度 0–0.10 保留完整首屏，0.10–0.90 完成水墨退场。
- 视觉进度采用 response 6 的指数跟随，保持浏览器原生滚动。
- 文章区与舞台重叠 80svh，实际在首屏下方 110svh 开始，前沿有 6rem 柔和过渡。
- 标题在原始进度 0.22–0.75 淡出。文章卡片开始进入时，羽毛仍有完整可见部分，避免空屏。
- 手机和低动态模式不采用长滚动与重叠，首屏一屏后接文章。

## 参考代码

实际阅读了 ungetsu 的 [GalleryEntrance 开场脚本](https://ungetsu.net/_astro/GalleryEntrance.astro_astro_type_script_index_0_lang.B9zjIjEr.js) 和 [lunar-scene 渲染脚本](https://ungetsu.net/_astro/lunar-scene.CsDXPU7n.js)。其节奏由阅读停留距离、指数跟随及目的场景提前接入共同形成。也核对了本地 momo 的 `site/docs/.vitepress/theme/scroll-beats.mjs` 和 `scroll-follow.mjs`，参考其停留区间与原生滚动跟随结构。

## 侧栏与桌宠

侧栏标题旁使用无文字小图标；收起后保留 20px 窄边层。轨道在 320ms 内从 15rem 变为 1.25rem，正文同步扩宽，折叠内容设为 inert；低动态模式取消动画。1440px 下正文宽度依次为双开 880px、单收 1100px、双收 1320px。

Komari 始终保留立绘，收窄点击热区。与真实控件重叠时只让点击穿透，避免整只角色随滚动闪隐。六张表情和台词均保留。

## 原始素材提示词

```text
Use case: stylized-concept. Asset type: high-end personal technical blog opening artwork, an isolated object for a scroll-driven particle morph. Primary request: embody the Chinese pen name 墨末夜羽 (ink, traces, night, feather) with one extraordinarily beautiful floating raven feather. A single large natural feather, elegant gently curving silhouette, slender bare quill at lower left and finely tapered tip toward upper right, diagonal about 40 degrees. Deep ink-indigo barbs with delicate silver-blue edge light, subtly iridescent graphite, tactile fine vanes and soft wisps, a few naturally detached tiny ink flecks near the tip. More like a photographed specimen and a subtle Chinese ink painting than a shiny 3D icon. Gallery-quality quiet beauty. Soft broad daylight; designed to sit on a cool pearl-gray light webpage, so its dark silhouette and delicate edges must read beautifully on pale backgrounds. Entire feather visible with generous transparent margin, centered, no cropping, large enough to see intricate structure. Actual transparent background with clean alpha preserving wisps. No cast floor shadow, no pedestal, no moon, no birds, no human or anime character, no border, no typography, no watermark. One object only, not a poster or website screenshot. Square composition.
```

## 验证

- `make check`：66 个 Astro 文件无诊断，18 项测试通过。
- 生产构建 84 页，Pagefind 索引 70 页，实际搜索得到结果。
- 水墨起始、晕散、反向滚动与文章提前接入经过浏览器逐段验证。
- 侧栏四种状态、动画中间宽度、无文字控件与窄边层点击均已验证。
- Komari 保持 opacity 1，底下按钮能收到点击；六种立绘均成功加载并显示台词。
- 390px 无横向溢出，手机与低动态模式的首屏一屏后直接接入正文。
