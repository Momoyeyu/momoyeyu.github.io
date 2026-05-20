---
title: C++ optional、variant 与 any
published: 2023-10-15
description: '用 optional 替代 nullptr、variant 实现类型安全的 union，以及 any 存储任意类型。'
tags: [C++, STL]
category: C++ 进阶
episode: 11
draft: false
lang: 'zh_CN'
---

C++17 带来了三个处理"值可能不存在"或"类型不确定"场景的工具：`std::optional`、`std::variant` 和 `std::any`。它们解决的是同一类问题——如何优雅地表达不确定性——但适用场景各有侧重。

---

## std::optional：比 nullptr 更诚实

### 旧方案的痛点

函数返回值"可能没有意义"是个很常见的场景。传统 C++ 有几种处理方式，每一种都有问题：

```cpp
// 方案一：返回哨兵值，-1 代表"没找到"
int FindIndex(const std::vector<int>& vec, int target) {
    for (int i = 0; i < vec.size(); i++)
        if (vec[i] == target) return i;
    return -1;  // 问题：-1 是合法索引吗？调用方必须知道这个约定
}

// 方案二：返回指针，nullptr 代表"没有"
const std::string* ReadConfig(const std::string& key) {
    // 返回 nullptr 意味着什么？找不到？出错了？还是值就是空？
}

// 方案三：out 参数
bool ReadFile(const std::string& path, std::string& out) {
    // 接口污染，调用方必须先声明一个空变量
}
```

这些方案的问题不在于"不能用"，而在于**语义不清晰**——调用方必须阅读文档（或者源码）才知道返回值的含义。

### std::optional 的做法

`std::optional<T>` 的语义非常直接：**要么有一个 T，要么什么都没有**。

```cpp
#include <optional>
#include <fstream>
#include <string>

std::optional<std::string> ReadFile(const std::string& path) {
    std::ifstream file(path);
    if (!file.is_open())
        return std::nullopt;  // 明确表示"没有值"

    std::string content((std::istreambuf_iterator<char>(file)),
                         std::istreambuf_iterator<char>());
    return content;
}

int main() {
    auto result = ReadFile("config.txt");

    // 方式一：has_value()
    if (result.has_value()) {
        std::cout << result.value() << "\n";
    }

    // 方式二：隐式 bool 转换（更简洁）
    if (result) {
        std::cout << *result << "\n";
    }

    // 方式三：value_or，提供默认值（最实用）
    std::string content = result.value_or("# 默认配置\ntimeout=30\n");
    std::cout << content << "\n";

    // value() 在没有值时抛 std::bad_optional_access
    // *result 在没有值时是 UB，等同于解引用空指针，小心
}
```

`value_or` 是我用得最多的 API。在配置读取、参数解析这类场景里，默认值是非常自然的概念：

```cpp
// 伪代码：推理服务配置
int timeout    = config.Get("timeout").value_or(30);
int batch_size = config.Get("batch_size").value_or(1);
float threshold = config.Get("threshold").value_or(0.5f);
```

这比到处写 `if (config.Has("timeout")) ... else timeout = 30;` 干净得多。

### 底层实现：不涉及堆分配

`std::optional<T>` 的内存布局大概是这样：

```
[ bool has_value ][ padding ][ T storage ]
```

它在**栈上分配**，不涉及堆，所以没有动态分配的开销。大小通常是 `sizeof(T)` 加上 bool 和对齐的开销。

```cpp
std::cout << sizeof(std::optional<int>)         << "\n";  // 8（4+bool+padding）
std::cout << sizeof(std::optional<std::string>) << "\n";  // 通常是 sizeof(string)+8
```

这意味着 `optional` 可以放心用在性能敏感路径上，不用担心频繁分配。

---

## std::variant：知道自己是什么类型的 union

### union 的致命缺陷

C 的 `union` 让多个类型共享同一块内存，但它有个根本问题：**它自己不知道当前存的是哪种类型**。

```cpp
union Value {
    int   i;
    float f;
    char* s;
};

Value v;
v.i = 42;
// 接下来你可以读 v.f，编译器不会阻止你，但结果是 UB
float oops = v.f;  // 解释同一块内存，完全合法但语义错误
```

你必须在 union 外面另存一个"类型标签"，自己维护一致性。这就是"tagged union"，但完全靠人工，出错了只有运行时才发现。

### std::variant：类型安全的 tagged union

```cpp
#include <variant>
#include <string>

using Value = std::variant<int, float, std::string>;

Value v = 42;
std::cout << std::get<int>(v) << "\n";  // 42

v = 3.14f;
std::cout << std::get<float>(v) << "\n";  // 3.14

v = std::string("hello");

// 类型检查
if (std::holds_alternative<std::string>(v)) {
    std::cout << std::get<std::string>(v) << "\n";  // hello
}

// get_if：返回指针，类型不对返回 nullptr，不抛异常
if (auto* s = std::get_if<std::string>(&v)) {
    std::cout << *s << "\n";
}

// std::get 在类型不对时抛 std::bad_variant_access
try {
    std::get<int>(v);  // v 现在是 string，这里会抛异常
} catch (const std::bad_variant_access& e) {
    std::cerr << e.what() << "\n";
}
```

### std::visit：优雅地处理所有可能的类型

`std::get` 适合你已经知道类型的情况。如果你需要根据当前类型做不同的事，用 `std::visit`：

```cpp
std::variant<int, float, std::string> v = 3.14f;

// visitor 必须能处理所有可能的类型
std::visit([](auto&& val) {
    using T = std::decay_t<decltype(val)>;
    if constexpr (std::is_same_v<T, int>)
        std::cout << "int: " << val << "\n";
    else if constexpr (std::is_same_v<T, float>)
        std::cout << "float: " << val << "\n";
    else if constexpr (std::is_same_v<T, std::string>)
        std::cout << "string: " << val << "\n";
}, v);
```

更优雅的方式是用"overloaded"技巧，用多个 lambda 构造一个 visitor：

```cpp
// 工具结构体：把多个 callable 合并成一个 visitor
template<class... Ts>
struct overloaded : Ts... {
    using Ts::operator()...;
};
// C++17 推导指引（C++20 不需要）
template<class... Ts>
overloaded(Ts...) -> overloaded<Ts...>;

// 使用
std::visit(overloaded{
    [](int i)               { std::cout << "int: "    << i << "\n"; },
    [](float f)             { std::cout << "float: "  << f << "\n"; },
    [](const std::string& s){ std::cout << "string: " << s << "\n"; }
}, v);
```

这个写法在 C++ 社区里很常见，建议直接放进项目的工具头文件里。

### 实际场景：张量数据类型

在 AI Infra 里，张量的数据类型是运行时决定的，但类型集合是编译期已知的。`variant` 非常适合这个场景：

```cpp
#include <variant>
#include <vector>
#include <cstdint>

using TensorData = std::variant<
    std::vector<float>,
    std::vector<double>,
    std::vector<int32_t>,
    std::vector<uint8_t>   // INT8 量化
    // std::vector<__half>  // FP16，需要 CUDA 头
>;

struct Tensor {
    std::vector<int64_t> shape;
    TensorData data;
};

// 计算元素总数
size_t NumElements(const Tensor& t) {
    return std::visit([](const auto& vec) -> size_t {
        return vec.size();
    }, t.data);
}

// 根据类型做不同的处理
void ProcessTensor(const Tensor& t) {
    std::visit(overloaded{
        [](const std::vector<float>& d)   { /* FP32 kernel */ },
        [](const std::vector<int32_t>& d) { /* INT32 kernel */ },
        [](const auto& d)                 { /* fallback */ }
    }, t.data);
}
```

这比维护一个 `enum DataType` 加一个 `void*` 的方案安全得多——忘记处理某种类型时，编译器（或 visit 的穷举检查）会提醒你。

### 推理结果：分类或回归

```cpp
// 推理输出可能是分类标签，也可能是回归值
using InferenceResult = std::variant<
    int,         // 分类：class index
    float,       // 回归：连续值
    std::string  // 检测：JSON 格式的边界框
>;

InferenceResult RunInference(const Tensor& input) {
    // ... 根据模型类型返回不同结果
    if (is_classifier) return 3;          // class 3
    if (is_regressor)  return 0.87f;      // score
    return std::string(R"({"x":10,"y":20})");
}
```

---

## std::any：类型擦除的终极方案

### 存储任意类型

`std::any` 可以存储任何可拷贝构造的类型，不需要在编译期指定类型列表：

```cpp
#include <any>
#include <string>

std::any a = 42;
std::cout << std::any_cast<int>(a) << "\n";  // 42

a = std::string("hello");
std::cout << std::any_cast<std::string>(a) << "\n";  // hello

a = 3.14;
// std::any_cast<int>(a) 会抛 std::bad_any_cast
try {
    std::any_cast<int>(a);
} catch (const std::bad_any_cast& e) {
    std::cerr << e.what() << "\n";
}

// 用指针版本避免异常
if (auto* p = std::any_cast<double>(&a)) {
    std::cout << *p << "\n";  // 3.14
}

// 检查是否有值，以及当前类型
std::cout << a.has_value() << "\n";       // 1
std::cout << a.type().name() << "\n";     // 取决于实现（可能是 "d"）
a.reset();                                // 清空
std::cout << a.has_value() << "\n";       // 0
```

### any vs variant：如何选择

| 特性 | `std::variant` | `std::any` |
|------|---------------|------------|
| 类型集合 | 编译期固定 | 运行期任意 |
| 类型安全 | 编译期检查（穷举） | 运行期检查 |
| 内存分配 | 栈上，无堆分配 | 小对象优化，大对象堆分配 |
| 性能 | 更好 | 有额外开销 |
| 适用场景 | 已知类型集合 | 类型完全未知 |

`std::any` 的典型使用场景是**插件系统**或**消息总线**——组件之间传递的数据类型在编译期无法预知：

```cpp
// 插件系统：每个插件可以返回任意类型的配置
std::unordered_map<std::string, std::any> plugin_config;
plugin_config["thread_count"] = 8;
plugin_config["model_path"]   = std::string("/models/bert.onnx");
plugin_config["use_fp16"]     = true;
plugin_config["threshold"]    = 0.85f;

// 读取时需要知道类型
int threads = std::any_cast<int>(plugin_config["thread_count"]);
```

但注意：如果你的类型集合是已知的，哪怕有十几种，也优先用 `variant`。`any` 的堆分配开销和运行期类型检查开销是实实在在的。

---

## 三者的选择逻辑

```
值可能不存在？
  → std::optional<T>

同一时刻可能是几种类型之一，类型集合固定？
  → std::variant<T1, T2, ...>

类型完全未知，运行期才确定？
  → std::any（用之前先想想是否有更好的设计）
```

这三个工具都是 C++17 引入的，核心思路是一致的：**用类型系统表达意图，把"可能性"显式地写进接口**，而不是靠文档约定或者 magic number。

写代码的时候，比起"这段能不能跑"，更值得问的问题是"这段代码能不能清楚地告诉下一个读者它在做什么"。`optional`、`variant`、`any` 都是让代码更"诚实"的工具。
