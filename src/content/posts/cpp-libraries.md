---
title: C++ 静态链接与动态链接
date: 2023-05-08
description: '静态库（.a）与动态库（.so/.dylib）的区别、CMake 中的链接方式，以及 CUDA 库的链接实践。'
tags: [C++, 编译, 工具链]
category: C++ 入门
episode: 14
draft: false
lang: 'zh_CN'
---

如果你学过一点 C++，大概率遇到过这种情况：照着教程把代码抄下来，头文件也 include 了，结果编译报了一堆 `undefined reference`，然后不知道哪里出问题。

这篇文章就是来解决这个问题的。我们来彻底搞清楚库是什么、静态库和动态库有什么区别、CMake 里怎么链接，以及 AI Infra 里天天打交道的 CUDA 库是怎么回事。

---

## 为什么需要库

最直白的答案：**不必重复造轮子**。

数学运算、图像处理、线性代数、网络通信——这些东西早就有人写好了，而且经过了充分测试和优化。你不需要自己去实现一个矩阵乘法，直接用 Eigen 或者 BLAS 就好。

库的结构很简单，分两部分：

- **头文件（.h / .hpp）**：声明。告诉编译器有哪些函数、类、类型存在，参数是什么，返回值是什么。
- **库文件（.a / .so / .lib / .dll）**：实现。告诉链接器这些函数的机器码在哪里。

这两者缺一不可。只有头文件没有库文件，编译能过，但链接会失败，报的就是 `undefined reference`。

---

## 静态库（.a / .lib）

静态库在 **链接阶段** 被处理。链接器会把你的程序里实际用到的那些 `.o` 文件从 `.a` 里面挖出来，直接复制进你的可执行文件里。

**本质**：`.a` 是一个 `.o` 文件的打包集合（archive），链接器只拿走你用到的那部分，不是把整个库都塞进去。

优点：
- 可执行文件完全独立，拷贝到任何机器上就能跑，不依赖外部文件
- 发布程序时不用附带库文件

缺点：
- 可执行文件体积大
- 如果十个程序都链接了同一个静态库，内存里就有十份一样的代码

### CMake 里链接静态库

```cmake
# 假设你有一个自己写的静态库 mylib
add_library(mylib STATIC src/mylib.cpp)

add_executable(myapp main.cpp)
target_link_libraries(myapp PRIVATE mylib)
```

`PRIVATE` 的意思是：mylib 只是 myapp 的实现细节，不会传递给依赖 myapp 的其他目标。大多数情况下用 `PRIVATE` 就对了。

---

## 动态库（.so / .dylib / .dll）

动态库不在链接阶段被复制进可执行文件。链接器只在可执行文件里记一个"我需要 libfoo.so"的标记，**真正的加载发生在运行时**。

**加载时机**：程序启动时，操作系统的动态链接器（Linux 上是 `ld-linux.so`，macOS 上是 `dyld`）负责找到这个库文件，把它映射到进程的地址空间里。如果找不到，程序直接崩掉，报 `cannot open shared object file`。

优点：
- 多个程序共享同一份库，操作系统只需要把它加载进内存一次，节省内存
- 更新库文件不用重新编译程序（ABI 兼容的情况下）

缺点：
- 发布程序时必须把依赖的 `.so` 一起带上，或者确保目标机器上已经安装了
- 版本不匹配会出问题

### 运行时动态加载（dlopen）

除了启动时自动加载，还可以在程序运行中手动加载动态库：

```cpp
#include <dlfcn.h>

void* handle = dlopen("libfoo.so", RTLD_LAZY);
auto func = (void(*)())dlsym(handle, "some_function");
func();
dlclose(handle);
```

插件系统就是这么做的。程序启动时不知道要加载哪些插件，运行时再决定。

### CMake 里链接动态库

写法和静态库一样：

```cmake
target_link_libraries(myapp PRIVATE mylib)
```

CMake 会根据库的类型（`SHARED` 还是 `STATIC`）自动处理。

---

## 头文件与库文件的关系

这里再强调一次，因为这是初学者最容易混淆的地方：

| | 作用 | 阶段 |
|---|---|---|
| 头文件（.h） | 告诉编译器函数签名 | 编译期 |
| 库文件（.a/.so） | 告诉链接器函数实现在哪 | 链接期 |

**只 include 头文件，不链接库文件** → 编译通过，链接失败，报 `undefined reference to 'xxx'`。

**链接了库文件，但没 include 头文件** → 编译失败，报 `use of undeclared identifier`。

两者都要有。

---

## CMake 中使用第三方库

### 方式一：find_package（推荐）

大多数主流库都提供了 CMake 的 Find 模块或者 Config 文件，可以直接用：

```cmake
find_package(OpenCV REQUIRED)

add_executable(myapp main.cpp)
target_link_libraries(myapp PRIVATE ${OpenCV_LIBS})
target_include_directories(myapp PRIVATE ${OpenCV_INCLUDE_DIRS})
```

`REQUIRED` 表示找不到就报错停止，不要静默跳过。

### 方式二：手动指定路径

如果库没有 CMake 支持，或者你把库放在了非标准位置：

```cmake
add_executable(myapp main.cpp)

target_include_directories(myapp PRIVATE /path/to/mylib/include)
target_link_libraries(myapp PRIVATE /path/to/mylib/lib/libmylib.a)
```

### 方式三：FetchContent 自动下载

不想手动管理依赖，让 CMake 自己去下：

```cmake
include(FetchContent)

FetchContent_Declare(
    fmt
    GIT_REPOSITORY https://github.com/fmtlib/fmt.git
    GIT_TAG        10.2.1
)
FetchContent_MakeAvailable(fmt)

target_link_libraries(myapp PRIVATE fmt::fmt)
```

第一次构建会下载，之后缓存在本地。适合小项目快速上手。

### CLion 中找不到库怎么办

CLion 用的就是 CMake，所以配置方式和上面完全一样。如果 `find_package` 找不到，在 CLion 的 CMake 设置（Settings → Build, Execution, Deployment → CMake）里加上 `CMAKE_PREFIX_PATH`，指向你的库安装目录。

---

## 常见报错解析

### `undefined reference to 'xxx'`

**原因**：链接器找不到函数实现。

可能的情况：
1. 忘了在 `target_link_libraries` 里加这个库
2. 库的顺序不对（GCC 链接器对顺序敏感，被依赖的库要放在后面）
3. C++ 函数用 C 方式链接，或反过来（注意 `extern "C"`）

### `cannot open shared object file: No such file or directory`

**原因**：程序启动时动态链接器找不到 `.so` 文件。

解决方法，按推荐程度排序：

1. **设置 rpath**（最干净）：在编译时把库路径硬编码进可执行文件
   ```cmake
   set_target_properties(myapp PROPERTIES
       INSTALL_RPATH "/path/to/lib"
       BUILD_WITH_INSTALL_RPATH TRUE
   )
   ```

2. **设置 `LD_LIBRARY_PATH`**（临时调试用）：
   ```bash
   export LD_LIBRARY_PATH=/path/to/lib:$LD_LIBRARY_PATH
   ./myapp
   ```

3. **安装到系统路径** `/usr/local/lib`，然后运行 `ldconfig`

---

## AI Infra 视角：CUDA 库

做 AI Infra 绕不开 CUDA 生态，这里的库都是动态库。

### 常用 CUDA 库

| 库 | 用途 |
|---|---|
| **cuBLAS** | GPU 上的 BLAS（矩阵乘法等线性代数运算） |
| **cuDNN** | 深度神经网络原语（卷积、归一化等） |
| **NCCL** | 多 GPU 通信（all-reduce、broadcast） |
| **cuRAND** | GPU 上的随机数生成 |

### CMake 链接 CUDA 库

```cmake
cmake_minimum_required(VERSION 3.18)
project(myapp CUDA CXX)

find_package(CUDAToolkit REQUIRED)

add_executable(myapp main.cu)
target_link_libraries(myapp PRIVATE
    CUDA::cudart
    CUDA::cublas
    CUDA::curand
)
```

`CUDAToolkit` 是 CMake 3.17+ 提供的现代方式，推荐用这个，不要手动写 `/usr/local/cuda/lib64/libcublas.so`。

### 为什么要链接 cudart

`cudart` 是 CUDA Runtime Library，提供了 `cudaMalloc`、`cudaMemcpy`、`cudaLaunchKernel` 这些基础 API 的实现。你写的 `.cu` 文件里几乎所有的 CUDA 操作都依赖它。

### 静态 cudart vs 动态 cudart

| | 静态 cudart（`cudart_static`） | 动态 cudart（`cudart`） |
|---|---|---|
| 可执行文件大小 | 大（Runtime 代码打进去了） | 小 |
| 部署 | 不需要 CUDA 安装（只需要驱动） | 需要目标机器有对应版本的 CUDA Runtime |
| 适用场景 | 分发给没有 CUDA 环境的机器 | 内部服务，CUDA 环境可控 |

```cmake
# 静态链接 cudart
target_link_libraries(myapp PRIVATE CUDA::cudart_static)

# 动态链接 cudart（默认）
target_link_libraries(myapp PRIVATE CUDA::cudart)
```

静态 cudart 的坑：链接时需要 `dl`、`pthread`、`rt`（Linux）：

```cmake
target_link_libraries(myapp PRIVATE
    CUDA::cudart_static
    dl pthread rt
)
```

---

## Header-Only 库：方便但有代价

Eigen 是最典型的 header-only 库——只有头文件，没有 `.a` 或 `.so`，直接 include 就用。

为什么方便：集成简单，不用链接，不用管版本。

为什么编译慢：模板代码必须在每个包含它的编译单元里重新实例化。你有 50 个 `.cpp` 都用了 Eigen，Eigen 的模板就被编译了 50 次。

解决办法：用**显式模板实例化**，或者用预编译头（PCH）把 Eigen 的头文件预编译一次。CMake 里：

```cmake
target_precompile_headers(myapp PRIVATE <Eigen/Dense>)
```

---

## 小结

| | 静态库 | 动态库 |
|---|---|---|
| 后缀 | `.a`（Linux/macOS）、`.lib`（Windows） | `.so`（Linux）、`.dylib`（macOS）、`.dll`（Windows） |
| 复制时机 | 链接时 | 运行时 |
| 可执行文件大小 | 大 | 小 |
| 部署 | 独立，无外部依赖 | 需要带库文件或系统安装 |
| 内存共享 | 不共享 | 多进程共享同一份 |

记住这张表，再碰到 `undefined reference` 和 `cannot open shared object file` 就知道该查哪里了。

下一篇我们来看模板（Templates）——C++ 里最强大也最让人头疼的特性之一。
