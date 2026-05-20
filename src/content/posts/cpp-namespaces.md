---
title: C++ 命名空间
published: 2023-07-02
description: '用命名空间避免名称冲突、嵌套命名空间，以及 using 的正确用法。'
tags: [C++]
category: C++ 进阶
episode: 5
draft: false
lang: 'zh_CN'
---

你每次写 `std::cout` 的时候，有没有想过那个 `std::` 到底是什么？它就是命名空间（namespace）。理解命名空间不只是语法糖，它是组织大型 C++ 项目的基础工具。

## 为什么需要命名空间

假设你同时使用两个第三方库：

```cpp
// libA.h
void print(const std::string& s);

// libB.h
void print(const std::string& s);
```

两个库都定义了 `print`，链接器会直接报错：*multiple definition of print*。这就是**名称冲突**（name collision）。

命名空间的作用是给名字套一个"容器"，把 `print` 变成 `libA::print` 和 `libB::print`，彻底消除歧义。`std::cout` 里的 `std` 就是标准库的命名空间，`iostream` 里所有的东西——`cin`、`cout`、`string`、`vector`——都住在 `std` 这个容器里。

## 定义命名空间

语法很直接：

```cpp
namespace mylib {
    void print(const std::string& s) {
        std::cout << s << '\n';
    }

    int version = 1;
}
```

调用时加上 `::` 作用域解析符：

```cpp
mylib::print("hello");
int v = mylib::version;
```

命名空间有一个和 `class` 不同的重要特性：**同一个命名空间可以跨多个文件分散定义**，不需要集中在一处。

```cpp
// renderer.h
namespace engine {
    void render();
}

// physics.h
namespace engine {
    void simulate();
}
```

这两个文件都在扩展同一个 `engine` 命名空间，完全合法。

## 嵌套命名空间

命名空间可以嵌套，用来反映模块层级：

```cpp
// C++17 之前
namespace engine {
    namespace render {
        namespace vulkan {
            void init();
        }
    }
}

// C++17 简写，完全等价
namespace engine::render::vulkan {
    void init();
}
```

调用时：

```cpp
engine::render::vulkan::init();
```

## using 声明与 using 指令

写代码时频繁敲 `std::` 会让代码很啰嗦，`using` 可以简化，但用法差别很大。

### using 声明（推荐）

```cpp
using std::cout;
using std::string;

cout << "hello" << '\n';  // OK，只有 cout 和 string 被引入
```

只引入你明确需要的名字，精确、安全。

### using 指令（谨慎使用）

```cpp
using namespace std;

cout << "hello" << '\n';  // 方便，但危险
```

一句话把 `std` 里的**所有**名字都倒进当前作用域。初学时很爽，项目大了就是定时炸弹。

考虑这个场景：你的项目里有一个自己写的 `max` 函数：

```cpp
// utils.h
int max(int a, int b);  // 项目自己的 max
```

```cpp
#include <algorithm>
#include "utils.h"
using namespace std;

int result = max(3, 5);  // 调用的是哪个 max？
```

`std::max` 和你的 `max` 发生冲突，编译器要么报歧义错误，要么悄悄选错版本。这类 bug 极难排查，因为行为取决于头文件包含顺序。

### 黄金法则：不要在头文件里写 `using namespace`

```cpp
// bad_header.h  ← 这样写会污染所有 include 它的文件
#pragma once
#include <string>
using namespace std;  // 危险！

void doSomething(string s);
```

任何 `#include "bad_header.h"` 的文件都会被强制引入整个 `std`，而那个文件的作者完全不知情。这是库代码的大忌。

在头文件里，永远写完整的 `std::string`，不要用 `using namespace`。

## 匿名命名空间

```cpp
namespace {
    void helper() {
        // 只在本文件内可见
    }

    int internalCounter = 0;
}
```

匿名命名空间等价于 `static`——它给里面的名字赋予**内部链接**（internal linkage），其他翻译单元看不到这些名字。这是现代 C++ 替代文件级 `static` 函数的推荐方式，语义更清晰。

## 命名空间别名

深层嵌套的命名空间每次写全名太累：

```cpp
// 每次都写这个？
std::experimental::filesystem::path p = "data/config.json";
```

用别名：

```cpp
namespace fs = std::experimental::filesystem;

fs::path p = "data/config.json";
fs::exists(p);
```

在实际项目里，别名常用于隔离第三方库的版本变化——改一行别名定义就能切换底层实现。

## inline namespace（简要提及）

C++11 引入了 `inline namespace`，主要用于**库的版本控制**：

```cpp
namespace mylib {
    inline namespace v2 {
        void api();  // 默认使用 v2
    }
    namespace v1 {
        void api();  // 旧版本，显式指定才能访问
    }
}

mylib::api();     // 调用 v2::api
mylib::v1::api(); // 显式调用旧版本
```

这样库作者可以在不破坏 ABI 的前提下演进接口。大多数应用层代码不需要定义 `inline namespace`，知道它存在即可。

## AI Infra 视角

有意思的是，C 语言没有命名空间，但大型 C 库通过**命名前缀**实现了相同的效果：

- cuBLAS：`cublasCreate`、`cublasHandle_t`、`cublasSgemm`
- NCCL：`ncclCommInitRank`、`ncclAllReduce`、`ncclComm_t`
- MPI：`MPI_Init`、`MPI_Send`、`MPI_Comm`

所有符号都以库名为前缀，手动实现命名空间的语义。这也是为什么这些 C 接口看起来有点啰嗦——这是在没有语言支持时的工程妥协。

现代 C++ 库则直接用命名空间：Abseil 的 `absl::flat_hash_map`，Protobuf 的 `google::protobuf::Message`，结构清晰，不需要靠命名前缀维持秩序。

## 小结

| 用法 | 场景 |
|---|---|
| `ns::name` | 明确指定，最安全 |
| `using std::cout` | 只引入需要的名字，推荐 |
| `using namespace std` | 小脚本、快速原型，不用于头文件 |
| `namespace { }` | 文件内部实现，替代 `static` |
| `namespace alias = long::path` | 简化深层嵌套 |

命名空间本身不复杂，但用好它需要一点纪律：**头文件里永远写完整名字，`using namespace` 只在实现文件的局部作用域里用**。遵守这两条，你就不会被名称冲突坑到。
