---
title: C++ CMake 入门
date: 2023-01-22
description: 'CMake 是什么、CMakeLists.txt 怎么写、target 机制，以及多文件项目的构建配置。'
tags: [C++, 工具链]
category: C++ 入门
episode: 2
draft: false
lang: 'zh_CN'
---

本文的目标不是覆盖 CMake 的全部功能，而是解释一个 C++ 初学者最先需要理解的几件事：CMake 是什么、`CMakeLists.txt` 写什么、如何配置和构建项目，以及为什么现代 C++ 项目普遍围绕 target 来组织。

很多 C++ 初学者第一次看到 `CMakeLists.txt` 时，会误以为 CMake 是另一种编译器，或者是 Makefile 的替代语法。更准确地说，CMake 是一个构建系统生成器。

你写的是项目描述：

- 项目叫什么
- 用什么语言
- 使用哪个 C++ 标准
- 哪些源码要编译成可执行程序
- 哪些库需要被链接

CMake 再根据这些描述生成真正的构建文件，比如 Ninja 文件、Makefile 或 Xcode 工程。

## 从手动编译开始

假设我们只有一个 C++ 文件：

```cpp
// main.cpp
#include <iostream>

int main() {
    std::cout << "Hello, CMake!" << std::endl;
    return 0;
}
```

不用 CMake 时，可以直接调用编译器：

```bash
clang++ -std=c++23 -Wall -Wextra -o hello main.cpp
./hello
```

这对单文件程序很直接。但当源码文件变多、要区分 Debug 和 Release、要链接第三方库、要给 IDE 提供项目信息时，手写命令会很快变得难维护。

CMake 解决的正是这个问题：把构建规则写进项目里。

## 最小 CMake 项目

一个最小项目可以长这样：

```text
hello-cmake/
├── CMakeLists.txt
└── main.cpp
```

`main.cpp`：

```cpp
#include <iostream>

int main() {
    std::cout << "Hello, CMake!" << std::endl;
    return 0;
}
```

`CMakeLists.txt`：

```cmake
cmake_minimum_required(VERSION 3.20)
project(hello_cmake CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(hello main.cpp)
```

这就是一个完整的 CMake 项目。

## 逐行解释 CMakeLists.txt

第一行：

```cmake
cmake_minimum_required(VERSION 3.20)
```

声明项目需要的最低 CMake 版本。这样可以避免旧版本 CMake 不认识某些语法。

第二行：

```cmake
project(hello_cmake CXX)
```

定义项目名，并声明这个项目使用 C++。`CXX` 是 CMake 里表示 C++ 语言的名字。

接下来两行：

```cmake
set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
```

要求使用 C++23，并且这个要求是必须满足的。如果编译器不支持 C++23，CMake 会在配置阶段报错。

最后一行：

```cmake
add_executable(hello main.cpp)
```

定义一个可执行程序。这里的 `hello` 是 target 名字，也是最终生成的可执行文件名；`main.cpp` 是它的源码文件。

现代 CMake 的核心概念就是 target。可执行程序是 target，库也是 target。后续的头文件路径、编译选项、链接关系，通常都应该围绕 target 来写。

## 配置、构建、运行

进入项目目录后，先配置：

```bash
cmake -S . -B build -G Ninja
```

再构建：

```bash
cmake --build build
```

运行：

```bash
./build/hello
```

这是最常见的 CMake 使用流程。

## `-S` 和 `-B`

这条命令：

```bash
cmake -S . -B build
```

可以读成：

- `-S .`：源码目录是当前目录
- `-B build`：构建目录是 `build`

推荐把源码目录和构建目录分开，这叫 out-of-source build。这样源码目录不会混进大量中间文件。想重新来过时，删除 `build` 目录即可。

```bash
rm -rf build
```

## `-G Ninja`

`-G` 用来指定 CMake 的 generator：

```bash
cmake -S . -B build -G Ninja
```

generator 决定 CMake 要生成哪种底层构建系统。

常见选择：

- `Ninja`：速度快，适合日常开发
- `Unix Makefiles`：生成 Makefile
- `Xcode`：生成 Xcode 工程

如果不指定 `-G`，CMake 会使用当前环境的默认 generator。

## CMake 和 Makefile 的关系

CMake 可以生成 Makefile，但 CMake 本身不是 Makefile。

手写 Makefile 时，你是在直接告诉 `make` 每一步怎么编译：

```makefile
CXX = clang++
CXXFLAGS = -std=c++23 -Wall -Wextra
TARGET = hello
SRC = main.cpp

$(TARGET): $(SRC)
	$(CXX) $(CXXFLAGS) -o $@ $^

clean:
	rm -f $(TARGET)
```

而使用 CMake 时，你是在描述项目结构：

```cmake
add_executable(hello main.cpp)
```

然后由 CMake 生成 Makefile、Ninja 文件或 IDE 工程。

所以，小 demo 可以手写 Makefile；稍微正式一点的 C++ 项目，更常见的选择是 CMake。

## Debug 和 Release

CMake 可以指定构建类型。

Debug 构建：

```bash
cmake -S . -B build-debug -G Ninja -DCMAKE_BUILD_TYPE=Debug
cmake --build build-debug
```

Release 构建：

```bash
cmake -S . -B build-release -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build-release
```

常见构建类型：

- `Debug`：带调试信息，适合开发和调试
- `Release`：开启优化，适合发布或性能测试
- `RelWithDebInfo`：开启优化，同时保留调试信息

## 多个源码文件

当项目从一个文件变成多个文件时，可以继续把源码添加到同一个 target：

```text
hello-cmake/
├── CMakeLists.txt
├── greeting.cpp
├── greeting.h
└── main.cpp
```

`greeting.h`：

```cpp
#pragma once

#include <string>

std::string make_greeting(const std::string& name);
```

`greeting.cpp`：

```cpp
#include "greeting.h"

std::string make_greeting(const std::string& name) {
    return "Hello, " + name + "!";
}
```

`main.cpp`：

```cpp
#include <iostream>

#include "greeting.h"

int main() {
    std::cout << make_greeting("CMake") << std::endl;
    return 0;
}
```

`CMakeLists.txt`：

```cmake
cmake_minimum_required(VERSION 3.20)
project(hello_cmake CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(hello
  main.cpp
  greeting.cpp
)
```

这里没有把头文件写进 `add_executable`，因为真正需要编译的是 `.cpp` 文件。头文件会通过 `#include` 被编译器读取。

## 拆成库

项目继续变大时，通常会把一部分代码拆成库：

```text
hello-cmake/
├── CMakeLists.txt
├── include/
│   └── greeting/
│       └── greeting.h
└── src/
    ├── greeting.cpp
    └── main.cpp
```

`include/greeting/greeting.h`：

```cpp
#pragma once

#include <string>

std::string make_greeting(const std::string& name);
```

`src/greeting.cpp`：

```cpp
#include "greeting/greeting.h"

std::string make_greeting(const std::string& name) {
    return "Hello, " + name + "!";
}
```

`src/main.cpp`：

```cpp
#include <iostream>

#include "greeting/greeting.h"

int main() {
    std::cout << make_greeting("CMake") << std::endl;
    return 0;
}
```

`CMakeLists.txt`：

```cmake
cmake_minimum_required(VERSION 3.20)
project(hello_cmake CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(greeting src/greeting.cpp)
target_include_directories(greeting PUBLIC include)

add_executable(hello src/main.cpp)
target_link_libraries(hello PRIVATE greeting)
```

这里出现了三个重要命令。

创建库：

```cmake
add_library(greeting src/greeting.cpp)
```

声明库的公开头文件目录：

```cmake
target_include_directories(greeting PUBLIC include)
```

让可执行程序链接这个库：

```cmake
target_link_libraries(hello PRIVATE greeting)
```

`PUBLIC` 表示 `greeting` 自己需要这个 include 目录，链接 `greeting` 的 target 也需要这个 include 目录。

`PRIVATE` 表示 `hello` 只是自己链接 `greeting`，这个关系不需要再向外传播。

## 记住这条主线

入门阶段不需要记太多 CMake 命令。先记住这条主线：

```cmake
add_executable(...)
add_library(...)
target_include_directories(...)
target_link_libraries(...)
```

也就是：

- 先定义 target
- 再给 target 配头文件目录
- 再描述 target 之间的链接关系

这样写出来的 CMake 项目更容易扩展，也更接近真实 C++ 项目的组织方式。
