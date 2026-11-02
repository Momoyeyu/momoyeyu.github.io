# 相册布局预览

本地预览入口：`/design/albums/`。该页面只在开发环境生成，正式构建不输出。

- `#map`：旅迹地图，地点选择与相册预览联动。
- `#gallery`：横向展廊，滚动吸附与箭头浏览。
- `#index`：底片索引，目录选择与大图、缩略图联动。

三版采用现有配色与真实照片。资源页当前的相册入口暂不替换，等待选定。

参考：

- https://ungetsu.net/photos/ ，查看摄影页面、PhotoAtlas 脚本与样式，参考地点导航和相册组织。
- https://gsap.com/showcase/ ，浏览作品布局与交互方向。
- https://guillaumecolombel.fr/ ，查看目录与视觉内容的组织方式。

地图轮廓来自 Natural Earth 110m Admin 0 Countries，公开领域数据，经东亚区域投影简化为 SVG 路径。来源：https://github.com/nvkelso/natural-earth-vector
