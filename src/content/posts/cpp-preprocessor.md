---
title: C++ 预处理器与宏
date: 2024-01-08
description: '#define、条件编译、宏的局限性，以及 CUDA 代码中的预处理器用法。'
tags: [C++, 编译]
category: C++ 进阶
episode: 15
draft: false
lang: 'zh_CN'
---

很多人学 C++ 的时候跳过了预处理器，觉得那不过是一些老旧的 `#define` 和 `#include`，能避则避。但如果你写过 CUDA 代码，就会发现预处理器其实无处不在：`__global__`、`__device__`、`cudaCheckError`……这些全是宏。跨平台构建、条件编译、批量代码生成，都少不了它。

这篇文章把预处理器从头梳理一遍，顺带踩一踩宏函数的各种坑，最后看几个 CUDA 场景下的实际用法。

---

## 预处理器是什么时候跑的

编译一个 `.cpp` 文件，实际上分三步：

1. **预处理（Preprocessing）**：处理所有 `#` 开头的指令，做纯文本替换
2. **编译（Compilation）**：把 C++ 源码翻译成汇编/目标文件
3. **链接（Linking）**：把目标文件拼成可执行文件

预处理器在第一步就跑完了，**它完全不理解 C++ 语法**。它看到的只是一堆文本，它做的事情也只是文本处理：把某段文字替换成另一段文字，或者根据条件决定要不要保留某段文字。

这意味着什么？意味着宏里写的东西可以完全不是合法的 C++ 表达式，只要展开之后合法就行。也意味着很多宏的 bug 根本不会在预处理阶段报错，等到编译器看到展开后的代码才会炸。

### 看看预处理结果

想看预处理展开后的代码，直接用：

```bash
g++ -E main.cpp -o main.i
# 或者
cpp main.cpp
```

`-E` 告诉编译器只做预处理，不编译。输出的 `.i` 文件就是所有 `#include` 展开、所有宏替换完之后的原始文本。试一次你就知道为什么 `#include <iostream>` 会让你的文件从几十行膨胀到几万行了。

CLion 里也有这个功能：`Tools → Clang-Tidy → Preprocess File`，或者直接在 CMake build 目录里找 `.ii` 文件。

---

## #include 的本质：文本粘贴

先从最基础的说起。`#include` 做的事情极其简单：**把目标文件的内容原封不动地粘贴过来**。

```cpp
// foo.h
int add(int a, int b);

// main.cpp
#include "foo.h"
int main() { return add(1, 2); }
```

预处理后，`main.cpp` 实际上变成了：

```cpp
int add(int a, int b);
int main() { return add(1, 2); }
```

就是字面意义上的复制粘贴。`#include` 不会做任何语法分析，不会检查是不是合法头文件，只管粘贴。这也是为什么头文件里写了错误的语法，报错信息会指向 `#include` 那一行的展开位置——编译器看到的就是展开后的代码。

Include guard 和 `#pragma once` 存在的意义正是防止同一个头文件被粘贴多次，导致符号重复定义。

---

## #define：常量与宏函数

### 常量定义

```cpp
#define PI 3.14159
#define MAX_THREADS 1024
#define CUDA_WARP_SIZE 32
```

预处理器会把代码里所有的 `PI` 替换成 `3.14159`。注意：**没有类型，没有作用域，没有名字空间**。`PI` 就是一个全局文本替换规则，只要在 `#define` 之后、`#undef` 之前都有效。

现代 C++ 里几乎总是应该用 `constexpr` 代替：

```cpp
constexpr double PI = 3.14159;
constexpr int MAX_THREADS = 1024;
```

`constexpr` 变量有类型，有作用域，可以用调试器查看，可以取地址，编译器也更容易做优化。唯一`#define`胜出的场景：需要在 `#if` 条件里用数值（因为 `#if` 是预处理器指令，它看不到 `constexpr`）。

### 宏函数及其陷阱

```cpp
#define MAX(a, b) ((a) > (b) ? (a) : (b))
```

看起来人畜无害，用起来有坑。

**陷阱一：参数被多次求值。**

```cpp
int x = 5, y = 3;
int result = MAX(x++, y);
```

展开之后变成：

```cpp
int result = ((x++) > (y) ? (x++) : (y));
```

`x++` 被求值了**两次**！如果 `x > y`，`x` 会自增两次，`result` 得到的是自增后的第二个值。这是一个隐蔽的 bug，编译器不会报警，测试也很难发现。

**陷阱二：没有类型检查。**

宏函数不知道 `a` 和 `b` 是什么类型，你传指针进去它也照样展开，出了问题只能对着展开后的代码去猜。

**陷阱三：调试困难。**

调试器里单步走到宏调用那一行，你看不到展开结果，只能靠肉眼展开。复杂的宏嵌套宏更是噩梦。

**正确替代：`inline` 函数 + `constexpr`**

```cpp
template<typename T>
inline constexpr T max_val(T a, T b) {
    return a > b ? a : b;
}
```

有类型检查，有内联优化，调试友好，参数只求值一次。编译器优化之后和宏生成的代码完全一样快，没有任何理由在这里用宏。

---

## 条件编译

这是预处理器真正难以替代的领域。

### 基础语法

```cpp
#ifdef DEBUG
    std::cout << "debug mode\n";
#endif

#ifndef NDEBUG
    assert(ptr != nullptr);
#endif

#if VERSION >= 2
    use_new_api();
#else
    use_old_api();
#endif
```

`#ifdef` 检查某个宏**是否被定义**（不管它的值是什么），`#if` 检查表达式的值是否为真。

### Include Guard vs #pragma once

传统写法：

```cpp
// myheader.h
#ifndef MYHEADER_H
#define MYHEADER_H

// 头文件内容

#endif // MYHEADER_H
```

现代简化写法：

```cpp
// myheader.h
#pragma once

// 头文件内容
```

`#pragma once` 更简洁，不容易出现宏名冲突，主流编译器（GCC、Clang、MSVC）都支持。唯一的理论缺陷是它依赖文件系统识别同一个文件（通过 inode 或路径），极少数情况下可能出问题，但实际工程中几乎从不出现。推荐直接用 `#pragma once`。

### 平台检测

```cpp
#ifdef _WIN32
    #include <windows.h>
    #define PLATFORM_WINDOWS
#elif defined(__linux__)
    #include <unistd.h>
    #define PLATFORM_LINUX
#elif defined(__APPLE__)
    #include <TargetConditionals.h>
    #define PLATFORM_MAC
#endif
```

CMake 里也可以把检测到的平台通过 `target_compile_definitions` 传进来，在代码里直接用。

### #error 主动报错

```cpp
#if !defined(__cplusplus) || __cplusplus < 201703L
    #error "This code requires C++17 or later"
#endif

#ifdef USE_CUDA
    #ifndef __CUDACC__
        #error "USE_CUDA is defined but not compiling with nvcc"
    #endif
#endif
```

`#error` 会在预处理阶段立即终止并打印错误信息，比让代码编译到一半再报奇怪错误要友好得多。做库开发时应该积极使用。

---

## 内置宏：日志与断言的利器

编译器预先定义了几个有用的宏：

| 宏 | 内容 |
|---|---|
| `__FILE__` | 当前源文件路径（字符串） |
| `__LINE__` | 当前行号（整数） |
| `__func__` | 当前函数名（字符串，C99/C++11） |
| `__DATE__` | 编译日期（字符串，如 `"May 14 2026"`） |
| `__TIME__` | 编译时间（字符串） |

实际应用——带位置信息的日志宏：

```cpp
#define LOG_INFO(fmt, ...)  \
    printf("[INFO] %s:%d (%s): " fmt "\n", __FILE__, __LINE__, __func__, ##__VA_ARGS__)

#define LOG_ERROR(fmt, ...) \
    fprintf(stderr, "[ERROR] %s:%d (%s): " fmt "\n", __FILE__, __LINE__, __func__, ##__VA_ARGS__)
```

用起来：

```cpp
LOG_INFO("Loading model from %s", model_path);
// 输出：[INFO] trainer.cpp:42 (load_model): Loading model from /data/model.bin
```

这类日志宏在 AI Infra 代码里极其常见，因为 C++ 没有原生的反射，获取调用位置信息只有靠预处理器。

---

## 可变参数宏（Variadic Macros）

C99 和 C++11 支持可变参数宏，用 `...` 和 `__VA_ARGS__`：

```cpp
#define LOG(fmt, ...) printf("[LOG] " fmt "\n", ##__VA_ARGS__)

LOG("hello");               // printf("[LOG] hello\n")
LOG("value = %d", 42);     // printf("[LOG] value = %d\n", 42)
```

`##__VA_ARGS__` 是一个 GCC/Clang 扩展：当 `...` 为空时，`##` 会自动删掉前面多余的逗号，避免 `printf("[LOG] hello\n", )` 这种非法语法。这个扩展 MSVC 也支持，可以放心用。

C++20 引入了 `__VA_OPT__`，是更标准的写法：

```cpp
#define LOG(fmt, ...) printf("[LOG] " fmt "\n" __VA_OPT__(,) __VA_ARGS__)
```

---

## X-Macro 技巧：用宏生成代码

这是宏最强大也最少人知道的用法之一。场景：你有一组枚举值，同时需要一个函数把枚举转成字符串，还需要一个函数把字符串转成枚举。

不用 X-Macro 的写法：

```cpp
enum class ErrorCode { OK, TIMEOUT, OOM, INVALID_ARG };

const char* error_to_str(ErrorCode e) {
    switch (e) {
        case ErrorCode::OK: return "OK";
        case ErrorCode::TIMEOUT: return "TIMEOUT";
        case ErrorCode::OOM: return "OOM";
        case ErrorCode::INVALID_ARG: return "INVALID_ARG";
        default: return "UNKNOWN";
    }
}
```

每次加一个错误码，要改两处。用 X-Macro：

```cpp
// 定义"数据表"：X(枚举名, 字符串)
#define ERROR_CODES \
    X(OK,           "OK")           \
    X(TIMEOUT,      "TIMEOUT")      \
    X(OOM,          "OOM")          \
    X(INVALID_ARG,  "INVALID_ARG")

// 生成枚举
enum class ErrorCode {
#define X(name, str) name,
    ERROR_CODES
#undef X
};

// 生成转换函数
const char* error_to_str(ErrorCode e) {
    switch (e) {
#define X(name, str) case ErrorCode::name: return str;
        ERROR_CODES
#undef X
        default: return "UNKNOWN";
    }
}
```

现在加一个错误码只需要在 `ERROR_CODES` 里加一行，枚举定义和 `switch` 都会自动更新。在大型项目里，这个技巧可以用来同步生成：枚举、字符串表、序列化/反序列化代码、protobuf 字段映射……

---

## CUDA 中的预处理器

如果你写 CUDA，你其实已经在大量使用预处理器定义的宏了。

### `__global__`、`__device__`、`__host__` 是宏

准确地说，它们是 NVIDIA 的编译器（nvcc）定义的**属性宏**（实际上在 nvcc 里是关键字扩展，但对普通 C++ 编译器来说就是宏，定义为空）：

```cpp
// nvcc 内部大致等价于：
#define __global__  __attribute__((global))   // nvcc 实际处理
#define __device__  __attribute__((device))
#define __host__    __attribute__((host))

// 普通 g++ 编译时（不通过 nvcc），这些会被定义为空：
#define __global__
#define __device__
#define __host__
```

这让你可以写出能同时被 nvcc 和普通 C++ 编译器处理的头文件——CUDA 编译时这些标注生效，CPU-only 编译时它们消失。

### 跨平台构建：`#ifdef USE_CUDA`

项目里通常有一个编译选项控制是否启用 CUDA：

```cmake
# CMakeLists.txt
option(USE_CUDA "Enable CUDA support" OFF)
if(USE_CUDA)
    find_package(CUDA REQUIRED)
    target_compile_definitions(mylib PRIVATE USE_CUDA)
endif()
```

代码里：

```cpp
#ifdef USE_CUDA
    #include <cuda_runtime.h>
    void forward_gpu(const float* input, float* output, int n);
#else
    // CPU fallback
    void forward_cpu(const float* input, float* output, int n);
#endif

void forward(const float* input, float* output, int n) {
#ifdef USE_CUDA
    forward_gpu(input, output, n);
#else
    forward_cpu(input, output, n);
#endif
}
```

### CUDA_CHECK 错误检查宏

CUDA API 的每个调用都返回一个 `cudaError_t`，不检查返回值是生产事故的温床。标准做法是写一个检查宏：

```cpp
#define CUDA_CHECK(call)                                                    \
    do {                                                                    \
        cudaError_t err = (call);                                           \
        if (err != cudaSuccess) {                                           \
            fprintf(stderr, "CUDA error at %s:%d — %s\n",                  \
                    __FILE__, __LINE__, cudaGetErrorString(err));            \
            std::abort();                                                   \
        }                                                                   \
    } while (0)
```

用起来：

```cpp
CUDA_CHECK(cudaMalloc(&d_ptr, size));
CUDA_CHECK(cudaMemcpy(d_ptr, h_ptr, size, cudaMemcpyHostToDevice));
CUDA_CHECK(cudaDeviceSynchronize());
```

展开后，每个调用都带上了出错时的文件名和行号，出问题能立刻定位。

注意 `do { ... } while (0)` 这个包裹——这是宏函数里的标准写法，目的是让宏在 `if/else` 里表现得像一条语句：

```cpp
// 如果不用 do-while，这样写会出错：
if (condition)
    CUDA_CHECK(cudaMalloc(&ptr, size));  // 展开成多条语句，if 只捕获第一条
else
    do_something_else();

// 用了 do-while，展开后是一个完整的语句块
```

类似地，cuBLAS、cuDNN 也应该有对应的检查宏：

```cpp
#define CUBLAS_CHECK(call)                                                  \
    do {                                                                    \
        cublasStatus_t status = (call);                                     \
        if (status != CUBLAS_STATUS_SUCCESS) {                              \
            fprintf(stderr, "cuBLAS error at %s:%d — status %d\n",         \
                    __FILE__, __LINE__, status);                            \
            std::abort();                                                   \
        }                                                                   \
    } while (0)
```

---

## #pragma：不只有 once

`#pragma` 是一个"编译器私货"指令，行为由编译器决定，不属于 C++ 标准（除了 `#pragma once` 被广泛支持）。几个有用的：

### `#pragma GCC optimize`

```cpp
#pragma GCC optimize("O3", "unroll-loops")
#pragma GCC target("avx2")
```

对某个文件或函数开启特定优化，常见于竞赛代码，也有时用于 AI Infra 里针对特定热点文件单独调整编译选项。这比修改 CMakeLists 更局部，但也更不透明——谨慎使用。

### `#pragma pack`

控制结构体内存对齐：

```cpp
struct NormalStruct {
    char a;    // 1 byte
    // 3 bytes padding
    int b;     // 4 bytes
};
// sizeof(NormalStruct) == 8

#pragma pack(1)
struct PackedStruct {
    char a;    // 1 byte
    int b;     // 4 bytes，紧挨着
};
#pragma pack()  // 恢复默认
// sizeof(PackedStruct) == 5
```

消除对齐填充在网络协议包、文件格式解析时很有用，但会让 CPU 的未对齐访问变慢。另一种写法是用标准的 `alignas`/`__attribute__((packed))`（后者是 GCC/Clang 扩展）。

### `#pragma message`

编译期输出信息，不是报错：

```cpp
#pragma message("Compiling with CUDA support")
```

可以用来确认某个 `#ifdef` 分支是否被进入，比到处加 `#error` 调试要温和一些。

---

## 总结

预处理器是 C++ 工具链里最"危险"的一层，功能强大但缺乏类型系统的保护：

- **`#include`** 就是文本粘贴，`g++ -E` 可以看展开结果
- **`#define` 常量**：能用 `constexpr` 就用 `constexpr`，除非需要在 `#if` 里用
- **宏函数**：参数多次求值是核心坑，用 `inline` 模板函数替代
- **条件编译**：跨平台、功能开关的唯一选择，`#pragma once` 推荐
- **内置宏**：`__FILE__`、`__LINE__`、`__func__` 是日志和断言的基础设施
- **CUDA 场景**：`CUDA_CHECK` 宏是必备模板，`#ifdef USE_CUDA` 控制编译路径

宏不是洪水猛兽，但每次写宏之前都值得问一句：有没有更 C++ 的方式？如果有，用那个；如果没有，那就把宏写好。
