---
title: C++ 对象生命周期
published: 2023-04-20
description: '栈上 vs 堆上创建对象、new/delete 的本质、复制构造函数与 RAII 模式。'
tags: [C++, 内存]
category: C++ 入门
episode: 12
draft: false
lang: 'zh_CN'
---

如果你有 Java 或 Python 的背景，可能从没认真想过"对象什么时候被销毁"这个问题——GC 会搞定一切，你只管创建对象，剩下的不用操心。

C++ 没有 GC。乍一听像是缺点，但这其实是有意为之：当你掌握了对象的生命周期，就得到了精准的性能控制和可预测的资源管理。这篇文章就来把 C++ 对象从"出生"到"死亡"的全过程讲清楚。

## 先建一个会说话的类

为了演示构造和析构的时机，我们需要一个会在关键时刻"开口说话"的类：

```cpp
#include <iostream>
#include <string>

class Entity {
public:
    std::string name;

    Entity(const std::string& n) : name(n) {
        std::cout << "[构造] Entity: " << name << std::endl;
    }

    ~Entity() {
        std::cout << "[析构] Entity: " << name << std::endl;
    }

    void greet() {
        std::cout << "Hello, I am " << name << std::endl;
    }
};
```

构造函数里打印一行，析构函数里打印一行。这样运行时就能清楚地看到每个对象什么时候"活"、什么时候"死"。

## 栈上创建对象

最简单的创建方式：

```cpp
int main() {
    Entity e("Alice");
    e.greet();
    return 0;
}
```

输出：

```
[构造] Entity: Alice
Hello, I am Alice
[析构] Entity: Alice
```

`Entity e("Alice")` 在栈上分配内存，同时调用构造函数。`main` 函数返回时，`e` 离开作用域，析构函数自动被调用。

这背后没有魔法——编译器在 `}` 处插入了析构函数的调用代码。你写的每一个花括号的结束，编译器都会检查"这里有没有需要析构的对象"，有的话就插入调用。

栈分配为什么快？本质上只是移动一个栈指针。操作系统已经提前分配好了栈内存，分配新对象只需要把指针往下移，不需要向操作系统申请任何东西。

### 用显式花括号控制生命周期

你可以在函数体内用花括号创建一个额外的作用域，精确控制析构的时机：

```cpp
int main() {
    std::cout << "--- 进入 main ---" << std::endl;

    {
        Entity e("Bob");
        e.greet();
        std::cout << "--- 离开内层作用域 ---" << std::endl;
    } // e 在这里析构，不是在 main 结束时

    std::cout << "--- main 继续执行 ---" << std::endl;
    return 0;
}
```

输出：

```
--- 进入 main ---
[构造] Entity: Bob
Hello, I am Bob
--- 离开内层作用域 ---
[析构] Entity: Bob
--- main 继续执行 ---
```

注意析构发生在 `--- main 继续执行 ---` 之前。这个花括号技巧是 RAII 模式的基础，后面会讲。

## 堆上创建对象：new 和 delete

栈上的对象受作用域限制，离开花括号就没了。有时候需要对象活得更久，或者大小在编译时不确定，这时候就要用堆。

```cpp
int main() {
    Entity* p = new Entity("Charlie");
    p->greet();
    delete p;
    return 0;
}
```

输出：

```
[构造] Entity: Charlie
Hello, I am Charlie
[析构] Entity: Charlie
```

看起来和栈上一样，但背后的机制完全不同。

### new 的本质

`new Entity("Charlie")` 做了两件事：

1. 调用 `malloc`，向操作系统申请一块能放下 `Entity` 的内存
2. 在那块内存上调用构造函数

`new` 和 `malloc` 的区别就是 `new` 多调了构造函数。

### delete 的本质

`delete p` 也做了两件事：

1. 调用 `Entity` 的析构函数
2. 调用 `free`，把那块内存还给操作系统

`delete` 和 `free` 的区别就是 `delete` 多调了析构函数。

就这么简单。`new`/`delete` 是 `malloc`/`free` 加上构造/析构的封装。

### 堆分配为什么慢

`malloc` 需要在堆上找到一块足够大的空闲内存。堆上的内存被各种大小的分配零散占用，`malloc` 必须维护一个空闲块列表，每次分配都要遍历这个列表找合适的块，还要处理内存碎片。这个过程比移动栈指针复杂得多。

所以，能放栈上的就放栈上。

### 忘记 delete 的后果

```cpp
int main() {
    Entity* p = new Entity("Dave");
    p->greet();
    // 忘了 delete p
    return 0;
}
```

输出：

```
[构造] Entity: Dave
Hello, I am Dave
```

没有析构！内存泄漏了。`Dave` 占用的内存在 `main` 结束后也不会被归还（严格说进程退出时 OS 会回收，但在长期运行的程序里这是真实的泄漏）。

内存泄漏是 C++ 最常见的 bug 之一。RAII 就是为了解决这个问题而生的，我们后面讲。

## 复制构造函数

当你"复制"一个对象时，会发生什么？

```cpp
int main() {
    Entity a("Alice");
    Entity b = a;  // 复制
    return 0;
}
```

输出：

```
[构造] Entity: Alice
[析构] Entity: Alice
[析构] Entity: Alice
```

等等，构造只有一次，析构却有两次？

`Entity b = a` 调用的是**复制构造函数（copy constructor）**，不是普通构造函数。如果你没有显式写复制构造函数，编译器会帮你生成一个默认版本：逐成员复制（memberwise copy）。对 `Entity` 来说，就是把 `name` 字符串复制一份。

`b` 是独立的对象，有自己的 `name`，所以析构两次是正常的。

### 复制构造函数被调用的场景

除了 `Entity b = a`，复制构造函数还会在这些情况下被调用：

```cpp
// 1. 按值传参
void process(Entity e) {
    e.greet();
}
process(a); // 把 a 复制一份给参数 e

// 2. 按值返回（可能被编译器优化掉，但语义上是复制）
Entity createEntity() {
    Entity temp("Temp");
    return temp;
}
Entity c = createEntity();

// 3. 显式赋值（注意：这是赋值运算符，不是复制构造函数，但效果类似）
Entity d("D");
d = a; // 调用 operator=
```

### 浅拷贝的危险：double-free

当成员有原始指针时，默认的逐成员复制只复制指针的值（地址），两个对象会指向同一块内存——这叫**浅拷贝（shallow copy）**。

```cpp
class Buffer {
public:
    char* data;
    int size;

    Buffer(int s) : size(s) {
        data = new char[s];
        std::cout << "[构造] Buffer, data @ " << (void*)data << std::endl;
    }

    ~Buffer() {
        std::cout << "[析构] Buffer, data @ " << (void*)data << std::endl;
        delete[] data; // 释放内存
    }
};

int main() {
    Buffer a(10);
    Buffer b = a; // 浅拷贝！b.data 和 a.data 指向同一块内存
    return 0;
}
```

运行这段代码，你会看到两个对象析构时都试图 `delete[]` 同一个地址——这是**double-free**，属于未定义行为，通常会导致程序崩溃。

### 深拷贝：自己写复制构造函数

解决方案是显式写一个**深拷贝（deep copy）**的复制构造函数，为新对象分配独立的内存：

```cpp
class Buffer {
public:
    char* data;
    int size;

    Buffer(int s) : size(s) {
        data = new char[s];
        std::cout << "[构造] Buffer, data @ " << (void*)data << std::endl;
    }

    // 深拷贝复制构造函数
    Buffer(const Buffer& other) : size(other.size) {
        data = new char[size];          // 分配新内存
        memcpy(data, other.data, size); // 复制内容
        std::cout << "[复制构造] Buffer, data @ " << (void*)data << std::endl;
    }

    ~Buffer() {
        std::cout << "[析构] Buffer, data @ " << (void*)data << std::endl;
        delete[] data;
    }
};

int main() {
    Buffer a(10);
    Buffer b = a; // 现在 b 有独立的内存
    return 0;
}
```

输出（地址会不同）：

```
[构造] Buffer, data @ 0x600000004010
[复制构造] Buffer, data @ 0x600000004030
[析构] Buffer, data @ 0x600000004030
[析构] Buffer, data @ 0x600000004010
```

两个不同的地址，析构时各自释放各自的内存，安全。

> [!IMPORTANT]
> **Rule of Three**：如果你需要自定义析构函数，通常也需要自定义复制构造函数和赋值运算符。三者要么都自定义，要么都不自定义。（C++11 之后扩展为 Rule of Five，加入了移动构造函数和移动赋值运算符。）

## RAII 模式

RAII 是 C++ 最重要的惯用法之一，全称 **Resource Acquisition Is Initialization**（资源获取即初始化）。

核心思想：**在构造函数里获取资源，在析构函数里释放资源**。

这样一来，只要对象的生命周期结束，资源就自动被释放——不需要手动记得释放，因为编译器会在对象离开作用域时自动调用析构函数。

### 一个简单的 RAII 包装器

```cpp
class ScopedBuffer {
public:
    char* data;

    ScopedBuffer(int size) {
        data = new char[size];
        std::cout << "[获取] 内存 @ " << (void*)data << std::endl;
    }

    ~ScopedBuffer() {
        std::cout << "[释放] 内存 @ " << (void*)data << std::endl;
        delete[] data;
    }

    // 禁止复制，防止浅拷贝问题
    ScopedBuffer(const ScopedBuffer&) = delete;
    ScopedBuffer& operator=(const ScopedBuffer&) = delete;
};

int main() {
    std::cout << "--- 开始 ---" << std::endl;
    {
        ScopedBuffer buf(1024);
        // 使用 buf.data...
        std::cout << "--- 使用中 ---" << std::endl;
    } // buf 在这里析构，内存自动释放
    std::cout << "--- 结束 ---" << std::endl;
    return 0;
}
```

输出：

```
--- 开始 ---
[获取] 内存 @ 0x600000004010
--- 使用中 ---
[释放] 内存 @ 0x600000004010
--- 结束 ---
```

即使函数中途抛出异常，析构函数也一定会被调用（这是栈展开机制保证的）。不用 `try/finally`，不用担心忘记释放——编译器替你处理了一切。

### 智能指针就是 RAII

标准库里的 `std::unique_ptr` 和 `std::shared_ptr` 本质上就是 RAII 的应用：

```cpp
#include <memory>

int main() {
    {
        auto p = std::make_unique<Entity>("Eve");
        p->greet();
    } // p 离开作用域，Entity 自动析构，不需要 delete

    return 0;
}
```

输出：

```
[构造] Entity: Eve
Hello, I am Eve
[析构] Entity: Eve
```

`unique_ptr` 在析构函数里调用 `delete`。它就是一个持有原始指针的 RAII 包装器。

RAII 把资源管理从"程序员的记忆力"转移给了"编译器的生命周期规则"。只要遵循 RAII，内存泄漏就从逻辑错误变成了编译时问题。

## 为什么 C++ 没有 GC 反而是优势

回到开头的问题：Java 和 Python 都有 GC，C++ 为什么不加一个？

原因有两个：

**性能**：GC 需要在运行时扫描对象图、暂停程序（Stop-the-World），引入不可预测的延迟。在游戏引擎、高频交易、嵌入式系统这些对延迟敏感的场景里，这是不可接受的。C++ 的析构是**确定性的**——你知道对象在哪一行被销毁。

**可预测性**：GC 语言里，对象什么时候真正被回收是不确定的。C++ 的析构函数在作用域结束时**立即**调用，资源（内存、文件、锁、网络连接）立即被释放。这对于需要精确控制资源生命周期的系统来说是关键特性，不是缺陷。

RAII 让 C++ 在没有 GC 的情况下，同样能安全地管理资源——而且更高效、更可预测。

---

C++ 的对象生命周期不是负担，是工具。理解了构造、析构、复制的时机，RAII 就自然成了你的编程习惯。下一篇我们会看移动语义——当对象"搬家"而不是"复制"时，性能会有质的提升。
