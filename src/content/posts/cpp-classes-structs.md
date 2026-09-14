---
title: C++ 类与结构体
date: 2023-03-15
description: 'class 与 struct 的区别、成员函数背后的 this 指针、以及对象在内存中的布局。'
tags: [C++, OOP]
category: C++ 入门
episode: 7
draft: false
lang: 'zh_CN'
---

有 Python 或 Java 基础的话，"类"这个概念本身不用解释。这篇想聚焦在 C++ 独有的行为上——内存里到底发生了什么，`this` 指针是谁，初始化列表为什么比在构造函数体内赋值更好。这些是从其他语言迁移过来最容易忽略的点。

## class 和 struct 只有一个区别

很多人以为 `class` 和 `struct` 是两种不同的东西。其实不是，**唯一的区别是默认访问权限**：

- `class`：成员默认 `private`
- `struct`：成员默认 `public`

```cpp
class Foo {
    int x;  // private，外部不可访问
};

struct Bar {
    int x;  // public，外部可以直接访问
};
```

仅此而已。`struct` 里一样可以写成员函数、继承、构造函数；`class` 里一样可以把所有东西都声明 `public`。

C++ 保留 `struct` 是为了兼容 C——C 代码里的结构体可以直接用。习惯上的约定（不是语言强制的）是：`struct` 用于纯数据聚合（Plain Old Data，POD），比如坐标点、颜色；`class` 用于有行为、需要封装的对象。你会在标准库里看到这种风格，比如 `std::pair` 是 `struct`，而 `std::vector` 是 `class`。

## class 不是什么魔法

先说清楚一件事：**class 就是把变量和函数打包在一起的一种方式，加上访问控制，没别的。**

```cpp
class Vec2 {
public:
    float x, y;

    float length() const {
        return std::sqrt(x * x + y * y);
    }
};
```

这个 `Vec2` 在内存里就是两个相邻的 `float`，跟下面这段 C 代码等价：

```c
struct Vec2 {
    float x;
    float y;
};

float Vec2_length(const Vec2* self) {
    return sqrtf(self->x * self->x + self->y * self->y);
}
```

函数不存在对象"里面"，对象里只有数据。

## 成员变量的内存布局

对象在内存里就是成员变量依次排列，加上编译器可能插入的对齐填充（padding）。用 `sizeof` 和 `offsetof` 可以直接验证：

```cpp
#include <cstddef>
#include <cstdio>

struct Example {
    char  a;   // 1 字节
    int   b;   // 4 字节，但需要 4 字节对齐
    char  c;   // 1 字节
    // 编译器会在 c 后填充 3 字节使整体大小是 4 的倍数
};

int main() {
    printf("sizeof(Example) = %zu\n", sizeof(Example));
    printf("offsetof(a) = %zu\n", offsetof(Example, a));
    printf("offsetof(b) = %zu\n", offsetof(Example, b));
    printf("offsetof(c) = %zu\n", offsetof(Example, c));
}
```

输出：

```
sizeof(Example) = 12
offsetof(a) = 0
offsetof(b) = 4
offsetof(c) = 8
```

`a` 占 1 字节，但 `b` 要求 4 字节对齐，所以中间填了 3 字节。`c` 之后还有 3 字节 padding 把整体撑到 12。

也可以直接打印地址来验证：

```cpp
Example e;
printf("&e   = %p\n", (void*)&e);
printf("&e.a = %p\n", (void*)&e.a);
printf("&e.b = %p\n", (void*)&e.b);
printf("&e.c = %p\n", (void*)&e.c);
```

你会看到 `&e` 和 `&e.a` 一样，`&e.b` 比 `&e` 偏移了 4 字节，`&e.c` 偏移了 8 字节，跟 `offsetof` 的结果吻合。

如果把字段顺序改成 `char a; char c; int b;`，总大小就变成 8 了，因为两个 `char` 连在一起，只需要在后面填 2 字节对齐到 4。**字段声明顺序会影响结构体大小**，这是个实际中需要注意的点。

## this 指针：成员函数的隐藏参数

成员函数在底层就是普通函数，只是编译器偷偷多传了一个 `this` 指针——指向调用它的那个对象。

```cpp
class Counter {
public:
    int count = 0;

    void increment() {
        count++;           // 等价于 this->count++
    }

    Counter* getThis() {
        return this;       // 返回当前对象的地址
    }
};
```

编译器看到 `obj.increment()` 时，实际上生成的调用大致等价于：

```cpp
// 伪代码，展示底层发生了什么
void Counter_increment(Counter* this) {
    this->count++;
}

Counter obj;
Counter_increment(&obj);  // obj.increment() 的底层等价形式
```

`this->x` 和直接写 `x` 是完全等价的，前者只是更明确地说明在访问当前对象的成员。`this` 在需要区分成员变量和参数同名的时候特别有用：

```cpp
class Point {
public:
    int x, y;

    // 参数名和成员名相同，用 this 消歧义
    void set(int x, int y) {
        this->x = x;
        this->y = y;
    }
};
```

## 访问修饰符

C++ 有三种访问修饰符：

| 修饰符 | 类内 | 派生类 | 外部 |
|--------|------|--------|------|
| `public` | ✓ | ✓ | ✓ |
| `protected` | ✓ | ✓ | ✗ |
| `private` | ✓ | ✗ | ✗ |

把实现细节设成 `private` 是个好习惯——不是因为要防止别人"作弊"，而是让类的接口和实现分离。内部实现变了，只要公共接口不动，调用方的代码就不需要改。

```cpp
class BankAccount {
public:
    void deposit(double amount) {
        if (amount > 0) balance_ += amount;
    }

    double getBalance() const { return balance_; }

private:
    double balance_ = 0.0;  // 外部不能直接改，必须走 deposit
};
```

如果 `balance_` 是 `public`，任何人都能写 `account.balance_ = -999`。

## 构造函数与成员初始化列表

构造函数是对象创建时自动调用的函数。有一个很多人忽略的细节：**成员初始化列表比在函数体内赋值更高效**。

先看一个有 copy constructor 的类来说明为什么：

```cpp
class Heavy {
public:
    Heavy() { puts("Heavy()"); }
    Heavy(const Heavy&) { puts("Heavy(copy)"); }
    Heavy& operator=(const Heavy&) { puts("Heavy="); return *this; }
};
```

**方式一：函数体内赋值（不推荐）**

```cpp
class Foo {
public:
    Foo(const Heavy& h) {
        h_ = h;   // 先默认构造 h_，再赋值——两步操作
    }
private:
    Heavy h_;
};

Foo f(someHeavy);
// 输出：
// Heavy()    ← h_ 被默认构造
// Heavy=     ← 然后再被赋值
```

**方式二：成员初始化列表（推荐）**

```cpp
class Bar {
public:
    Bar(const Heavy& h) : h_(h) {}  // 直接用 copy constructor 构造
private:
    Heavy h_;
};

Bar b(someHeavy);
// 输出：
// Heavy(copy)  ← 只有一次 copy 构造，没有多余的默认构造
```

成员初始化列表直接调用成员的构造函数，跳过了"先默认构造再赋值"这个多余的步骤。对于有非默认构造的成员（比如没有默认构造函数的类型、`const` 成员、引用成员），初始化列表甚至是**唯一**合法的方式。

```cpp
class Config {
public:
    Config(int id, const std::string& name)
        : id_(id),        // int，没什么区别，但保持风格一致
          name_(name),    // string，避免多一次默认构造
          ratio_(1.0)     // const 成员，必须在初始化列表里设置
    {}

private:
    const int id_;
    std::string name_;
    const double ratio_;
};
```

初始化列表里的顺序不影响实际初始化顺序——成员按**声明顺序**初始化，不是按列表里写的顺序。所以最好让列表顺序和声明顺序一致，避免产生困惑。

## enum class：有类型安全的枚举

顺带说一下 `enum class`，它和裸 `enum` 的区别在于类型安全和作用域：

```cpp
// 裸 enum：容易污染命名空间，可以隐式转换为 int
enum Direction { North, South, East, West };
int d = North;  // 合法，但通常不是你想要的

// enum class：必须带上枚举名，不能隐式转换
enum class Dir { North, South, East, West };
Dir d = Dir::North;  // 必须写 Dir::
// int x = Dir::North;  // 编译错误
int x = static_cast<int>(Dir::North);  // 显式转换才行
```

`enum class` 也可以指定底层类型：

```cpp
enum class Status : uint8_t {
    OK    = 0,
    Error = 1,
    Busy  = 2,
};
```

用 `switch` 处理时，编译器会提醒你没有覆盖所有枚举值（如果开了 `-Wswitch` 警告），比裸 `enum` 更安全。

---

总结一下这篇的核心：

- `class` 和 `struct` 只差默认访问权限，别的完全一样
- 对象在内存里就是数据，成员函数不占对象空间
- 成员函数有个隐藏的 `this` 参数，`this->x` 和 `x` 等价
- 成员初始化列表比函数体内赋值少一次构造，`const` 成员必须用它
- `enum class` 比裸 `enum` 有类型安全，优先用它
