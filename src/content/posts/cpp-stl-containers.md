---
title: C++ STL 容器与迭代器
published: 2023-09-28
description: '红黑树 vs 哈希表的选择、迭代器的本质，以及 STL 算法库的高效用法。'
tags: [C++, STL]
category: C++ 进阶
episode: 10
draft: false
lang: 'zh_CN'
---

## 为什么要深入容器？

用过 `std::vector` 之后，大多数人会自然地接触到 `std::map` 和 `std::unordered_map`。表面上看，两者都是键值映射，用法几乎一样。但底层实现天差地别，选错了在 AI Infra 这种对性能敏感的场景里会踩很多坑。

本文按照"底层实现 → 使用场景 → 常见陷阱"的顺序讲，重点不是 API，而是**为什么**。

---

## std::map：有序的代价

### 底层：红黑树

`std::map` 的底层是**红黑树**（Red-Black Tree）——一种自平衡二叉搜索树。每次插入或删除，树会通过旋转操作保持平衡，保证树高始终是 O(log n)。

| 操作 | 时间复杂度 |
|------|-----------|
| 插入 | O(log n)  |
| 查找 | O(log n)  |
| 删除 | O(log n)  |

有序是它最大的优势：你可以用 `lower_bound`/`upper_bound` 做范围查询，也可以直接遍历得到排好序的键值对。

```cpp
#include <map>
#include <iostream>

int main() {
    std::map<std::string, int> scores;
    scores["Alice"] = 95;
    scores["Bob"]   = 82;
    scores["Carol"] = 88;

    // 遍历是有序的（字典序）
    for (auto& [name, score] : scores) {
        std::cout << name << ": " << score << "\n";
    }
    // 输出：Alice: 95 / Bob: 82 / Carol: 88

    // 范围查询：找出名字在 [B, C) 之间的所有人
    auto it_begin = scores.lower_bound("B");
    auto it_end   = scores.lower_bound("C");
    for (auto it = it_begin; it != it_end; ++it) {
        std::cout << it->first << "\n"; // Bob
    }
}
```

### 内存布局：每个节点独立分配

这是 `std::map` 最大的性能隐患。树的每个节点（存 key、value、左右子节点指针、父指针、颜色位）都是**独立的堆内存分配**。

```
堆上的内存碎片：
  [节点A] ... [节点B] ... [节点C] ...
  地址可能相差很远，遍历时 CPU cache 命中率极低
```

遍历一个 `std::map` 等于在内存中反复随机跳跃。对比 `std::vector`，后者元素紧密排列，预取器（prefetcher）可以高效工作。这就是为什么在元素不多的情况下，`std::map` 的常数因子会让它比 `std::vector` + 线性搜索还慢。

### key 类型的要求

`std::map` 要求 key 类型支持 `<` 运算符（或者提供自定义比较器）。如果用自定义类型做 key：

```cpp
struct Point {
    int x, y;
    // 必须提供严格弱序
    bool operator<(const Point& other) const {
        if (x != other.x) return x < other.x;
        return y < other.y;
    }
};

std::map<Point, std::string> point_map;
point_map[{1, 2}] = "origin area";
```

---

## std::unordered_map：速度的代价

### 底层：哈希表

`std::unordered_map` 用的是**哈希表**，平均 O(1) 的插入和查找。底层是一个 bucket 数组，每个 bucket 挂一个链表（或其他冲突解决结构），key 通过哈希函数映射到对应 bucket。

| 操作 | 平均复杂度 | 最坏复杂度（哈希冲突） |
|------|-----------|----------------------|
| 插入 | O(1)      | O(n)                 |
| 查找 | O(1)      | O(n)                 |
| 删除 | O(1)      | O(n)                 |

```cpp
#include <unordered_map>
#include <string>

int main() {
    std::unordered_map<std::string, int> op_registry;

    // 注册算子（AI Infra 中的典型用法）
    op_registry["conv2d"]     = 0;
    op_registry["relu"]       = 1;
    op_registry["batch_norm"] = 2;

    // O(1) 查找
    auto it = op_registry.find("relu");
    if (it != op_registry.end()) {
        std::cout << "relu id: " << it->second << "\n";
    }
}
```

### load factor 与 rehash：内存峰值陷阱

哈希表有一个 **load factor**（负载因子）= 元素数量 / bucket 数量。当 load factor 超过阈值（STL 默认是 1.0），容器会自动 rehash：申请更大的 bucket 数组，把所有元素重新哈希并插入。

这个过程有两个问题：
1. **峰值内存**：rehash 期间新旧数组同时存在，内存使用瞬间翻倍。
2. **迭代器全部失效**：rehash 后所有指向元素的迭代器、指针、引用均失效。

解决方法是提前用 `reserve()` 预分配：

```cpp
std::unordered_map<std::string, int> registry;
registry.reserve(1024); // 预分配足够的 bucket，避免 rehash

// 或者手动设置 max_load_factor
registry.max_load_factor(0.7); // 更激进地扩容，减少冲突
```

### 为自定义类型提供 hash

`std::unordered_map` 要求 key 类型有对应的 `std::hash` 特化。内置类型（`int`、`string` 等）已经有了，自定义类型需要手动提供：

```cpp
struct Point {
    int x, y;
    bool operator==(const Point& other) const {
        return x == other.x && y == other.y;
    }
};

// 特化 std::hash
namespace std {
    template <>
    struct hash<Point> {
        size_t operator()(const Point& p) const {
            // 常见做法：组合多个字段的哈希值
            size_t hx = std::hash<int>{}(p.x);
            size_t hy = std::hash<int>{}(p.y);
            return hx ^ (hy << 32 | hy >> 32); // 简单混合
        }
    };
}

std::unordered_map<Point, std::string> grid;
grid[{0, 0}] = "origin";
```

更健壮的做法是用 `boost::hash_combine` 风格的混合函数，避免对称碰撞（(1,2) 和 (2,1) 哈希值相同的问题）。

---

## map vs unordered_map：怎么选？

| 场景 | 选择 |
|------|------|
| 需要按 key 有序遍历 | `std::map` |
| 需要范围查询（lower_bound/upper_bound） | `std::map` |
| key 没有自然排序或难以定义 `<` | `std::unordered_map` |
| 只需要键值映射，追求最快查找速度 | `std::unordered_map` |
| 元素数量很少（< 几十个） | 两者差距不大，`std::map` 甚至可能更快（常数因子） |
| 内存敏感场景，大量元素 | `std::unordered_map`（但注意 rehash 峰值） |

**一个反直觉的结论**：`unordered_map` 的常数因子相当大（哈希计算、bucket 寻址、可能的链表遍历），元素很少时它不一定比 `map` 快。真正需要的时候，profile 说了算。

### AI Infra 中的实际应用

算子注册表（op registry）是 `unordered_map` 的教科书级用法。PyTorch 的 dispatcher 和 TensorFlow 的 op kernel 注册，底层都用类似的结构：

```cpp
// 简化版算子注册表
using KernelFn = std::function<void(/* 参数 */)>;

class OpRegistry {
public:
    void register_op(const std::string& name, KernelFn fn) {
        registry_[name] = std::move(fn);
    }

    KernelFn* find_op(const std::string& name) {
        auto it = registry_.find(name);
        return it != registry_.end() ? &it->second : nullptr;
    }

private:
    std::unordered_map<std::string, KernelFn> registry_;
};
```

用 `unordered_map` 而不是 `map` 是因为：op 名字没有排序需求，但 dispatch 路径是热路径，O(1) vs O(log n) 在每次前向传播时都会积累差异。

---

## 迭代器：容器的"广义指针"

### 迭代器的本质

迭代器是 STL 的核心抽象。它把容器的遍历方式统一成类似指针的接口，让算法库可以**与具体容器解耦**。

```cpp
std::vector<int> v = {1, 2, 3, 4, 5};

// 指针风格
for (auto it = v.begin(); it != v.end(); ++it) {
    std::cout << *it << " "; // 解引用得到元素
}

// 现代写法（range-based for 本质上也是用迭代器）
for (int x : v) {
    std::cout << x << " ";
}
```

### 迭代器分类

STL 定义了五类迭代器，能力逐步增强：

| 类别 | 支持操作 | 典型容器 |
|------|---------|---------|
| 输入迭代器 | `++`, `*`（只读） | `istream_iterator` |
| 输出迭代器 | `++`, `*`（只写） | `ostream_iterator` |
| 前向迭代器 | `++`, `*` | `std::forward_list` |
| 双向迭代器 | `++`, `--`, `*` | `std::list`, `std::map` |
| 随机访问迭代器 | `++`, `--`, `+n`, `-n`, `[]` | `std::vector`, `std::deque` |

`std::map` 的迭代器是**双向迭代器**，不支持 `it + 3` 这样的操作。`std::vector` 的是**随机访问迭代器**，可以像指针一样做算术。

### 迭代器失效：最常见的 bug 来源

**vector 扩容后迭代器全部失效**。原因很简单：`push_back` 触发扩容时，底层数组重新分配到新地址，所有指向旧数组的迭代器都成了悬空指针。

```cpp
std::vector<int> v = {1, 2, 3};
auto it = v.begin(); // 指向旧内存

v.push_back(4); // 可能触发扩容，底层数组重新分配
// it 现在是悬空迭代器！使用它是未定义行为
std::cout << *it; // UB
```

**在循环中删除元素**也是经典陷阱：

```cpp
// 错误写法：erase 后迭代器失效
for (auto it = v.begin(); it != v.end(); ++it) {
    if (*it % 2 == 0) {
        v.erase(it); // it 失效！++it 是 UB
    }
}

// 正确写法：erase 返回下一个有效迭代器
for (auto it = v.begin(); it != v.end(); ) {
    if (*it % 2 == 0) {
        it = v.erase(it); // 用返回值更新迭代器
    } else {
        ++it;
    }
}
```

对于 `std::map`/`std::list`，删除某个节点只会使**该节点的迭代器**失效，其他迭代器不受影响（因为节点是独立分配的，删除不影响其他节点的地址）。

---

## STL 算法库：让容器动起来

STL 算法接受迭代器范围，与容器完全解耦。同一个 `std::sort` 可以用在 `vector`、`deque`、数组上。

### 常用算法速览

```cpp
#include <algorithm>
#include <numeric>
#include <vector>
#include <iostream>

int main() {
    std::vector<int> v = {5, 3, 1, 4, 2};

    // 排序
    std::sort(v.begin(), v.end()); // {1, 2, 3, 4, 5}

    // 查找
    auto it = std::find(v.begin(), v.end(), 3);
    if (it != v.end()) std::cout << "found: " << *it << "\n";

    // 条件查找
    auto it2 = std::find_if(v.begin(), v.end(), [](int x) {
        return x > 3;
    });
    if (it2 != v.end()) std::cout << "first > 3: " << *it2 << "\n"; // 4

    // 变换（每个元素乘以 2）
    std::transform(v.begin(), v.end(), v.begin(), [](int x) {
        return x * 2;
    });
    // v = {2, 4, 6, 8, 10}

    // 累积（求和）
    int sum = std::accumulate(v.begin(), v.end(), 0);
    std::cout << "sum: " << sum << "\n"; // 30

    // 拷贝到另一个容器
    std::vector<int> dst(v.size());
    std::copy(v.begin(), v.end(), dst.begin());
}
```

### C++20 Ranges：更现代的写法

C++20 引入了 `std::ranges`，可以直接对容器操作，不用手写 `begin()`/`end()`，还支持**惰性管道**：

```cpp
#include <ranges>
#include <algorithm>
#include <vector>
#include <iostream>

int main() {
    std::vector<int> v = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10};

    // 过滤偶数，再乘以 2，惰性求值
    auto result = v
        | std::views::filter([](int x) { return x % 2 == 0; })
        | std::views::transform([](int x) { return x * 2; });

    for (int x : result) {
        std::cout << x << " "; // 4 8 12 16 20
    }

    // ranges 版排序，直接传容器
    std::ranges::sort(v);
}
```

Ranges 的惰性求值避免了中间容器的内存分配，在处理大数据流时很有用。

---

## std::set / std::unordered_set：只存 key

`std::set` 和 `std::unordered_set` 分别是 `std::map` 和 `std::unordered_map` 的"只存 key"版本，底层同样是红黑树和哈希表。

最常见的用途是**去重**：

```cpp
#include <set>
#include <unordered_set>
#include <vector>
#include <iostream>

int main() {
    std::vector<int> data = {3, 1, 4, 1, 5, 9, 2, 6, 5, 3};

    // 去重并排序
    std::set<int> unique_sorted(data.begin(), data.end());
    // {1, 2, 3, 4, 5, 6, 9}

    // 去重但不保证顺序（更快）
    std::unordered_set<int> unique_fast(data.begin(), data.end());

    // 高效成员检测
    if (unique_sorted.count(5)) {
        std::cout << "5 exists\n";
    }
    // 或者用 contains（C++20）
    if (unique_sorted.contains(5)) {
        std::cout << "5 exists\n";
    }
}
```

在 AI Infra 场景中，`std::unordered_set` 常用于记录已访问的节点（图遍历、计算图 topo sort），或者存储已注册的 op 名字集合。

---

## 总结

| 容器 | 底层 | 有序 | key 要求 | 查找复杂度 | 适用场景 |
|------|------|------|---------|-----------|---------|
| `std::map` | 红黑树 | 是 | `operator<` | O(log n) | 有序遍历、范围查询 |
| `std::unordered_map` | 哈希表 | 否 | `std::hash` 特化 | O(1) 平均 | 高频查找、算子注册表 |
| `std::set` | 红黑树 | 是 | `operator<` | O(log n) | 有序去重、范围检测 |
| `std::unordered_set` | 哈希表 | 否 | `std::hash` 特化 | O(1) 平均 | 快速去重、成员检测 |

几个核心结论：

1. **`std::map` 是 cache 不友好的**，大量元素时遍历性能差，因为节点分散在堆上。
2. **`std::unordered_map` 的 rehash 会造成内存峰值**，提前 `reserve()` 是好习惯。
3. **迭代器失效是 UB 的温床**，vector 扩容后所有迭代器失效；循环删除要用 `erase` 返回值。
4. **STL 算法与容器解耦**，学会用 `std::sort`、`find_if`、`transform`、`accumulate` 可以少写很多循环。
5. **C++20 Ranges** 让这些操作更简洁，还支持惰性求值。

选容器的底线：**先选能满足需求的最简单容器，再根据 profiling 结果优化**。不要在没有数据的情况下过度优化。
