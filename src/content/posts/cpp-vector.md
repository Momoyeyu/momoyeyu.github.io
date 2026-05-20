---
title: C++ vector 与 array
published: 2023-04-26
description: 'std::vector 的性能优化技巧，以及 std::array 与裸数组的对比。'
tags: [C++, STL]
category: C++ 入门
episode: 13
draft: false
lang: 'zh_CN'
---

## 简介

`std::vector` 是 C++ 标准库里最常用的容器，本质上是一个**堆上的动态数组**。它支持运行时扩容，随时可以查询元素数量，用起来比裸数组方便得多。

但方便背后有代价——扩容时会发生内存重新分配和元素搬移，如果不加注意很容易产生隐藏的性能开销。

这篇文章从基本用法出发，深入讲清楚 vector 的内部机制和优化手段，再顺带介绍 `std::array`，最后把三种数组（裸数组、`std::array`、`std::vector`）做个横向对比。

---

## 基本用法

```cpp
#include <iostream>
#include <vector>

struct Vertex
{
    float x, y, z;

    Vertex(float x, float y, float z)
        : x(x), y(y), z(z)
    {}
};

std::ostream& operator<<(std::ostream& stream, const Vertex& v)
{
    stream << "(" << v.x << ", " << v.y << ", " << v.z << ")";
    return stream;
}

int main()
{
    std::vector<Vertex> vertices;

    vertices.push_back({ 1, 2, 3 });
    vertices.push_back({ 4, 5, 6 });
    vertices.push_back({ 7, 8, 9 });

    for (int i = 0; i < vertices.size(); i++)
        std::cout << vertices[i] << "\n";

    vertices.erase(vertices.begin() + 1);

    for (Vertex& v : vertices)
        std::cout << v << "\n";
}
```

几个关键点：

- `push_back()` 在末尾追加元素；`erase()` 配合 `begin()` 加偏移量删除指定位置的元素。
- 范围 for 循环用引用（`&`）接收元素，避免不必要的拷贝。
- 与 Java 不同，C++ vector 的元素类型可以是 `int` 等基本类型，不必是对象。

---

## vector 的内部机制

理解 vector 的扩容逻辑，是写出高效代码的前提。

### size 与 capacity

vector 内部维护两个不同的数字：

- **`size()`**：当前存放了多少个元素。
- **`capacity()`**：底层已分配的内存能容纳多少个元素。

两者的关系是 `size <= capacity`。当 `size == capacity` 时再插入元素，就会触发扩容。

### 扩容时发生了什么

扩容不是就地延伸内存，而是一次完整的"搬家"：

1. 在堆上分配一块更大的新内存（通常是原来容量的 **2 倍**）。
2. 把旧数组里的所有元素**逐个移动**（或拷贝）到新内存。
3. 析构旧元素，释放旧内存。

这意味着每次扩容的代价是 O(n)——所有现有元素都要被搬一遍。摊还下来每次插入是 O(1)，但如果触发扩容的时机很集中，峰值开销会很明显。

### 用代码观察扩容

```cpp
#include <iostream>
#include <vector>

int main()
{
    std::vector<int> v;

    for (int i = 0; i < 10; i++)
    {
        v.push_back(i);
        std::cout << "size=" << v.size()
                  << "  capacity=" << v.capacity() << "\n";
    }
}
```

典型输出（GCC/Clang，容量翻倍策略）：

```
size=1  capacity=1
size=2  capacity=2
size=3  capacity=4
size=4  capacity=4
size=5  capacity=8
size=6  capacity=8
size=7  capacity=8
size=8  capacity=8
size=9  capacity=16
size=10 capacity=16
```

容量在 1 → 2 → 4 → 8 → 16 这些节点跳变，每次跳变就是一次完整的搬家。

> MSVC 采用 1.5 倍增长策略，输出会略有不同，但思路相同。

---

## 性能优化

### 用拷贝构造函数可视化拷贝次数

给 `Vertex` 加上拷贝构造函数，每次拷贝就打印一行日志，这样可以直观地看到代码到底触发了多少次拷贝：

```cpp
#include <iostream>
#include <vector>

struct Vertex
{
    float x, y, z;

    Vertex(float x, float y, float z)
        : x(x), y(y), z(z)
    {}

    Vertex(const Vertex& other)
        : x(other.x), y(other.y), z(other.z)
    {
        std::cout << "Copied!\n";
    }
};

int main()
{
    std::vector<Vertex> vertices;
    vertices.push_back(Vertex(1, 2, 3));
    vertices.push_back(Vertex(4, 5, 6));
    vertices.push_back(Vertex(7, 8, 9));
}
```

运行这段代码，控制台会打印 **6 次** "Copied!"。

为什么是 6 次？分解一下：

| 操作 | 触发的拷贝 | 累计 |
|------|-----------|------|
| `push_back` 第 1 个元素 | 临时对象 → vector（容量 0→1） | 1 |
| `push_back` 第 2 个元素 | 临时对象 → vector（容量 1→2，搬移旧元素 1 次）| 1+1+1=3 |
| `push_back` 第 3 个元素 | 临时对象 → vector（容量 2→4，搬移旧元素 2 次）| 3+1+2=6 |

两类拷贝叠加在一起：一类来自"临时对象进 vector"，一类来自"扩容时搬迁旧元素"。

### reserve()：消灭扩容拷贝

如果提前知道大致元素数量，用 `reserve()` 预分配容量，就可以彻底避免扩容带来的搬迁拷贝：

```cpp
std::vector<Vertex> vertices;
vertices.reserve(3);

vertices.push_back(Vertex(1, 2, 3));
vertices.push_back(Vertex(4, 5, 6));
vertices.push_back(Vertex(7, 8, 9));
```

加上 `reserve(3)` 之后，输出变成 **3 次** "Copied!"。扩容搬迁全部消失，只剩下"临时对象拷进 vector"这一类。

### emplace_back()：消灭构造拷贝

`push_back(Vertex(1, 2, 3))` 的流程是：先在当前作用域构造一个临时 `Vertex`，再把它**拷贝进** vector 的存储空间，最后销毁临时对象。

`emplace_back()` 直接把参数转发给 vector 内部的构造函数，**原地构造**，不经过临时对象，省掉这次拷贝：

```cpp
vertices.emplace_back(1, 2, 3);
vertices.emplace_back(4, 5, 6);
vertices.emplace_back(7, 8, 9);
```

### 两者合用：零拷贝

```cpp
std::vector<Vertex> vertices;
vertices.reserve(3);

vertices.emplace_back(1, 2, 3);
vertices.emplace_back(4, 5, 6);
vertices.emplace_back(7, 8, 9);
```

运行这段代码，控制台**什么都不打印**。三个 `Vertex` 全部在 vector 的内存里直接构造，没有任何拷贝发生。

---

## std::array：固定大小的安全数组

`std::array` 是对裸数组的薄封装，大小在编译期固定，存储在**栈**上（或作为成员内联存储），没有任何堆分配开销。

```cpp
#include <array>

std::array<int, 5> arr = { 1, 2, 3, 4, 5 };

arr[2] = 10;           // 不做边界检查，越界是未定义行为
arr.at(2) = 10;        // 做边界检查，越界抛出 std::out_of_range

std::cout << arr.size() << "\n";   // 5

for (int x : arr)
    std::cout << x << " ";
```

### 大小是模板参数意味着什么

`std::array<int, 5>` 和 `std::array<int, 6>` 是**两个不同的类型**。大小被编码进了类型系统：

- 编译器在类型层面就知道数组有多大，不需要运行时存储 size 字段（裸数组也不存，但它会退化成指针导致信息丢失）。
- 不会像裸数组那样"退化"成指针——函数接收 `std::array<int, 5>` 参数时，大小信息完整保留。
- 模板参数必须是**编译期常量**，运行时才知道的长度只能用 `vector`。

```cpp
void print(std::array<int, 5>& arr)   // 只接受恰好 5 个元素的 array
{
    for (int x : arr)
        std::cout << x << " ";
}
```

### 与裸数组的区别

```cpp
int raw[5] = { 1, 2, 3, 4, 5 };

// 裸数组退化成指针，size 信息丢失
void process(int* arr, int n);         // 必须手动传长度

// std::array 保留所有信息
void process(std::array<int, 5>& arr); // 类型里已经有长度
```

裸数组没有 `.size()`，没有迭代器，没有边界检查的 `.at()`，传入函数后就变成一个光秃秃的指针，长度信息彻底消失。`std::array` 把这些都补上了，同时保持零运行时开销。

---

## 三种数组横向对比

| | 裸数组 `int arr[5]` | `std::array<int, 5>` | `std::vector<int>` |
|---|---|---|---|
| **存储位置** | 栈（局部变量） | 栈 | 堆 |
| **大小** | 编译期固定 | 编译期固定 | 运行时可变 |
| **size() 方法** | 无 | 有 | 有 |
| **边界检查** | 无 | `.at()` 有 | `.at()` 有 |
| **迭代器支持** | 无（可用指针模拟） | 完整支持 | 完整支持 |
| **传函数后** | 退化成指针，丢失长度 | 类型完整，长度保留 | 正常 |
| **堆分配开销** | 无 | 无 | 有 |
| **扩容** | 不支持 | 不支持 | 支持 |

**选哪个？**

- 大小固定、追求零开销、不想操心堆内存：用 `std::array`，它是裸数组的直接替代品，几乎没有任何额外代价。
- 大小在运行时才知道，或者需要动态增删：用 `std::vector`，记得用 `reserve()` 和 `emplace_back()` 减少不必要的拷贝。
- 裸数组：除非在和 C 接口打交道，否则现代 C++ 里几乎没有理由选它。
