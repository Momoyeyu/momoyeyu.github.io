---
title: C++ constexpr 与编译期计算
date: 2024-02-03
description: 'const vs constexpr、编译期计算的零开销、if constexpr 的模板应用。'
tags: [C++, 性能]
category: C++ 进阶
episode: 16
draft: false
lang: 'zh_CN'
---

如果你在写 CUDA kernel，一定见过这样的代码：

```cpp
#define BLOCK_SIZE 128
#define TILE_K 32
```

用宏定义编译期常量几乎是 CUDA 代码的惯用法——因为 `#pragma unroll N` 要求 `N` 是编译期已知的，shared memory 的静态大小也必须在编译期确定。但宏有类型安全问题、没有作用域、调试时看不到值。

C++ 提供了更好的工具：`constexpr`。它把"这个值必须在编译期确定"这件事从宏的领域提升到了类型系统里。

---

## const vs constexpr：一字之差，含义迥异

先说最常见的误解：**`const` 不等于编译期常量**。

```cpp
int n = getInput();      // 运行时读取
const int cn = n;        // OK：const 是"运行时不可修改"
// cn = 42;              // 错误：不能修改
// int arr[cn];          // 错误：数组大小必须是编译期常量

constexpr int ce = 42;   // 必须在编译期确定
int arr[ce];             // OK：ce 是编译期常量
```

`const` 只保证"你不能通过这个变量名修改它"，但它的值可以完全来自运行时计算。`constexpr` 则是在告诉编译器：**这个值必须在编译期求值，如果做不到就报错**。

`constexpr` 变量自动是 `const` 的（你不能修改一个编译期常量），但反过来不成立。

几个关键使用场景的区别：

```cpp
const int a = 5;          // 编译期常量（字面量初始化）
constexpr int b = 5;      // 编译期常量，意图更明确

const int c = rand();     // 运行时 const，编译器不一定知道值
// constexpr int d = rand(); // 编译错误：rand() 不是 constexpr 函数

// 数组大小、模板参数、static_assert 只接受编译期常量
template<int N> struct Fixed {};
Fixed<a> fa;              // OK（a 是字面量初始化的 const）
Fixed<b> fb;              // OK
// Fixed<c> fc;           // 错误：c 是运行时值
```

---

## constexpr 函数

`constexpr` 不只能修饰变量，还可以修饰函数：

```cpp
constexpr int square(int x) {
    return x * x;
}
```

这个函数的行为取决于调用方式：

```cpp
constexpr int a = square(5);   // 编译期计算，a = 25，嵌入二进制
int n = 5;
int b = square(n);             // n 是运行时值，退化为普通函数调用
```

这就是 `constexpr` 函数和宏的核心区别之一：**它既可以在编译期工作，也可以在运行时工作**，编译器会根据上下文自动决定。

### 对比宏

先看宏的写法：

```cpp
#define SQ(x) ((x) * (x))

int val = SQ(++i);  // 展开为 ((++i) * (++i))，i 被自增两次！
```

宏的几个严重问题：
- **无类型检查**：`SQ("hello")` 在预处理阶段不报错，到编译才炸
- **双重求值**：参数被展开两次，有副作用的表达式（如 `++i`）会执行两次
- **无作用域**：宏是全局的，容易和其他代码冲突
- **调试不友好**：调试器看到的是展开后的代码，不是宏名

`constexpr` 函数没有这些问题：

```cpp
constexpr int square(int x) {
    return x * x;
}

int i = 3;
int val = square(++i);  // x 只绑定一次，不会双重求值，结果是 16
```

### C++14 放宽了限制

C++11 的 `constexpr` 函数只能有一条 return 语句。C++14 之后，允许：

```cpp
constexpr int fibonacci(int n) {
    if (n <= 1) return n;
    int a = 0, b = 1;        // 允许局部变量
    for (int i = 2; i <= n; ++i) {  // 允许循环
        int tmp = a + b;
        a = b;
        b = tmp;
    }
    return b;
}

constexpr int fib10 = fibonacci(10);  // 编译期计算，结果是 55
```

C++20 进一步放宽，`constexpr` 函数可以使用 `try-catch`，甚至可以是虚函数。

---

## 编译期计算的好处

"编译期计算"听起来是个小技巧，但在高性能场景里，它的价值远不止"省几次运算"。

### 零运行时开销，结果嵌入二进制

```cpp
constexpr double PI = 3.14159265358979;
constexpr double TWO_PI = 2.0 * PI;  // 编译期计算

// 汇编层面，TWO_PI 直接是立即数，不存在任何乘法指令
```

编译器会把 `constexpr` 的计算结果直接硬编码进生成的机器码，运行时什么都不做。

### 可用于数组大小、模板参数、static_assert

```cpp
constexpr int WARP_SIZE = 32;
constexpr int WARPS_PER_BLOCK = 4;
constexpr int BLOCK_SIZE = WARP_SIZE * WARPS_PER_BLOCK;  // 128，编译期

// 用于数组大小
float smem[BLOCK_SIZE];  // OK

// 用于模板参数
std::array<float, BLOCK_SIZE> buf;  // OK

// 用于 static_assert：编译期断言
static_assert(BLOCK_SIZE <= 1024, "CUDA block size cannot exceed 1024 threads");
static_assert(BLOCK_SIZE % WARP_SIZE == 0, "Block size must be a multiple of warp size");
```

`static_assert` 是编译期断言，如果条件不满足，编译直接报错，不用等到运行时才发现问题。在模板代码里用 `static_assert` 检查模板参数是否合法，是工程上非常实用的做法。

### #pragma unroll 需要编译期常量

这是 CUDA 开发里最直接的应用：

```cpp
constexpr int UNROLL_FACTOR = 4;

// #pragma unroll 要求后面的数字是编译期常量
#pragma unroll UNROLL_FACTOR
for (int i = 0; i < K; ++i) {
    acc += A[row * K + i] * B[i * N + col];
}
```

如果用 `const int UNROLL_FACTOR = 4`（运行时 const），某些编译器会拒绝接受。用 `constexpr` 则明确无误。

---

## if constexpr（C++17）

这是现代 C++ 里最实用的特性之一，专门为模板设计。

先看一个问题：你有一个模板函数，想根据 `T` 是整数还是浮点数来做不同的处理：

```cpp
// 传统做法：写两个重载，或者用 SFINAE
template<typename T>
std::enable_if_t<std::is_integral_v<T>, void>
process(T val) {
    std::cout << "Integer: " << val << "\n";
}

template<typename T>
std::enable_if_t<std::is_floating_point_v<T>, void>
process(T val) {
    std::cout << "Float: " << val << "\n";
}
```

SFINAE 的语法很晦涩，两份函数放在一起也不直观。用 `if constexpr` 可以写成：

```cpp
#include <type_traits>
#include <iostream>

template<typename T>
void process(T val) {
    if constexpr (std::is_integral_v<T>) {
        // 这个分支只在 T 是整数时编译
        std::cout << "Integer: " << val << " (hex: " << std::hex << val << ")\n";
    } else if constexpr (std::is_floating_point_v<T>) {
        // 这个分支只在 T 是浮点数时编译
        std::cout << "Float: " << std::fixed << val << "\n";
    } else {
        // 其他类型
        std::cout << "Unknown type\n";
    }
}

int main() {
    process(42);         // Integer: 42 (hex: 2a)
    process(3.14f);      // Float: 3.140000
    process(std::string("hi"));  // Unknown type
    return 0;
}
```

### if constexpr 和普通 if 的本质区别

这不只是写法上的差异。

```cpp
template<typename T>
void example(T val) {
    if constexpr (std::is_integral_v<T>) {
        int x = val * 2;      // 只有 T 是整数时才编译这行
        // 如果 T 是 std::string，这行根本不会被编译
    } else {
        val.length();         // 只有 T 有 length() 方法时才编译
        // 如果 T 是 int，这行根本不会被编译
    }
}
```

被淘汰的分支**完全不参与编译**。这有几个重要含义：

1. **不会产生编译错误**：`int` 没有 `.length()`，但因为那个分支不编译，所以不报错
2. **不会产生代码**：不参与编译意味着编译器不会为淘汰的分支生成任何机器码
3. **和普通 if 不同**：普通 `if (condition)` 两个分支都要能通过编译，只是运行时选哪个

如果改成普通 `if`：

```cpp
template<typename T>
void bad_example(T val) {
    if (std::is_integral_v<T>) {   // 普通 if，运行时判断
        val.length();              // 编译错误！int 没有 length()
    }
}
```

即使运行时永远不会走到那个分支，编译器仍然要对两个分支都做语法检查和代码生成。`if constexpr` 则真正做到了"不需要的代码彻底消失"。

---

## std::integral_constant 与 type traits

`if constexpr` 里的条件通常来自标准库的 **type traits**（类型特征）——这是一组编译期查询类型属性的工具。

```cpp
#include <type_traits>

// 判断类型是否相同
static_assert(std::is_same_v<int, int>);          // true
static_assert(!std::is_same_v<int, float>);       // false

// 判断是否是整数类型
static_assert(std::is_integral_v<int>);           // true
static_assert(std::is_integral_v<long long>);     // true
static_assert(!std::is_integral_v<float>);        // false

// 判断是否是浮点类型
static_assert(std::is_floating_point_v<float>);   // true
static_assert(std::is_floating_point_v<double>);  // true

// 判断是否是指针
static_assert(std::is_pointer_v<int*>);           // true

// 移除 const 修饰
static_assert(std::is_same_v<
    std::remove_const_t<const int>,
    int
>);
```

这些 `_v` 结尾的是 C++17 的变量模板语法糖，等价于 `std::is_integral<T>::value`。底层原理是 `std::integral_constant`：

```cpp
// 标准库内部大概是这样
template<bool B>
struct BoolConstant {
    static constexpr bool value = B;
};

using TrueType  = BoolConstant<true>;
using FalseType = BoolConstant<false>;

template<typename T>
struct IsIntegral : FalseType {};   // 默认：不是整数

template<> struct IsIntegral<int>      : TrueType {};
template<> struct IsIntegral<long>     : TrueType {};
template<> struct IsIntegral<long long>: TrueType {};
// ... 等等
```

`value` 是 `constexpr bool`，所以可以直接用在 `if constexpr` 的条件里。整个 type traits 系统就是一套精心设计的编译期类型查询接口。

---

## consteval（C++20）：比 constexpr 更严格

`constexpr` 函数有一个"退化"行为：如果参数是运行时值，它就变成普通函数。有时候你不想要这种退化——你希望函数**必须**在编译期求值，否则报错。

这就是 `consteval` 的用途：

```cpp
consteval int must_be_compile_time(int x) {
    return x * x;
}

constexpr int a = must_be_compile_time(5);   // OK：编译期求值，a = 25

int n = 5;
int b = must_be_compile_time(n);   // 编译错误！n 是运行时值，不允许退化
```

`consteval` 函数（也叫 **immediate function**，立即函数）的每次调用都必须产生编译期常量结果。

典型用途：验证编译期输入的合法性。

```cpp
// 确保模板的 block size 配置是合法的
consteval int checked_block_size(int size) {
    if (size <= 0 || size > 1024 || size % 32 != 0) {
        throw "Invalid block size";  // consteval 函数里 throw 会变成编译错误
    }
    return size;
}

constexpr int BLOCK_SIZE = checked_block_size(128);  // OK
// constexpr int BAD = checked_block_size(100);      // 编译错误：100 不是 32 的倍数
```

---

## AI Infra 实战场景

把以上概念串起来，看看在 CUDA/AI Infra 代码里怎么用。

### 场景一：编译期确定的 kernel 参数

```cpp
// 把 kernel 的关键参数定义为 constexpr
constexpr int WARP_SIZE   = 32;
constexpr int BLOCK_SIZE  = 128;
constexpr int TILE_M      = 64;
constexpr int TILE_N      = 64;
constexpr int TILE_K      = 32;

// 编译期验证配置合法性
static_assert(BLOCK_SIZE % WARP_SIZE == 0,
    "Block size must be a multiple of warp size");
static_assert(TILE_K > 0 && TILE_K <= 64,
    "Tile K must be in [1, 64]");

template<typename T, int BM, int BN, int BK>
__global__ void gemm_kernel(const T* A, const T* B, T* C, int M, int N, int K) {
    // BM, BN, BK 是编译期常量，shared memory 大小静态确定
    __shared__ T smem_A[BM][BK];
    __shared__ T smem_B[BK][BN];

    // 编译器可以自动展开这个循环（大小是编译期已知的）
    #pragma unroll BK
    for (int k = 0; k < BK; ++k) {
        // 累加
    }
}
```

### 场景二：根据数据类型选择不同实现

```cpp
#include <type_traits>
#include <cuda_fp16.h>

template<typename T>
__device__ T fast_activate(T x) {
    if constexpr (std::is_same_v<T, float>) {
        // float 用精确 tanh
        return tanhf(x);
    } else if constexpr (std::is_same_v<T, __half>) {
        // half 用近似实现（更快）
        return __float2half(tanhf(__half2float(x)));
    } else if constexpr (std::is_same_v<T, __nv_bfloat16>) {
        return __float2bfloat16(tanhf(__bfloat162float(x)));
    } else {
        static_assert(sizeof(T) == 0, "Unsupported data type for fast_activate");
    }
}
```

注意最后那个 `else` 分支里的 `static_assert(sizeof(T) == 0, ...)`：这是一个常见技巧，用来在不支持的类型上触发编译错误，并给出清晰的错误信息。`sizeof(T) == 0` 永远为 false（任何类型大小至少为 1），所以这个 assert 一旦被实例化就必然触发。

### 场景三：constexpr 辅助函数计算 launch 参数

```cpp
// 编译期计算 grid size
constexpr int ceil_div(int a, int b) {
    return (a + b - 1) / b;
}

// 在 host 代码里用
void launch_kernel(int M, int N) {
    constexpr int BLOCK = 128;
    // grid size 是运行时的（M、N 运行时才知道），block size 是编译期的
    dim3 block(BLOCK);
    dim3 grid(ceil_div(N, BLOCK), ceil_div(M, BLOCK));
    my_kernel<BLOCK><<<grid, block>>>(/* ... */);
}
```

`ceil_div` 既可以在编译期（处理 constexpr 参数时）也可以在运行时调用，一份代码两种用途。

---

## 小结

| 概念 | 要点 |
|---|---|
| `const` | 运行时不可修改；值可以来自运行时 |
| `constexpr` 变量 | 编译期求值；自动是 `const` |
| `constexpr` 函数 | 参数是编译期常量时编译期求值；否则退化为运行时函数 |
| `consteval` (C++20) | 强制编译期求值，不允许退化 |
| `if constexpr` | 编译期选择分支；被淘汰的分支不编译 |
| type traits | 编译期查询类型属性；配合 `if constexpr` 做类型分发 |
| `static_assert` | 编译期断言；条件不满足时编译报错 |

从宏到 `constexpr` 的迁移，本质上是把"魔法数字"从预处理器的领域提升到 C++ 类型系统里——有类型检查、有作用域、可以参与重载决议，调试器能看到名字和值，但运行时开销依然是零。

对于 AI Infra 和 CUDA 开发者来说，`constexpr` + `if constexpr` 的组合几乎是必须掌握的工具：它让你写出既支持多种数据类型、又没有运行时类型判断开销的高性能 kernel——而这正是 GPU 代码最需要的性质。
