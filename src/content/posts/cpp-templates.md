---
title: C++ 模板
date: 2023-06-18
description: '函数模板、类模板、模板特化，以及模板如何实现零开销抽象。'
tags: [C++, 模板]
category: C++ 进阶
episode: 4
draft: false
lang: 'zh_CN'
---

如果你写过 CUDA kernel，一定遇到过这种头疼的场景：同一套逻辑，要分别写一份 `float` 版本、一份 `half` 版本、可能还要一份 `int8` 版本。复制粘贴三份？维护起来是噩梦。用 `if (dtype == FLOAT)` 在运行时做分支？这意味着每次调用都要多一次判断，编译器也很难优化。

C++ 模板就是专门解决这个问题的工具。它让你写一次代码，编译器在编译期帮你生成多份类型化的版本——没有运行时开销，没有类型擦除，生成的代码和你手写三份一模一样。

---

## 函数模板

最基础的用法：

```cpp
template<typename T>
T Max(T a, T b) {
    return a > b ? a : b;
}
```

`typename T` 是一个**类型占位符**，编译器会根据你的调用来决定 `T` 是什么。调用时有两种写法：

```cpp
int a = Max<int>(3, 5);      // 显式指定类型
double b = Max(1.5, 2.3);    // 让编译器推导，T = double
```

第二种写法叫做**模板参数推导（Template Argument Deduction）**，编译器根据实参类型自动推断 `T`，大多数情况下都能正确工作。

关键要理解的一点：**模板代码本身不是可执行代码，它只是一个"蓝图"**。每当你用一个新的类型去实例化模板，编译器就根据这个蓝图生成一份真实的函数。`Max<int>` 和 `Max<double>` 是两个完全独立的函数，汇编层面没有任何共享。

```cpp
#include <iostream>

template<typename T>
T Max(T a, T b) {
    return a > b ? a : b;
}

int main() {
    std::cout << Max(3, 5) << "\n";        // 实例化 Max<int>
    std::cout << Max(1.5, 2.3) << "\n";   // 实例化 Max<double>
    std::cout << Max('a', 'z') << "\n";   // 实例化 Max<char>
    return 0;
}
```

---

## 类模板

模板不只能用于函数，类也可以参数化。而且模板参数不仅仅是类型，还可以是**非类型参数**（编译期常量）：

```cpp
template<typename T, int N>
class FixedArray {
public:
    T data[N];

    int size() const { return N; }

    T& operator[](int i) { return data[i]; }
    const T& operator[](int i) const { return data[i]; }
};
```

用起来是这样的：

```cpp
FixedArray<float, 4> vec4;     // 4 个 float，栈上分配
FixedArray<int, 256> buffer;   // 256 个 int

vec4[0] = 1.0f;
std::cout << vec4.size() << "\n";  // 4
```

`std::array<int, 5>` 就是标准库里相同思路的实现。注意 `N` 是**编译期常量**，所以 `data[N]` 是栈上固定大小的数组，没有堆分配，没有指针间接寻址。

这在 AI Infra 场景非常有用。比如实现一个编译期确定维度的小向量类（用于 warp-level 寄存器操作），就可以用这种方式：大小在编译期已知，编译器可以展开循环，做寄存器级别的优化。

---

## 模板实例化的代价

模板的好处是零运行时开销，代价是**二进制体积**。

每个不同的模板参数组合都会生成一份独立的代码。`FixedArray<float, 4>` 和 `FixedArray<float, 8>` 是两个完全不同的类，编译出来是两份独立的机器码。如果你把 N 参数化地用了 100 种不同的值，就会有 100 份代码。

对比虚函数：

| | 模板（编译期多态） | 虚函数（运行期多态） |
|---|---|---|
| 调度时机 | 编译期 | 运行期 |
| 运行时开销 | 无 | 虚表查找（间接寻址） |
| 代码体积 | 每个实例一份，体积较大 | 共享实现，体积较小 |
| 内联优化 | 编译器可以完全内联 | 虚函数通常无法内联 |
| 适用场景 | 类型在编译期已知 | 类型在运行期确定 |

对于 CUDA kernel 来说，答案几乎总是选模板——kernel 的精度类型在 launch 时就确定了，而且虚函数在 GPU 上的表现很差（GPU 不擅长分支和间接寻址）。

---

## 模板特化

有时候，通用的模板逻辑对某个特定类型并不适用，或者可以有更高效的实现。这时可以给那个类型写一份"特殊版本"，叫做**模板特化**。

### 全特化

对某个具体类型提供完全不同的实现：

```cpp
// 通用版本
template<typename T>
struct Serialize {
    static std::string to_string(T val) {
        return std::to_string(val);
    }
};

// 针对 bool 的全特化
template<>
struct Serialize<bool> {
    static std::string to_string(bool val) {
        return val ? "true" : "false";
    }
};

int main() {
    std::cout << Serialize<int>::to_string(42) << "\n";    // "42"
    std::cout << Serialize<bool>::to_string(true) << "\n"; // "true"
    return 0;
}
```

编译器会优先选择最匹配的特化版本。

### 偏特化

偏特化是只固定部分模板参数，剩下的仍然是泛型的。函数模板不支持偏特化，但类模板支持：

```cpp
// 通用版本
template<typename T, typename Allocator>
class Buffer { ... };

// 偏特化：当 T 是指针类型时
template<typename T, typename Allocator>
class Buffer<T*, Allocator> {
    // 对指针类型做特殊处理
};
```

标准库里最著名的特化案例是 `std::vector<bool>`——它把每个 `bool` 压缩成一个比特位存储，而不是一个字节，节省空间。这是一个全特化，行为和普通 `std::vector<T>` 有所不同（也因此饱受争议）。

---

## SFINAE 简介

SFINAE 全称是 **Substitution Failure Is Not An Error**（替换失败不是错误）。

这是 C++ 的一个规则：当编译器尝试用某种类型去实例化一个模板，如果替换失败（比如某个表达式不合法），编译器不会报错，而是**静默地跳过这个候选函数，去找别的重载**。利用这个规则，可以根据类型特征来选择不同的函数实现。

```cpp
#include <type_traits>
#include <iostream>

// 只对整数类型启用这个函数
template<typename T>
std::enable_if_t<std::is_integral_v<T>, void>
print_type(T val) {
    std::cout << "Integer: " << val << "\n";
}

// 只对浮点类型启用
template<typename T>
std::enable_if_t<std::is_floating_point_v<T>, void>
print_type(T val) {
    std::cout << "Float: " << val << "\n";
}

int main() {
    print_type(42);     // Integer: 42
    print_type(3.14);   // Float: 3.14
    return 0;
}
```

`std::enable_if_t<条件, 返回类型>` 的意思是：如果条件为真，返回类型正常；条件为假，替换失败，这个函数从候选列表里消失。

SFINAE 的语法有些晦涩。C++20 引入了 `concept`，用更直观的方式表达同样的约束：

```cpp
#include <concepts>
#include <iostream>

template<std::integral T>
void print_type(T val) {
    std::cout << "Integer: " << val << "\n";
}

template<std::floating_point T>
void print_type(T val) {
    std::cout << "Float: " << val << "\n";
}
```

`concept` 的语法更清晰，错误信息也更友好。如果你用的是 C++20 以上，优先用 `concept`。

---

## 变长模板（Variadic Templates）

有时候你需要接受任意数量、任意类型的参数。C++11 引入了变长模板来解决这个问题：

```cpp
template<typename... Args>
void print_all(Args... args);
```

`...` 叫做**参数包（parameter pack）**。展开参数包的传统方式是递归：

```cpp
#include <iostream>

// 递归终止：零个参数时什么都不做
void print_all() {}

// 递归展开
template<typename First, typename... Rest>
void print_all(First first, Rest... rest) {
    std::cout << first << " ";
    print_all(rest...);  // 递归，参数少一个
}

int main() {
    print_all(1, 2.5, "hello", 'x');  // 1 2.5 hello x
    return 0;
}
```

C++17 引入了**折叠表达式（Fold Expression）**，可以用更简洁的方式展开参数包，不需要写递归：

```cpp
#include <iostream>

template<typename... Args>
void print_all(Args... args) {
    ((std::cout << args << " "), ...);  // 折叠表达式
    std::cout << "\n";
}

template<typename... Args>
auto sum(Args... args) {
    return (args + ...);  // 把所有参数加起来
}

int main() {
    print_all(1, 2.5, "hello");   // 1 2.5 hello
    std::cout << sum(1, 2, 3, 4) << "\n";  // 10
    return 0;
}
```

`std::tuple` 的实现原理就是变长模板——`tuple<int, double, std::string>` 在编译期展开成一个包含三种不同类型字段的结构体。

---

## 一个实际例子：泛型 Reduce

下面是一个结合以上概念、在 AI Infra 场景有实际意义的例子：泛型规约（reduce）函数。

```cpp
#include <iostream>
#include <cstddef>

// 编译期确定大小的数组 reduce
// T: 元素类型，N: 数组长度，Op: 规约操作（函数对象）
template<typename T, std::size_t N, typename Op>
T array_reduce(const T (&arr)[N], Op op, T init) {
    T result = init;
    for (std::size_t i = 0; i < N; ++i) {
        result = op(result, arr[i]);
    }
    return result;
}

int main() {
    float data[8] = {1.0f, 2.0f, 3.0f, 4.0f, 5.0f, 6.0f, 7.0f, 8.0f};

    // 求和
    float sum = array_reduce(data, [](float a, float b) { return a + b; }, 0.0f);
    std::cout << "Sum: " << sum << "\n";  // 36

    // 求最大值
    float maxval = array_reduce(data, [](float a, float b) { return a > b ? a : b; }, data[0]);
    std::cout << "Max: " << maxval << "\n";  // 8

    int ints[4] = {3, 1, 4, 1};
    int prod = array_reduce(ints, [](int a, int b) { return a * b; }, 1);
    std::cout << "Product: " << prod << "\n";  // 12

    return 0;
}
```

这段代码里：
- `T` 和 `Op` 是类型参数，支持任意元素类型和任意操作
- `N` 是非类型参数，从数组引用自动推导，不需要显式传入
- lambda 作为 `Op` 传入，编译器会把它内联进循环，**不产生任何函数调用开销**

如果换成虚函数版本，`op` 就是一个虚函数调用，循环里每次都有间接寻址——对于大数组的 reduce，这个开销是明显的。

---

## 在 AI Infra 里的应用

CUDA kernel 是模板编程最自然的应用场景之一。以 CUDA 里的矩阵乘法 kernel 为例，通常会这样写：

```cpp
template<typename T, int BLOCK_M, int BLOCK_N, int BLOCK_K>
__global__ void gemm_kernel(
    const T* A, const T* B, T* C,
    int M, int N, int K
) {
    // 用模板参数控制 shared memory 大小和循环展开
    __shared__ T smem_A[BLOCK_M][BLOCK_K];
    __shared__ T smem_B[BLOCK_K][BLOCK_N];
    // ...
}

// 在 host 端根据精度和 tile size 选择实例
void launch_gemm(DataType dtype, ...) {
    if (dtype == DataType::Float32) {
        gemm_kernel<float, 128, 128, 32><<<grid, block>>>(A, B, C, M, N, K);
    } else if (dtype == DataType::Float16) {
        gemm_kernel<__half, 128, 128, 64><<<grid, block>>>(A, B, C, M, N, K);
    }
}
```

`BLOCK_M`、`BLOCK_N`、`BLOCK_K` 这些 tile 大小是非类型模板参数——它们在编译期确定，编译器可以自动展开循环、计算静态 shared memory 的大小。Thrust 和 CUB 库里大量用了这种模式。

PyTorch 的 dispatcher 机制本质上也在做类似的事情——在运行时根据 tensor 的 dtype 分发到对应的模板实例。只不过 Python 动态性的约束使它必须在运行时做这层分发，而纯 C++/CUDA 代码可以把分发提前到编译期。

---

## 小结

| 概念 | 核心要点 |
|---|---|
| 函数模板 | `template<typename T>`，编译期实例化，每种类型生成独立函数 |
| 类模板 | 支持类型参数和非类型参数，`std::array<T, N>` 是典型例子 |
| 实例化代价 | 零运行时开销，但每个实例化增加二进制体积 |
| 模板特化 | 为特定类型提供专属实现；全特化 vs 偏特化 |
| SFINAE / Concept | 根据类型特征启用/禁用函数重载；C++20 用 concept 代替 SFINAE |
| 变长模板 | `typename... Args`，配合折叠表达式（C++17）展开参数包 |

模板编程的核心价值在于：**把"类型"从运行时变量变成编译期常量**。一旦类型是编译期已知的，编译器可以做的优化空间就大得多——内联、循环展开、常量折叠，这些在虚函数那条路上几乎做不到。这正是高性能计算代码（包括 CUDA 和 HPC 库）大量依赖模板而不是继承体系的根本原因。
