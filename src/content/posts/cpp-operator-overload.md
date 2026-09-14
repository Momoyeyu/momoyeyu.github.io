---
title: C++ 运算符重载
date: 2023-04-15
description: '为自定义类型重载 +、<<、== 等运算符，让代码像内置类型一样自然。'
tags: [C++, OOP]
category: C++ 入门
episode: 11
draft: false
lang: 'zh_CN'
---

你有没有想过，`1 + 2` 和 `vec1 + vec2` 在 C++ 里到底有什么区别？

答案是：**几乎没有区别**。`+` 在 C++ 里本质上就是一个函数。对于 `int`，编译器知道怎么处理；对于你自己定义的类型，你可以亲手告诉编译器该怎么做——这就是**运算符重载**。

## 运算符的本质：它就是函数

这是最重要的一句话，记住它，后面所有内容都会豁然开朗：

> **运算符只是语法糖。`a + b` 就是 `operator+(a, b)`。**

编译器看到 `a + b`，会去找一个叫 `operator+` 的函数。如果 `a` 是 `int`，编译器内置了这个实现；如果 `a` 是你自己的类，你需要自己定义它。

你在 Python 里见过 `__add__`、`__eq__` 这些魔法方法吗？C++ 的运算符重载和它们是完全相同的思想——只是语法不同。

```cpp
// 这两行完全等价
vec1 + vec2;
operator+(vec1, vec2);  // 或者 vec1.operator+(vec2)
```

## 贯通全文的例子：Vector2

我们用一个二维向量类来演示所有常用的运算符重载。先搭好骨架：

```cpp
#include <iostream>

struct Vector2 {
    float x, y;

    Vector2(float x, float y) : x(x), y(y) {}
};
```

就这么简单。接下来我们一个一个把运算符装上去。

## 成员函数 vs 非成员函数

重载运算符有两种写法，选哪个取决于**左操作数是谁**。

### 成员函数：左操作数是 `this`

```cpp
struct Vector2 {
    float x, y;
    Vector2(float x, float y) : x(x), y(y) {}

    // 成员函数写法：this 就是左操作数
    Vector2 operator+(const Vector2& other) const {
        return Vector2(x + other.x, y + other.y);
    }
};
```

`vec1 + vec2` 会被翻译成 `vec1.operator+(vec2)`。`vec1` 是 `this`，`vec2` 是参数。

### 非成员函数：两个操作数都是参数

```cpp
// 在类外面定义
Vector2 operator+(const Vector2& a, const Vector2& b) {
    return Vector2(a.x + b.x, a.y + b.y);
}
```

**什么时候必须用非成员函数？** 当左操作数不是你的类的时候。

最典型的例子是 `std::cout << v`——左边是 `std::ostream`，那是标准库的类，你改不了它。所以你只能写成非成员函数：

```cpp
std::ostream& operator<<(std::ostream& os, const Vector2& v) {
    os << "(" << v.x << ", " << v.y << ")";
    return os;
}
```

如果这个函数需要访问类的私有成员，就把它声明为**友元（friend）**：

```cpp
struct Vector2 {
private:
    float x, y;
public:
    // ...
    friend std::ostream& operator<<(std::ostream& os, const Vector2& v);
};
```

## 常用运算符重载详解

### 算术运算符：`+`、`-`、`*`

向量加法、减法、标量乘法——最直观的用法：

```cpp
Vector2 operator+(const Vector2& other) const {
    return { x + other.x, y + other.y };
}

Vector2 operator-(const Vector2& other) const {
    return { x - other.x, y - other.y };
}

// 标量乘法：vec * 2.0f
Vector2 operator*(float scalar) const {
    return { x * scalar, y * scalar };
}
```

注意这里 `operator*` 只支持 `vec * 2.0f`，不支持 `2.0f * vec`（因为左操作数 `float` 不是我们的类）。如果需要两边都支持，还要加一个非成员版本：

```cpp
// 支持 2.0f * vec
Vector2 operator*(float scalar, const Vector2& v) {
    return v * scalar;  // 复用已有的成员函数
}
```

### 比较运算符：`==`、`!=`

```cpp
bool operator==(const Vector2& other) const {
    return x == other.x && y == other.y;
}

bool operator!=(const Vector2& other) const {
    return !(*this == other);  // 复用 ==，保持逻辑一致
}
```

`operator!=` 直接用 `!(*this == other)` 实现——不要复制粘贴相同逻辑，复用它。

### 输出流：`operator<<`

**必须是非成员函数**，而且**必须返回 `ostream&`**。

为什么要返回引用？因为链式调用：

```cpp
cout << a << b << c;
// 等价于
((cout << a) << b) << c;
```

每次 `<<` 必须返回同一个 `cout`（的引用），下一次 `<<` 才有地方调用。如果返回 `void` 或者返回值，链式调用就断了。

```cpp
std::ostream& operator<<(std::ostream& os, const Vector2& v) {
    os << "(" << v.x << ", " << v.y << ")";
    return os;  // 必须返回 os 的引用
}
```

### 下标运算符：`operator[]`

如果你想用 `v[0]` 访问 x，`v[1]` 访问 y：

```cpp
float& operator[](int index) {
    return index == 0 ? x : y;
}

// const 版本：用于 const 对象
const float& operator[](int index) const {
    return index == 0 ? x : y;
}
```

返回**引用**是关键——这样 `v[0] = 3.0f` 也能正常工作（可以赋值）。

### 函数调用运算符：`operator()`

重载 `()` 让对象可以像函数一样被调用，这样的对象叫**仿函数（functor）**：

```cpp
struct Adder {
    float value;
    Adder(float v) : value(v) {}

    float operator()(float x) const {
        return x + value;
    }
};

Adder add5(5.0f);
std::cout << add5(3.0f);  // 输出 8
```

`std::sort` 的自定义比较器、`std::function` 背后都是这个机制。

## 完整的 Vector2 类

把所有内容整合到一起，这是一个完整可运行的版本：

```cpp
#include <iostream>

struct Vector2 {
    float x, y;

    Vector2(float x = 0, float y = 0) : x(x), y(y) {}

    // 算术运算
    Vector2 operator+(const Vector2& other) const {
        return { x + other.x, y + other.y };
    }

    Vector2 operator-(const Vector2& other) const {
        return { x - other.x, y - other.y };
    }

    Vector2 operator*(float scalar) const {
        return { x * scalar, y * scalar };
    }

    // 复合赋值
    Vector2& operator+=(const Vector2& other) {
        x += other.x;
        y += other.y;
        return *this;
    }

    // 比较
    bool operator==(const Vector2& other) const {
        return x == other.x && y == other.y;
    }

    bool operator!=(const Vector2& other) const {
        return !(*this == other);
    }

    // 下标访问
    float& operator[](int index) {
        return index == 0 ? x : y;
    }

    const float& operator[](int index) const {
        return index == 0 ? x : y;
    }

    // 输出流（非成员友元）
    friend std::ostream& operator<<(std::ostream& os, const Vector2& v);
};

// 非成员：输出流
std::ostream& operator<<(std::ostream& os, const Vector2& v) {
    return os << "(" << v.x << ", " << v.y << ")";
}

// 非成员：标量在左边的乘法
Vector2 operator*(float scalar, const Vector2& v) {
    return v * scalar;
}

int main() {
    Vector2 a(1.0f, 2.0f);
    Vector2 b(3.0f, 4.0f);

    std::cout << "a = " << a << "\n";         // (1, 2)
    std::cout << "b = " << b << "\n";         // (3, 4)
    std::cout << "a + b = " << a + b << "\n"; // (4, 6)
    std::cout << "a - b = " << a - b << "\n"; // (-2, -2)
    std::cout << "a * 2 = " << a * 2 << "\n"; // (2, 4)
    std::cout << "3 * b = " << 3 * b << "\n"; // (9, 12)

    std::cout << "a == b: " << (a == b) << "\n"; // 0
    std::cout << "a != b: " << (a != b) << "\n"; // 1

    std::cout << "a[0] = " << a[0] << "\n"; // 1
    std::cout << "a[1] = " << a[1] << "\n"; // 2

    // 链式输出
    std::cout << "chained: " << a << " and " << b << "\n";

    return 0;
}
```

输出结果：

```
a = (1, 2)
b = (3, 4)
a + b = (4, 6)
a - b = (-2, -2)
a * 2 = (2, 4)
3 * b = (9, 12)
a == b: 0
a != b: 1
a[0] = 1
a[1] = 2
chained: (1, 2) and (3, 4)
```

## C++20 飞船运算符 `<=>`

在 C++20 之前，如果你想支持所有六个比较运算符（`<`、`>`、`<=`、`>=`、`==`、`!=`），你得写六个函数——很烦。

C++20 引入了**三路比较运算符**（三路比较，又叫飞船运算符，因为 `<=>` 长得像飞船）：

```cpp
#include <compare>

struct Vector2 {
    float x, y;

    // 一个 <=> 搞定所有比较
    auto operator<=>(const Vector2& other) const = default;
    bool operator==(const Vector2& other) const = default;
};
```

`= default` 让编译器自动生成按成员逐一比较的实现。有了 `<=>` 之后，`<`、`>`、`<=`、`>=` 都会自动派生出来，`==` 和 `!=` 也会。

如果你需要自定义比较逻辑（比如按向量长度比较），也可以手写：

```cpp
auto operator<=>(const Vector2& other) const {
    float len1 = x * x + y * y;
    float len2 = other.x * other.x + other.y * other.y;
    return len1 <=> len2;
}
```

返回类型 `auto` 会推导为 `std::partial_ordering`（浮点数）或 `std::strong_ordering`（整数）。

## 什么时候不应该重载

运算符重载是把双刃剑。用得好，代码像诗；用得烂，代码像谜。

**不要重载**这些运算符：

- `operator,`（逗号运算符）：几乎没有人知道它的语义，重载后会让人困惑
- `operator&&` 和 `operator||`：内置版本有**短路求值**（左边为假就不算右边），重载后短路行为消失，会出 bug
- 语义不直观的场合：如果你需要注释来解释 `a + b` 是什么意思，就不要重载 `+`

好的运算符重载应该满足**最小惊讶原则**：看到 `a + b`，用户应该能猜到它在做什么，而且猜对了。

## 小结

| 运算符 | 建议写法 | 关键点 |
|--------|----------|--------|
| `+`、`-`、`*` | 成员函数 | 返回新对象，标记 `const` |
| `+=`、`-=` | 成员函数 | 返回 `*this` 的引用 |
| `==`、`!=` | 成员函数 | `!=` 复用 `==` |
| `<<` | 非成员友元 | 返回 `ostream&`，支持链式 |
| `[]` | 成员函数 | 返回引用，提供 `const` 版本 |
| `()` | 成员函数 | 仿函数，配合 STL 算法使用 |
| `<=>` | 成员函数 | C++20，一次定义所有比较 |

运算符重载的核心思想很简单：**它只是函数，只是名字比较特殊**。搞清楚左操作数是谁、是否需要返回引用、是否需要链式调用，其他的都是细节。

下一篇我们聊模板（Templates）——让一个函数或类同时支持 `int`、`float`、`Vector2` 各种类型，真正实现"写一次，到处用"。
