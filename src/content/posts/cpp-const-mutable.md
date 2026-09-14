---
title: C++ const、mutable 与 explicit
date: 2023-04-09
description: 'const 的多种用法、mutable 关键字的语义，以及隐式转换与 explicit 的控制。'
tags: [C++, 类型系统]
category: C++ 入门
episode: 10
draft: false
lang: 'zh_CN'
---

这期我们来聊三个看起来简单、实际上藏着不少坑的概念：`const`、`mutable`，以及隐式转换和 `explicit`。

`const` 是 C++ 中使用频率极高的关键字，但很多人只会写 `const int x = 5`，遇到指针和成员函数就开始犯迷糊。`mutable` 更是很多人学了好几年都没用过的关键字。至于隐式转换，它可能是 C++ 里最容易悄无声息地引入 bug 的特性之一。

把这三个讲清楚，你的 C++ 代码质量会有一个明显的跃升。

---

## const 变量

最基础的用法：

```cpp
const int x = 5;
x = 10; // 编译错误
```

`const` 修饰的变量不能被修改。编译器在看到 `const int x = 5` 时，甚至可以直接把代码里所有用到 `x` 的地方替换成字面量 `5`，相当于一个有类型的宏，但比宏安全得多。

---

## const 指针：最容易混淆的地方

这是本篇的重点，也是笔试和面试里的常考点。`const` 和指针组合有三种形式，很多人分不清。

```cpp
const int* ptr;   // pointer to const int
int* const ptr;   // const pointer to int
const int* const ptr; // const pointer to const int
```

### 记忆技巧：看 * 的位置

`const` 修饰的是它**右边**的东西：

- `const int*`：`const` 在 `*` 左边，修饰的是"值"，所以指向的值不可变，指针本身可以改变指向
- `int* const`：`const` 在 `*` 右边，修饰的是"指针本身"，所以指针不能改变指向，但可以通过它修改值

用代码验证一下：

```cpp
int a = 10;
int b = 20;

// pointer to const int：值只读，指针可变
const int* p1 = &a;
// *p1 = 99;  // 错误：不能修改值
p1 = &b;      // 正确：可以改变指向

// const pointer to int：指针只读，值可变
int* const p2 = &a;
*p2 = 99;     // 正确：可以修改值
// p2 = &b;   // 错误：不能改变指向

// const pointer to const int：两者都只读
const int* const p3 = &a;
// *p3 = 99;  // 错误
// p3 = &b;   // 错误
```

### East const vs West const

你可能见过两种写法：

```cpp
const int* ptr;  // West const（const 在西边，常见写法）
int const* ptr;  // East const（const 在东边）
```

这两种写法完全等价。East const 的拥护者认为，把 `const` 统一写在它修饰的类型右边，读起来更一致（从右往左读：`ptr` is a pointer to `const int`）。West const 是更传统、更常见的写法。

两种风格都有人用，保持一致就好，不必纠结。

---

## const 成员函数

成员函数后面加 `const`，是对编译器和调用者的承诺：**这个函数不会修改对象的成员变量**。

```cpp
class Entity {
public:
    int GetX() const {
        // m_x = 0;  // 错误：const 函数里不能修改成员变量
        return m_x;
    }

    void SetX(int x) {
        m_x = x;  // 非 const 函数，可以修改
    }

private:
    int m_x = 0;
};
```

这件事为什么重要？考虑下面这个场景：

```cpp
void PrintEntity(const Entity& e) {
    std::cout << e.GetX() << std::endl;
}
```

`e` 是 `const Entity&`，编译器保证你不能通过 `e` 修改对象。此时 `e.GetX()` 能不能调用？

只有当 `GetX()` 被声明为 `const` 成员函数，编译器才会放行。如果 `GetX()` 不是 `const`，编译器会拒绝——因为它无法确认这个函数会不会修改对象。

这个问题在实际开发中比你想象的更常见。你封装了一个类，成员函数忘记加 `const`，然后发现这个类没法在某些场景下使用，或者你被迫去掉调用方的 `const`，然后一路传染……

**结论：只要函数不修改成员变量，就加 `const`，这是好习惯。**

---

## const 引用作为函数参数

```cpp
void Print(const std::string& s) {
    std::cout << s << std::endl;
}
```

`const std::string&` 有两个好处：

1. **避免拷贝**：引用传递，不复制字符串
2. **保证只读**：调用者放心传入，函数内不会修改

如果参数是 `std::string s`（值传递），每次调用都会拷贝一份字符串，对于长字符串这是不必要的开销。

如果参数是 `std::string&`（非 const 引用），那么你传不进去字面量或临时对象：

```cpp
Print("hello");              // 错误：非 const 引用不能绑定到临时对象
Print(const std::string&);  // 正确
```

所以，**不需要修改的引用参数，加上 `const`**。

---

## mutable：在 const 里开个口子

`mutable` 修饰的成员变量可以在 `const` 成员函数里被修改。

第一次听到这个描述，你可能会觉得："这不就是在破坏 `const` 的语义吗？"

其实不然。`const` 成员函数承诺的是**逻辑上的不可变**，而有些内部状态不影响对象的逻辑状态，但又需要在 `const` 函数里修改。最典型的场景是**缓存**和**调试计数器**。

### 调试计数器

```cpp
class Entity {
public:
    const std::string& GetName() const {
        m_call_count++;  // 统计调用次数，不影响对象逻辑
        return m_name;
    }

private:
    std::string m_name;
    mutable int m_call_count = 0;  // mutable，可以在 const 函数里修改
};
```

`m_call_count` 是调试用的计数，和对象的业务数据无关，用 `mutable` 修饰完全合理。

### 懒加载（Lazy Evaluation）

```cpp
class Entity {
public:
    const std::string& GetName() const {
        if (!m_cached) {
            m_name = ComputeName();  // 第一次调用才计算
            m_cached = true;
        }
        return m_name;
    }

private:
    mutable std::string m_name;
    mutable bool m_cached = false;
};
```

`GetName()` 对外是 `const` 的（不改变逻辑状态），但内部需要懒加载，通过 `mutable` 实现。

### mutex

多线程场景里，`std::mutex` 经常需要声明为 `mutable`，因为加锁/解锁本身不改变业务状态，但必须在 `const` 函数里执行：

```cpp
class ThreadSafeEntity {
public:
    int GetValue() const {
        std::lock_guard<std::mutex> lock(m_mutex);  // 需要修改 mutex
        return m_value;
    }

private:
    int m_value = 0;
    mutable std::mutex m_mutex;
};
```

**总结：`mutable` 不是用来逃避 `const` 的，而是用于那些不属于对象逻辑状态、但需要在 `const` 上下文中修改的字段。**

---

## 隐式转换与 explicit

### 隐式转换是什么

C++ 允许单参数构造函数自动触发隐式类型转换。来看一个例子：

```cpp
class Entity {
public:
    Entity(const std::string& name) : m_name(name) {}
    Entity(int age) : m_age(age) {}

    void Print() const {
        std::cout << m_name << " " << m_age << std::endl;
    }

private:
    std::string m_name;
    int m_age = 0;
};
```

现在，下面这些写法都是合法的：

```cpp
Entity e1 = std::string("Alice");  // 隐式调用 Entity(const std::string&)
Entity e2 = 25;                    // 隐式调用 Entity(int)
```

你甚至没有写 `Entity(...)`，编译器自动帮你构造了。

### 隐式转换的真实 bug 场景

隐式转换最大的问题是：它在你**没有意识到**的地方悄悄发生。

```cpp
void Process(Entity e) {
    e.Print();
}

int main() {
    Process("hello");  // 你以为这会报错，但它没有
}
```

`Process` 接受的是 `Entity`，你传了一个字符串字面量。C++ 先把 `"hello"` 转成 `std::string`，再用 `Entity(const std::string&)` 构造一个临时 `Entity`，整个过程悄无声息地完成了。

这可能是你想要的行为，但更多时候这是个 bug：你本来想传 `Entity`，结果因为拼写错误或者类型搞混，传了个字符串，编译器没有任何警告。

更糟糕的情况：这次构造可能涉及内存分配、网络连接、文件打开……而你完全不知道它被触发了。

### explicit：关上这扇门

`explicit` 关键字加在构造函数前面，禁止隐式转换：

```cpp
class Entity {
public:
    explicit Entity(const std::string& name) : m_name(name) {}
    explicit Entity(int age) : m_age(age) {}

private:
    std::string m_name;
    int m_age = 0;
};
```

现在：

```cpp
Entity e1 = std::string("Alice");  // 错误：不允许隐式转换
Entity e2 = 25;                    // 错误：不允许隐式转换

Entity e3("Alice");                // 正确：显式构造
Entity e4 = Entity("Alice");       // 正确：显式构造
Entity e5{25};                     // 正确：显式构造

Process("hello");                  // 错误：编译器现在会告诉你类型不匹配
```

编译器会直接报错，你必须明确写出构造过程，这样意图才是清晰的。

### 推荐做法

**单参数构造函数，默认加 `explicit`。**

除非你明确、有意地想要支持隐式转换（比如 `std::string` 接受 `const char*` 就是刻意设计的隐式转换），否则加上 `explicit` 是更安全的选择。

加了 `explicit` 并不影响正常使用，只是要求调用方写得更明确一点。这个额外的字符，可以帮你省掉很多调试时间。

---

## 总结

| 概念 | 核心语义 |
|------|----------|
| `const int* ptr` | 指针可变，值只读 |
| `int* const ptr` | 指针只读，值可变 |
| `const` 成员函数 | 承诺不修改成员变量；`const` 对象只能调用 `const` 成员函数 |
| `const T&` 参数 | 避免拷贝 + 保证只读 |
| `mutable` | 允许在 `const` 函数里修改，用于缓存、计数器、mutex |
| `explicit` | 禁止单参数构造函数的隐式转换 |

这三个特性放在一起，核心都是关于**类型系统的约束和表达意图**。`const` 说"我承诺不改"，`mutable` 说"这个字段例外"，`explicit` 说"请明确告诉我你要构造什么"。

写清楚这些，代码的意图就更容易被编译器和其他人读懂——这是 C++ 写好的一部分。
