---
title: C++ 手写 vector
date: 2024-06-08
description: '手写动态数组深入理解 std::vector 的内存管理、扩容策略与移动语义。'
tags: [C++, STL, 内存]
category: C++ 进阶
episode: 19
draft: false
lang: 'zh_CN'
---

`std::vector` 是 C++ 最常用的容器，但大多数人只停留在"会用"的层面。今天我们从零手写一个简化版 `Vector<T>`，彻底搞清楚它背后的内存管理、扩容策略、以及移动语义为什么重要。

对应 The Cherno C++ 系列第 91-92 集。

---

## 接口设计

先想清楚要实现哪些东西：

```cpp
template<typename T>
class Vector {
public:
    Vector();
    ~Vector();

    void push_back(const T& value);   // 拷贝版本
    void push_back(T&& value);        // 移动版本

    template<typename... Args>
    T& emplace_back(Args&&... args);  // 原地构造

    T& operator[](size_t index);
    const T& operator[](size_t index) const;

    size_t size() const;
    size_t capacity() const;

    T* begin();
    T* end();
    const T* begin() const;
    const T* end() const;
};
```

`begin()`/`end()` 返回原始指针就够了——范围 for 循环只要求 `begin` 和 `end` 可以解引用、自增、比较，指针完全满足。

---

## 内存管理：为什么不用 `new T[]`

这是整个实现里最关键的设计决策。

### 错误的做法

```cpp
// 错误：这会立刻调用 capacity 个 T 的默认构造函数
T* data = new T[capacity];
```

问题在于，vector 分配的是"预留容量"，大多数时候这块内存还没有被"使用"——我们不希望在上面有任何对象存在。如果 `T` 没有默认构造函数，这行代码直接编译失败；即使有，也是在做无用功。

### 正确的做法：分离分配与构造

C++ 允许我们把内存分配和对象构造分开：

```cpp
// 1. 分配原始内存（不调用任何构造函数）
T* data = (T*) ::operator new(capacity * sizeof(T));

// 2. 在指定地址上构造对象（placement new）
new (data + index) T(value);

// 3. 显式调用析构函数（不释放内存）
data[index].~T();

// 4. 释放原始内存
::operator delete(data);
```

**Placement new** 的本质就是：`new (ptr) T(args)` 告诉编译器"不要分配内存，直接在 `ptr` 这个地址上调用 `T` 的构造函数"。它只是一次构造函数调用，不涉及任何内存分配。

对应地，销毁一个 placement new 出来的对象，必须显式调用析构函数 `ptr->~T()`，而不能用 `delete ptr`（那会同时 free 内存）。

---

## 扩容策略

当 `size == capacity` 时，必须扩容。策略是：**扩容为当前容量的 2 倍**。

```
capacity:  1  2  4  8  16  32  ...
```

### 为什么是 2 倍？均摊 O(1) 的证明

考虑连续 N 次 `push_back`。扩容发生在容量为 1, 2, 4, ..., N/2 时，每次扩容需要移动当前所有元素。

总移动次数：

```
1 + 2 + 4 + ... + N/2 + N ≈ 2N
```

N 次操作的总移动次数是 O(N)，所以每次操作均摊 O(1)。

如果增长因子是 1.5，结论类似——只是常数不同。2 倍是个工程权衡：时间效率好，内存浪费最多一倍（可接受）。

### 扩容的步骤

1. 分配新内存（容量翻倍）
2. 把旧元素 **move** 到新内存（而不是 copy）
3. 析构旧内存上的所有对象
4. 释放旧内存
5. 更新指针和容量

```cpp
void realloc(size_t new_capacity) {
    T* new_data = (T*) ::operator new(new_capacity * sizeof(T));

    // 如果 new_capacity 比 size 小（用于 shrink），截断
    size_t new_size = std::min(m_size, new_capacity);

    for (size_t i = 0; i < new_size; i++) {
        new (new_data + i) T(std::move_if_noexcept(m_data[i]));
    }

    for (size_t i = 0; i < m_size; i++) {
        m_data[i].~T();
    }

    ::operator delete(m_data);

    m_data     = new_data;
    m_capacity = new_capacity;
    m_size     = new_size;
}
```

### 为什么用 move 而不是 copy？

如果 `T` 是 `std::string` 或者持有堆内存的类型，copy 意味着重新分配内存、复制数据；而 move 只是转移所有权——通常只是几次指针赋值。

但这里有个细节：我们用的是 `std::move_if_noexcept` 而不是 `std::move`。

**原因**：异常安全。如果 `T` 的移动构造函数可能抛出异常，那么扩容过程中途失败会让旧数据变成"半移走"的状态，无法恢复。`move_if_noexcept` 的逻辑是：如果移动构造是 `noexcept` 的，就用移动；否则退回到拷贝（拷贝不修改原对象，即使抛异常原数据还在）。

这正是 `std::vector` 的行为：只有当 `T` 的移动构造标记了 `noexcept`，扩容才会真正移动元素。这也是为什么我们写自己的移动构造函数时，**应该尽量加上 `noexcept`**。

---

## push_back 的两个版本与 emplace_back

```cpp
// 拷贝版本
void push_back(const T& value) {
    if (m_size >= m_capacity)
        realloc(m_capacity == 0 ? 1 : m_capacity * 2);

    new (m_data + m_size) T(value);
    m_size++;
}

// 移动版本
void push_back(T&& value) {
    if (m_size >= m_capacity)
        realloc(m_capacity == 0 ? 1 : m_capacity * 2);

    new (m_data + m_size) T(std::move(value));
    m_size++;
}
```

两个版本的区别只在于构造时用拷贝还是移动。编译器会根据传入的是左值还是右值自动选择。

### emplace_back：更进一步

`push_back` 的问题在于，即使传右值，也要先构造一个 `T`，再移动进去。`emplace_back` 直接把构造参数转发到目标内存上，省去临时对象：

```cpp
template<typename... Args>
T& emplace_back(Args&&... args) {
    if (m_size >= m_capacity)
        realloc(m_capacity == 0 ? 1 : m_capacity * 2);

    // 完美转发：在目标内存上直接构造 T
    new (m_data + m_size) T(std::forward<Args>(args)...);
    return m_data[m_size++];
}
```

对于 `push_back(T(a, b, c))`，会先构造一个临时 `T`，再移动进去（两步）。`emplace_back(a, b, c)` 直接在目标地址构造（一步）。

---

## 完整实现

```cpp
#include <cstddef>
#include <utility>
#include <stdexcept>

template<typename T>
class Vector {
public:
    Vector()
        : m_data(nullptr), m_size(0), m_capacity(0) {}

    ~Vector() {
        clear();
        ::operator delete(m_data);
    }

    // 禁止拷贝（简化版，完整实现需要拷贝构造和拷贝赋值）
    Vector(const Vector&) = delete;
    Vector& operator=(const Vector&) = delete;

    // 移动构造
    Vector(Vector&& other) noexcept
        : m_data(other.m_data), m_size(other.m_size), m_capacity(other.m_capacity) {
        other.m_data     = nullptr;
        other.m_size     = 0;
        other.m_capacity = 0;
    }

    void push_back(const T& value) {
        grow_if_needed();
        new (m_data + m_size) T(value);
        m_size++;
    }

    void push_back(T&& value) {
        grow_if_needed();
        new (m_data + m_size) T(std::move(value));
        m_size++;
    }

    template<typename... Args>
    T& emplace_back(Args&&... args) {
        grow_if_needed();
        new (m_data + m_size) T(std::forward<Args>(args)...);
        return m_data[m_size++];
    }

    void pop_back() {
        if (m_size == 0) return;
        m_size--;
        m_data[m_size].~T();
    }

    void clear() {
        for (size_t i = 0; i < m_size; i++)
            m_data[i].~T();
        m_size = 0;
    }

    T& operator[](size_t index) {
        return m_data[index];
    }

    const T& operator[](size_t index) const {
        return m_data[index];
    }

    T& at(size_t index) {
        if (index >= m_size)
            throw std::out_of_range("Vector::at: index out of range");
        return m_data[index];
    }

    size_t size()     const { return m_size;     }
    size_t capacity() const { return m_capacity; }
    bool   empty()    const { return m_size == 0; }

    T*       begin()       { return m_data;          }
    T*       end()         { return m_data + m_size;  }
    const T* begin() const { return m_data;          }
    const T* end()   const { return m_data + m_size;  }

private:
    T*     m_data;
    size_t m_size;
    size_t m_capacity;

    void grow_if_needed() {
        if (m_size >= m_capacity)
            realloc(m_capacity == 0 ? 1 : m_capacity * 2);
    }

    void realloc(size_t new_capacity) {
        T* new_data = (T*) ::operator new(new_capacity * sizeof(T));

        size_t new_size = std::min(m_size, new_capacity);

        // 移动旧元素到新内存
        for (size_t i = 0; i < new_size; i++)
            new (new_data + i) T(std::move_if_noexcept(m_data[i]));

        // 析构旧内存上的对象
        for (size_t i = 0; i < m_size; i++)
            m_data[i].~T();

        // 释放旧内存
        ::operator delete(m_data);

        m_data     = new_data;
        m_capacity = new_capacity;
        m_size     = new_size;
    }
};
```

测试一下：

```cpp
#include <iostream>
#include <string>

int main() {
    Vector<std::string> v;

    v.push_back("hello");
    v.push_back("world");
    v.emplace_back(5, 'x');  // 直接构造 "xxxxx"

    for (const auto& s : v)
        std::cout << s << "\n";

    std::cout << "size: "     << v.size()     << "\n";
    std::cout << "capacity: " << v.capacity() << "\n";

    return 0;
}
```

输出：

```
hello
world
xxxxx
size: 3
capacity: 4
```

---

## 对比 std::vector：我们缺了什么

手写的这个版本已经覆盖了核心逻辑，但和真正的 `std::vector` 相比还差很多：

### 1. 异常安全（强保证）

`std::vector` 的 `push_back` 提供**强异常保证**：如果操作抛出异常，容器状态完全回滚，就像操作没发生过一样。

我们的实现没有这个保证。如果 `T` 的构造函数在扩容中途抛出异常，我们的容器会处于半成品状态。

实现强保证的关键是：先在新内存上完成所有构造，成功后再释放旧内存，失败则回滚新内存——这就是 copy-and-swap 惯用法的本质。

### 2. 分配器支持

真实的 `vector` 是 `std::vector<T, Allocator>`，默认 allocator 是 `std::allocator<T>`。分配器允许用户替换内存分配策略（比如用内存池）。我们硬编码了 `::operator new`，无法定制。

### 3. insert / erase

在任意位置插入或删除元素，涉及元素的移动（后面的元素往后/往前挪），还要处理迭代器失效。`insert` 的均摊复杂度是 O(N)。

### 4. 迭代器失效语义

`std::vector` 有明确的规范：扩容后所有迭代器、指针、引用都失效；`push_back` 在不触发扩容时只有 `end()` 失效。我们的原始指针没有这些规范，用户很容易踩坑。

### 5. 拷贝构造与拷贝赋值

完整的 vector 需要深拷贝语义。我们的简化版直接 `= delete` 了。

---

## 总结

手写 `Vector<T>` 的核心是理解三件事：

1. **分配与构造分离**：`operator new` + placement new，而不是 `new T[]`。这是 STL 容器的通用模式。

2. **扩容中的移动语义**：用 `move_if_noexcept` 而不是 `copy`，在性能和异常安全之间取得平衡。这也解释了为什么我们写移动构造函数时要加 `noexcept`。

3. **均摊 O(1)**：2 倍扩容保证了 N 次 push_back 的总代价是 O(N)，即每次均摊 O(1)。这不是魔法，是数学。

把这些搞清楚，再去看 `std::list`、`std::deque`、`std::unordered_map` 的实现，就会发现这些模式一再出现——它们都是同一套思想的不同应用。
