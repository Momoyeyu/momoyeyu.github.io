---
title: C++ 结构化绑定
date: 2023-06-03
description: 'tuple、pair、结构化绑定（C++17）以及返回多个值的各种方式对比。'
tags: [C++]
category: C++ 进阶
episode: 3
draft: false
lang: 'zh_CN'
---

C++ 函数只能有一个返回值——这是语言的基本约束。但现实中你经常需要同时返回多个值：比如一个函数既要给出结果张量，又要给出置信度和类别标签。怎么办？

有好几种方案，各有取舍。这篇文章把它们全部对比一遍，然后重点讲 C++17 的结构化绑定（Structured Bindings）——它不是魔法，但确实让代码干净很多。

---

## 方案一：输出参数（Out Parameters）

最老派的做法：把"要返回"的变量作为引用参数传进去，函数内部写进去，调用者读出来。

```cpp
void GetMinMax(const std::vector<int>& v, int& out_min, int& out_max) {
    out_min = *std::min_element(v.begin(), v.end());
    out_max = *std::max_element(v.begin(), v.end());
}

// 调用方
int min_val, max_val;
GetMinMax(data, min_val, max_val);
```

**缺点很明显：**

1. 调用者必须先声明变量，然后再传进去——两行代码做一件事。
2. 函数签名不直观：光看声明，你不知道哪些是输入、哪些是输出（除非靠命名约定 `out_`）。
3. 忘记初始化变量的话，行为未定义。

C 语言时代没得选，C++ 里这种写法基本上只在性能极度敏感的情况下才有理由用（比如避免拷贝大对象，但这时候你更可能用返回值优化或者移动语义）。

---

## 方案二：std::pair

`std::pair` 是标准库里最简单的"两个值打包在一起"的容器。

```cpp
#include <utility>

std::pair<int, int> GetMinMax(const std::vector<int>& v) {
    return {
        *std::min_element(v.begin(), v.end()),
        *std::max_element(v.begin(), v.end())
    };
}

// 调用方（老写法）
auto result = GetMinMax(data);
int min_val = result.first;
int max_val = result.second;

// 调用方（C++17 结构化绑定）
auto [min_val, max_val] = GetMinMax(data);
```

`std::pair` 适合恰好两个返回值的情况。标准库里 `std::map` 的迭代器就是 `pair<const Key, Value>`，`std::equal_range` 也返回 `pair<iterator, iterator>`。

**问题：** `first` 和 `second` 这两个名字没有语义，两个以上的值就没法用了。

---

## 方案三：std::tuple

`std::tuple` 是 `pair` 的泛化版本，可以打包任意数量、任意类型的值。

```cpp
#include <tuple>

std::tuple<int, double, std::string> GetStats(const std::vector<float>& scores) {
    int count = scores.size();
    double mean = std::accumulate(scores.begin(), scores.end(), 0.0) / count;
    std::string grade = mean >= 90.0 ? "A" : mean >= 60.0 ? "B" : "C";
    return std::make_tuple(count, mean, grade);
    // C++17 也可以直接写 return {count, mean, grade};
}
```

**访问方式：**

```cpp
auto stats = GetStats(scores);

// 老写法：靠索引
int n   = std::get<0>(stats);
double m = std::get<1>(stats);
std::string g = std::get<2>(stats);

// C++17 结构化绑定
auto [n, mean, grade] = GetStats(scores);
```

`std::get<0>`、`std::get<1>` 这种索引写法是 tuple 最大的痛点——你必须记住每个位置对应什么含义，顺序搞错编译器不报错但逻辑就错了。

---

## 方案四：struct（推荐）

定义一个 POD struct，字段有名字，可读性最好。

```cpp
struct InferenceResult {
    torch::Tensor output;
    float confidence;
    int label;
};

InferenceResult RunInference(const torch::Tensor& input) {
    // ... 推理逻辑 ...
    return {output_tensor, conf, class_id};
}

// 调用方
auto result = RunInference(input);
std::cout << "label: " << result.label
          << ", confidence: " << result.confidence << "\n";

// 或者用结构化绑定解包
auto [tensor, conf, label] = RunInference(input);
```

struct 相比 tuple 的优势：
- **字段有名字**，不靠索引，不会搞错顺序。
- **可以加方法**，演化为正式的类。
- IDE 的自动补全友好。
- 返回值优化（RVO/NRVO）对 struct 一样有效，没有额外开销。

**在 AI Infra 场景里，这几乎是唯一合理的选择。** 推理结果、统计信息、性能指标——这些都有明确的语义，不应该靠 `get<0>`、`get<1>` 来访问。

---

## 结构化绑定（Structured Bindings，C++17）

C++17 引入的结构化绑定让你可以把一个 struct、pair、tuple 或数组的字段"解包"到多个独立变量。

```cpp
struct Point { float x, y; };
Point p = {3.0f, 4.0f};

auto [x, y] = p;  // x = 3.0f, y = 4.0f
```

### 底层原理

结构化绑定不是魔法，编译器背后做的事情大概是：

```cpp
// auto [x, y] = p;  展开之后等价于：
auto __tmp = p;
auto& x = __tmp.x;
auto& y = __tmp.y;
```

关键点：**`auto [x, y]` 实际上是绑定到一个临时副本的引用**，不是直接绑定到原始变量。这意味着：

```cpp
Point p = {1.0f, 2.0f};
auto [x, y] = p;
x = 10.0f;  // 修改的是副本，p.x 不变
```

### 绑定引用

如果你想修改原始对象，或者想避免拷贝，用引用绑定：

```cpp
Point p = {1.0f, 2.0f};

auto& [x, y] = p;  // 绑定引用
x = 10.0f;         // p.x 现在是 10.0f

const auto& [cx, cy] = p;  // 只读绑定，适合大对象避免拷贝
```

### 适用类型

结构化绑定适用于以下几类类型：

1. **数组**：`int arr[3]; auto [a, b, c] = arr;`
2. **std::pair / std::tuple**：只要标准库里的那套 `std::tuple_size`、`std::get` 接口存在就行。
3. **聚合类型（Aggregate）**：所有非静态数据成员都是 public 的 struct/class，按声明顺序绑定。

```cpp
// 数组
int rgb[3] = {255, 128, 0};
auto [r, g, b] = rgb;

// pair
std::pair<std::string, int> kv = {"batch_size", 64};
auto [key, value] = kv;

// tuple
auto t = std::make_tuple(1, 3.14, "hello");
auto [i, d, s] = t;
```

---

## 在范围 for 中使用

最常见的用法：遍历 `std::map` 不再需要 `.first` / `.second`。

```cpp
std::map<std::string, float> hyperparams = {
    {"learning_rate", 0.001f},
    {"dropout",       0.1f},
    {"weight_decay",  1e-4f}
};

// 旧写法
for (const auto& kv : hyperparams) {
    std::cout << kv.first << " = " << kv.second << "\n";
}

// C++17 结构化绑定
for (const auto& [name, value] : hyperparams) {
    std::cout << name << " = " << value << "\n";
}
```

可读性提升非常明显。`const auto&` 保证不拷贝、不修改。

再看一个 AI Infra 场景：遍历 batch 的推理结果。

```cpp
std::vector<InferenceResult> results = RunBatchInference(batch);

for (const auto& [tensor, confidence, label] : results) {
    if (confidence > 0.9f) {
        PostProcess(tensor, label);
    }
}
```

---

## std::tie（pre-C++17 的替代方案）

如果你还需要兼容 C++14，`std::tie` 是结构化绑定出现之前的标准方案：

```cpp
#include <tuple>

int min_val, max_val;
std::tie(min_val, max_val) = GetMinMax(data);
```

`std::tie` 返回一个由引用组成的 tuple，赋值时会把右边的 tuple 各字段分别写进对应的引用。

**忽略某些字段用 `std::ignore`：**

```cpp
int min_val;
std::tie(min_val, std::ignore) = GetMinMax(data);
```

C++17 之后，结构化绑定基本上取代了 `std::tie` 的日常使用，但 `std::tie` 在需要给**已有变量**赋值时（而不是声明新变量）仍有用武之地：

```cpp
int x, y;
// 结构化绑定只能声明新变量，不能给已有变量赋值
// auto [x, y] = GetPoint();  // 错误：x, y 已经声明过了

// std::tie 可以
std::tie(x, y) = GetPoint();  // OK
```

---

## 四种方案对比

| 方案 | 可读性 | 字段名 | 值数量 | 推荐场景 |
|------|--------|--------|--------|----------|
| 输出参数 | 差 | 靠命名约定 | 任意 | 几乎不用 |
| `std::pair` | 一般 | first/second | 恰好 2 个 | 标准库接口、临时用 |
| `std::tuple` | 差 | 靠索引 | 任意 | 泛型代码、模板元编程 |
| `struct` | 最好 | 自定义 | 任意 | 正式场景（推荐） |

结构化绑定是**语法糖**，不改变你选哪种方案的决策，但让解包的代码更干净。

---

## 完整示例：推理结果解包

```cpp
#include <iostream>
#include <string>
#include <vector>
#include <map>
#include <tuple>

// 推荐：用 struct 定义返回类型
struct InferenceResult {
    std::vector<float> logits;
    float confidence;
    std::string label;
};

InferenceResult Classify(const std::vector<float>& input) {
    // 模拟推理
    std::vector<float> logits = {0.1f, 0.8f, 0.1f};
    float confidence = 0.8f;
    std::string label = "cat";
    return {logits, confidence, label};
}

int main() {
    std::vector<float> input(224 * 224 * 3, 0.5f);

    // 结构化绑定解包 struct
    auto [logits, confidence, label] = Classify(input);
    std::cout << "Label: " << label
              << ", Confidence: " << confidence << "\n";

    // 遍历 map 的典型用法
    std::map<std::string, float> metrics = {
        {"accuracy", 0.923f},
        {"latency_ms", 12.4f},
        {"throughput", 850.0f}
    };

    for (const auto& [name, val] : metrics) {
        std::cout << name << ": " << val << "\n";
    }

    return 0;
}
```

---

## 小结

- **不要用输出参数**，除非有充分的性能理由。
- **两个值**用 `std::pair` 没问题，配合结构化绑定很简洁。
- **三个以上**，或者值有明确语义，定义一个 struct，字段有名字，维护性好得多。
- **结构化绑定**是语法糖，底层就是编译器帮你生成 `auto& x = tmp.field` 这样的代码。用 `auto&` 绑定引用，用 `const auto&` 只读绑定。
- **范围 for + 结构化绑定**是现代 C++ 里遍历 map 的标准写法，`const auto& [key, value]` 比 `kv.first` / `kv.second` 清晰多了。
- **AI Infra 场景**里，推理结果、统计指标这类多字段数据天然适合 struct + 结构化绑定，既保留了字段语义，又能用解包语法写出简洁的调用代码。
