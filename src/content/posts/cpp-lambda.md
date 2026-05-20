---
title: C++ Lambda 与函数指针
published: 2023-08-08
description: '函数指针、std::function、lambda 的本质，以及捕获列表的内存语义。'
tags: [C++]
category: C++ 进阶
episode: 7
draft: false
lang: 'zh_CN'
---

在写 AI Infra 代码时，你会大量遇到这样的模式：把一段逻辑"传递"给另一个函数执行——无论是 CPU 端的数据预处理管道，还是 `thrust::transform` 里的元素级变换。理解 C++ 里函数指针、`std::function`、lambda 三者的本质和权衡，是写出高效、可维护代码的前提。

---

## 函数指针：最原始的"把函数当参数"

先从最底层开始。函数名本身就是一个指向该函数机器码的指针：

```cpp
void print_value(int x) {
    std::cout << "value: " << x << "\n";
}

int main() {
    // 函数名即指针，可以直接赋值
    void (*fn)(int) = print_value;
    fn(42);  // 等价于 print_value(42)
}
```

这个语法 `void (*fn)(int)` 读起来有点反人类——"fn 是一个指针，指向参数为 int、返回值为 void 的函数"。嵌套指针、加上 const 修饰之后更是灾难。`using` 和 `auto` 是救命稻草：

```cpp
// 用 using 给函数指针类型起别名
using TransformFn = float (*)(float);

float relu(float x)  { return x > 0 ? x : 0.f; }
float sigmoid(float x) { return 1.f / (1.f + std::exp(-x)); }

void apply(float* data, int n, TransformFn fn) {
    for (int i = 0; i < n; i++) data[i] = fn(data[i]);
}

apply(buffer, 1024, relu);
apply(buffer, 1024, sigmoid);
```

函数指针作为回调参数，在 C 时代就是组合逻辑的主要手段。它的优点是**零开销**——本质上就是一次间接跳转；缺点是**无法捕获状态**，你没有办法让一个裸函数指针"记住"额外的上下文。

---

## Lambda 的本质：编译器帮你写的匿名结构体

Lambda 表达式 `[capture](params) -> ret { body }` 表面看是语法糖，背后是编译器生成的一个**匿名结构体（闭包类型）**。

来看一个具体例子：

```cpp
float threshold = 0.5f;
auto filter = [threshold](float x) -> bool {
    return x > threshold;
};
```

编译器大致会把它翻译成这样（伪代码）：

```cpp
struct __lambda_filter {
    float threshold;  // 捕获的变量成为成员

    bool operator()(float x) const {
        return x > threshold;
    }
};

__lambda_filter filter{threshold};  // 用当前 threshold 值初始化
```

这就解释了所有捕获列表的行为：

- **`[=]` 值捕获**：用到的外部变量被拷贝成闭包对象的成员变量。lambda 存活多久，这份拷贝就存活多久，和原变量完全独立。
- **`[&]` 引用捕获**：闭包对象存的是对外部变量的引用（本质是指针）。如果 lambda 活得比被捕获的变量长，就是悬垂引用——未定义行为。
- **`[x, &y]` 混合捕获**：x 按值拷贝，y 按引用。

```cpp
int base = 100;
auto add_base = [base](int x) { return x + base; };  // 拷贝 base

base = 9999;  // 改变原变量
std::cout << add_base(1);  // 输出 101，不是 10000，因为 base 已经被拷贝
```

### mutable：允许修改值捕获的副本

默认情况下，值捕获产生的成员变量在 `operator()` 内是 `const` 的（因为 `operator()` 默认加了 `const` 修饰）。加 `mutable` 去掉这个限制：

```cpp
int counter = 0;
auto increment = [counter]() mutable {
    return ++counter;  // 修改的是闭包对象内的拷贝，不影响外部 counter
};

increment();  // 返回 1
increment();  // 返回 2
std::cout << counter;  // 仍然是 0
```

### 无捕获 lambda 可以转换成函数指针

如果 lambda 不捕获任何东西，它可以隐式转换成对应签名的函数指针——这是能把 lambda 传给 C API 的前提：

```cpp
auto square = [](float x) { return x * x; };
TransformFn fn = square;  // OK，无捕获 lambda → 函数指针
apply(buffer, 1024, fn);
```

一旦有捕获，这条路就断了。闭包对象携带了状态，而函数指针只是一个地址，没地方存状态。

---

## 悬垂引用：引用捕获最常见的坑

引用捕获让 lambda 直接操作外部变量，但如果 lambda "逃逸"出变量的作用域，就会产生悬垂引用：

```cpp
std::function<int()> make_counter() {
    int count = 0;
    // 危险：引用捕获了局部变量 count
    return [&count]() { return ++count; };
}

auto counter = make_counter();
counter();  // UB！count 已经析构，这是在访问野内存
```

正确做法是值捕获：

```cpp
std::function<int()> make_counter() {
    int count = 0;
    return [count]() mutable { return ++count; };  // 拷贝 count 进闭包
}
```

经验法则：**lambda 如果会离开当前作用域（存入容器、作为返回值、传给异步任务），一律用值捕获**，除非你非常确定生命周期。

---

## std::function：类型擦除的万能包装器

函数指针有个致命局限：类型里必须写死签名，而且无法存有状态的 lambda。`std::function` 解决了这个问题：

```cpp
#include <functional>

std::function<float(float)> activation;

activation = relu;                          // 函数指针
activation = [](float x) { return x; };    // 无捕获 lambda
activation = [scale](float x) { return x * scale; };  // 有捕获 lambda

struct Sigmoid {
    float operator()(float x) const {
        return 1.f / (1.f + std::exp(-x));
    }
};
activation = Sigmoid{};  // 仿函数（functor）
```

`std::function` 内部用类型擦除实现：它在堆上（或小对象优化的栈缓冲区上）存一份可调用对象的拷贝，通过虚函数表（或函数指针表）来调用。这带来了极大的灵活性，但也有开销：

- **堆分配**（当闭包对象太大时）
- **虚函数分派**（间接调用）

在数据预处理管道、配置驱动的算子选择等场景，这些开销完全可以接受。但在逐元素处理的热路径上，就需要小心了。

---

## Lambda 配合 STL 算法

STL 算法 + lambda 是 C++ 数据处理的标准写法，可读性和性能兼顾：

```cpp
#include <algorithm>
#include <vector>
#include <numeric>

std::vector<float> logits = {-1.2f, 0.5f, 3.1f, -0.3f, 2.7f};

// 找第一个超过阈值的元素
float threshold = 2.0f;
auto it = std::find_if(logits.begin(), logits.end(),
    [threshold](float x) { return x > threshold; });

// 对所有元素应用 relu，结果存入另一个 vector
std::vector<float> activations(logits.size());
std::transform(logits.begin(), logits.end(), activations.begin(),
    [](float x) { return std::max(0.f, x); });

// 打印所有正值
std::for_each(activations.begin(), activations.end(),
    [](float x) { if (x > 0) std::cout << x << " "; });

// 用自定义比较器排序（按绝对值降序）
std::sort(logits.begin(), logits.end(),
    [](float a, float b) { return std::abs(a) > std::abs(b); });
```

`std::sort` 的比较器就是一个经典的函数指针回调场景——lambda 让这里的代码比写单独的比较函数简洁得多。

---

## 性能敏感代码：用模板代替 std::function

如果你在写一个要被大量调用的工具函数（比如数据加载器里的 batch 变换），`std::function` 的开销可能不可忽视。正确做法是用模板：

```cpp
// 慢：std::function 有类型擦除开销
void transform_batch_slow(float* data, int n, std::function<float(float)> fn) {
    for (int i = 0; i < n; i++) data[i] = fn(data[i]);
}

// 快：模板参数，编译器可以内联
template<typename F>
void transform_batch(float* data, int n, F fn) {
    for (int i = 0; i < n; i++) data[i] = fn(data[i]);
}

// 调用方式完全一样
transform_batch(buffer, 1024, [](float x) { return std::max(0.f, x); });
transform_batch(buffer, 1024, relu);
```

模板版本让编译器在实例化时知道 `F` 的具体类型，可以直接内联调用，甚至触发自动向量化（SIMD）。`std::function` 版本因为有间接调用，编译器几乎不可能内联。

对于 CUDA 端，Thrust 库就是这个思路的极致体现：

```cpp
#include <thrust/device_vector.h>
#include <thrust/transform.h>

thrust::device_vector<float> d_input = /* ... */;
thrust::device_vector<float> d_output(d_input.size());

// Thrust 的 transform 接受 functor，编译器会把它内联进 CUDA kernel
thrust::transform(d_input.begin(), d_input.end(), d_output.begin(),
    [] __device__ (float x) { return fmaxf(0.f, x); }
);
```

注意 CUDA lambda 需要加 `__device__` 修饰（有时需要 `__host__ __device__`），并且**不能捕获主机端的指针或引用**。如果需要传参数，值捕获基础类型（`float`、`int`）是安全的。

---

## 一张图总结

| | 函数指针 | Lambda（无捕获） | Lambda（有捕获） | std::function |
|---|---|---|---|---|
| 有状态 | 否 | 否 | 是 | 是 |
| 可转成函数指针 | 是 | 是 | 否 | 否 |
| 调用开销 | 极低 | 极低 | 极低 | 中等（虚调用） |
| 模板可内联 | 是 | 是 | 是 | 否 |
| 用于 CUDA | 是 | 是（加修饰符） | 有限制 | 否 |

**选择策略**：
- 热路径 + 无状态 → 函数指针或无捕获 lambda
- 热路径 + 有状态 → 有捕获 lambda + 模板参数
- 配置驱动 / 存入容器 → `std::function`
- CUDA kernel 内 → functor 结构体或 `__device__` lambda

---

## 小结

Lambda 不是什么神秘的函数式魔法，它就是编译器替你生成的一个结构体——捕获的变量是成员，函数体是 `operator()`。理解了这一点，捕获列表的所有行为（值捕获拷贝、引用捕获悬垂、mutable、无捕获转函数指针）都有了合理的解释。

`std::function` 的类型擦除让它非常灵活，但灵活是有代价的——性能敏感的路径上，模板 + lambda 才是正道。这在 AI Infra 开发里尤为重要：CPU 端的数据管道用模板组合 lambda，CUDA 端用 `__device__` functor 驱动 kernel，两端的设计思路是一致的。
