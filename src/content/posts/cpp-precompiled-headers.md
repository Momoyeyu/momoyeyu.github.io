---
title: C++ 预编译头
published: 2023-12-10
description: '用预编译头文件（PCH）大幅减少大型 C++ 项目的编译时间。'
tags: [C++, 编译, 工具链]
category: C++ 进阶
episode: 14
draft: false
lang: 'zh_CN'
---

## 为什么 C++ 编译这么慢

你有没有注意到，哪怕只改了一行代码，C++ 项目重新编译也要等好几秒，甚至几分钟？

原因之一就藏在这几行你每天都在写的代码里：

```cpp
#include <vector>
#include <string>
#include <unordered_map>
#include <memory>
#include <algorithm>
```

C++ 的 `#include` 本质上是**文本展开**。编译器看到 `#include <vector>` 时，会把 `vector` 头文件的全部内容原封不动地插入到当前文件，然后从头解析。

问题在于，这些标准库头文件的规模远超你的想象。`<vector>` 展开后可能有几千行，`<string>` 更多，加上它们相互依赖引入的其他头文件，一个翻译单元（.cpp 文件）展开后轻松达到几十万行。

更关键的是：**每一个 .cpp 文件都要重新解析一遍这些头文件**。有 100 个 .cpp 文件，就要解析 100 遍 `<vector>`。这些标准库头文件根本不会变，但编译器每次都当它们是新的。

这就是预编译头文件要解决的问题。

## PCH 的原理

预编译头文件（Precompiled Header，PCH）的思路很直接：

> 把那些稳定的、不会变的头文件**提前编译一次**，把编译结果缓存到磁盘；后续每次编译直接加载缓存，跳过解析过程。

从编译器的视角来看，PCH 保存的是头文件解析后的中间状态——大致相当于把抽象语法树（AST）序列化到磁盘。下次编译时直接反序列化这个状态，省去了重新解析的开销。

GCC 生成 `.gch` 文件，Clang 和 MSVC 生成 `.pch` 文件，文件体积通常在几十到几百 MB 之间。

核心约束只有一条：**PCH 只适合不经常变动的头文件**。一旦 PCH 对应的头文件发生变化，整个 PCH 就必须重新生成，会触发全量重编译。标准库头文件、成熟的第三方库（如 Eigen、Boost）是 PCH 的理想候选，自己的业务头文件则应当排除在外。

## 在 CMake 中配置 PCH

CMake 3.16 开始原生支持预编译头文件，只需一行：

```cmake
target_precompile_headers(myapp PRIVATE pch.h)
```

CMake 会自动处理所有细节——为不同的编译器生成正确的编译命令，并在每个编译单元中注入 PCH。不需要手动传递编译器标志。

一个完整的 `CMakeLists.txt` 示例：

```cmake
cmake_minimum_required(VERSION 3.16)
project(myapp)

set(CMAKE_CXX_STANDARD 17)

add_executable(myapp
    src/main.cpp
    src/renderer.cpp
    src/scene.cpp
    # ...更多源文件
)

# 配置 PCH，CMake 3.16+ 原生支持
target_precompile_headers(myapp PRIVATE pch.h)
```

如果有多个 target，可以共享同一个 PCH，避免重复编译：

```cmake
# 先为一个 target 配置 PCH
target_precompile_headers(myapp PRIVATE pch.h)

# 其他 target 直接复用，不重新编译 PCH
target_precompile_headers(mylib REUSE_FROM myapp)
```

## pch.h 放什么

`pch.h` 应该收录所有**稳定且高频使用**的头文件：

```cpp
// pch.h
#pragma once

// C++ 标准库
#include <iostream>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>
#include <array>
#include <map>
#include <unordered_map>
#include <set>
#include <unordered_set>
#include <queue>
#include <stack>
#include <algorithm>
#include <numeric>
#include <functional>
#include <memory>
#include <optional>
#include <variant>
#include <chrono>
#include <thread>
#include <mutex>
#include <atomic>

// 稳定的第三方库
#include <glm/glm.hpp>
#include <spdlog/spdlog.h>
```

**不要放进 pch.h 的内容：**

- 你自己的业务头文件（`Player.h`、`Renderer.h` 之类的）——这些会频繁修改，每次改动都会让整个 PCH 失效
- 频繁迭代的第三方库头文件
- 含有全局状态或副作用的头文件

原则很简单：PCH 里的内容越稳定，带来的收益就越纯粹。

## 在 CLion 中使用

CLion 通过 CMakeLists.txt 识别 PCH 配置，不需要任何额外设置。

配置好 `target_precompile_headers` 后，重新加载 CMake 项目，CLion 就会在构建时自动生成 `.pch` 文件。

如果想确认 PCH 是否生效，可以在 CLion 的 Build Output 面板查看详细编译命令，应该能看到类似这样的参数：

```
-include-pch /path/to/project/cmake-build-debug/CMakeFiles/myapp.dir/cmake_pch.hxx.gch
```

看到 `-include-pch` 就说明配置成功了。

## 实际能快多少

效果取决于项目规模和头文件使用情况：

- 小项目（几十个源文件）：提升有限，但增量编译明显更快
- 中大型项目（数百个源文件）：冷编译时间通常减少 30%~50%
- 重度依赖标准库或大型第三方库的项目：提升可以达到 70% 以上

PyTorch、LLVM 等开源项目都启用了 PCH。LLVM 的构建文档明确提到 PCH 是加速编译的重要手段之一。

增量编译的收益通常比冷编译更明显——因为 PCH 只需生成一次，后续只要 `pch.h` 不变，增量编译就能完全跳过头文件解析阶段。

## 验证 PCH 效果

想量化 PCH 带来的加速，可以用 GCC/Clang 的 `-ftime-report` 标志查看各编译阶段的耗时分布：

```cmake
# 临时添加到 CMakeLists.txt 用于测量
target_compile_options(myapp PRIVATE -ftime-report)
```

编译输出中会显示 `TOTAL`、`phase parsing` 等各阶段时间。开启 PCH 前后对比 `phase parsing` 的耗时，能直观看到减少了多少解析时间。

## 注意事项

**PCH 与编译器、平台绑定**。GCC 生成的 `.gch` 不能被 Clang 使用，MSVC 的 `.pch` 也是如此。跨平台项目不需要特别处理——CMake 会为不同平台分别生成对应的 PCH，但要注意不同平台的 PCH 缓存不能共享。

**不要过度 PCH**。把所有头文件都塞进 `pch.h` 看起来很诱人，但这会让 PCH 变得脆弱——任何一个头文件的变动都会触发全量重编译。PCH 的价值在于稳定性，而不是包含量。

**CI 环境的处理**。CI 服务器每次都是全新环境，没有 PCH 缓存可以复用。如果 CI 时间是瓶颈，可以考虑把 PCH 文件作为构建缓存的一部分保存下来，或者在 CI 上也启用 PCH 让它至少在单次构建内生效。

---

PCH 是一个投入极低、收益明显的优化手段。对于任何有一定规模的 C++ 项目，它都应该是标配。配置只需要一行 CMake，维护成本几乎为零，却能在整个项目生命周期内持续节省编译时间。
