---
title: C++ 开发环境配置
date: 2023-01-15
description: '在 macOS 上配置 C++ 开发环境：Xcode CLI Tools、Homebrew、CMake 与 CLion 工具链。'
tags: [C++, macOS, 工具链]
category: C++ 入门
episode: 1
draft: false
lang: 'zh_CN'
---

刚开始学 C++ 的时候，环境是第一个让人头疼的事——编译器装哪里？CMake 是什么？为什么 IDE 找不到我的工具链？这篇记一下我在 macOS 上的一套配置，下面提到的路径默认是 Apple Silicon 的 Mac，Intel Mac 偶尔有差异我会顺带说。

## Xcode Command Line Tools

macOS 上写 C++ 第一步要先有编译器。Xcode 完整版太重，绝大多数人只需要它的命令行工具：

```bash
xcode-select --install
```

执行后系统会弹窗确认，装完之后 `clang++`、`make`、`lldb` 就都有了：

```bash
clang++ --version
make --version
lldb --version
```

`clang++` 是苹果自家发行的 Clang，版本会比 LLVM 官方那套滞后一点，但对入门来说足够。这一步之后就已经能写 `.cpp` 然后命令行编译运行了，剩下的都是为了让工作流更顺。

## Homebrew

后面装 CMake、Ninja、clang-format 这些都得过 Homebrew，不然就得手动下二进制。安装脚本来自官网：

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Apple Silicon 上 Homebrew 会装到 `/opt/homebrew`，但它不会自动写 PATH，新开个终端敲 `brew` 会找不到命令。补一行就好：

```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
source ~/.zprofile
```

Intel Mac 上 Homebrew 装在 `/usr/local`，PATH 是自动配好的，这一步可以跳过。

## CMake

有 Homebrew 后 CMake 一行就装好：

```bash
brew install cmake
cmake --version
```

CMake 怎么用、`CMakeLists.txt` 怎么写，我另写了一篇 [CMake 入门](/posts/cmake-intro/) 专门讲，这里就不展开了。

## CLion 的工具链

CLion 多数时候开箱即用，但有时它会用自带的旧 CMake，命令行 cmake 跟 IDE cmake 行为对不上很烦。手动指一下就行。

**Settings → Build, Execution, Deployment → Toolchains**，把这几项填好：

- C Compiler：`/usr/bin/clang`
- C++ Compiler：`/usr/bin/clang++`
- CMake：`/opt/homebrew/bin/cmake`（Intel Mac 上是 `/usr/local/bin/cmake`）
- Debugger：`/usr/bin/lldb`

编译器走 `/usr/bin` 是因为 Xcode 命令行工具已经把 Apple Clang 放在那儿了，不必再装一份 LLVM。

## 几个可选的工具

不是必装，但用上之后回不去：

```bash
brew install ninja
brew install clang-format
brew install llvm
```

Ninja 比 Make 快不少，配 CMake 用很爽；`clang-format` 用来统一代码风格；`llvm` 是完整版工具链，里面带 `clang-tidy` 这类静态检查。

顺便提一下，`brew install llvm` 装的 `clang`/`clang++` 不会盖掉系统自带的，想用它得自己改 PATH：

```bash
export PATH="/opt/homebrew/opt/llvm/bin:$PATH"
```

新手不用碰这个，系统 Clang 就够了。

## 跑一个最小程序

到这一步可以验证下整套东西通不通。最快的方法是单文件：

```bash
clang++ -std=c++23 -Wall -o hello hello.cpp
./hello
```

想顺手过一下 CMake 的流程也行：

```text
my_project/
├── CMakeLists.txt
└── main.cpp
```

```cmake
cmake_minimum_required(VERSION 3.20)
project(my_project CXX)
set(CMAKE_CXX_STANDARD 23)
add_executable(my_project main.cpp)
```

```bash
cmake -B build -G Ninja
cmake --build build
./build/my_project
```

CLion 里更简单，直接把项目目录拖进去，它认到 `CMakeLists.txt` 就会自动接管。

到这儿环境就齐了。后面写代码遇到的问题大多不是工具链的事，而是 C++ 本身的事——那才是真正头疼的开始。
