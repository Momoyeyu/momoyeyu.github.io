---
title: C++ 继承与多态
date: 2023-03-26
description: '虚函数、vtable 机制、纯虚函数（接口）以及多态的底层实现。'
tags: [C++, OOP]
category: C++ 入门
episode: 8
draft: false
lang: 'zh_CN'
---

继承和多态是 OOP 的核心概念，这个相信你已经有基础了。这篇文章不打算重新解释"什么是多态"，而是把重点放在 C++ 的具体实现上——虚函数是怎么工作的，vtable 长什么样，接口怎么用纯虚函数来模拟，以及一个经常被忽略的坑：虚析构函数。

## 继承基础

先把语法过一遍。

```cpp
class Animal {
public:
    std::string name;

    Animal(const std::string& name) : name(name) {}

    void Speak() {
        std::cout << name << " makes a sound." << std::endl;
    }
};

class Dog : public Animal {
public:
    Dog(const std::string& name) : Animal(name) {}

    void Speak() {
        std::cout << name << " barks." << std::endl;
    }
};
```

`class Dog : public Animal` 这一行的 `public` 是继承方式，决定基类成员在派生类里的访问权限：

- **public 继承**：基类的 `public` 成员在派生类里还是 `public`，`protected` 还是 `protected`。这是最常用的方式，语义上表示"is-a"关系——Dog is-a Animal。
- **private 继承**：基类的所有 public/protected 成员在派生类里全变成 `private`。语义上更像"用…实现"，而不是"是…"，实际项目里用得很少。

派生类拥有基类的所有成员。上面的 `Dog` 对象里同时有 `name`（来自 Animal）和自己的 `Speak`。

## 没有 virtual 时发生什么

这里有一个经典的坑，在真正理解虚函数之前，先要把这个坑看清楚。

```cpp
#include <iostream>
#include <string>

class Animal {
public:
    std::string name;
    Animal(const std::string& name) : name(name) {}

    void Speak() {
        std::cout << name << " makes a sound." << std::endl;
    }
};

class Dog : public Animal {
public:
    Dog(const std::string& name) : Animal(name) {}

    void Speak() {
        std::cout << name << " barks." << std::endl;
    }
};

int main() {
    Dog dog("Rex");
    dog.Speak(); // 输出 "Rex barks."，没问题

    Animal* a = new Dog("Rex");
    a->Speak(); // 你以为输出 "Rex barks."，实际上输出 "Rex makes a sound."

    delete a;
    return 0;
}
```

`a->Speak()` 调用的是 `Animal::Speak`，而不是 `Dog::Speak`。

原因在于：**没有 `virtual` 时，函数调用在编译期就已经确定了**。编译器看到 `a` 的类型是 `Animal*`，于是直接绑定到 `Animal::Speak`。运行期的实际对象类型（Dog）完全被忽略了。这叫**静态分派**（static dispatch）。

这种行为在某些场景是合理的，但如果你的意图是"根据对象的实际类型决定调用哪个函数"，就必须用 `virtual`。

## virtual：开启动态分派

加上 `virtual`，行为就完全不同了：

```cpp
#include <iostream>
#include <string>

class Animal {
public:
    std::string name;
    Animal(const std::string& name) : name(name) {}

    virtual void Speak() {
        std::cout << name << " makes a sound." << std::endl;
    }
};

class Dog : public Animal {
public:
    Dog(const std::string& name) : Animal(name) {}

    void Speak() override {
        std::cout << name << " barks." << std::endl;
    }
};

int main() {
    Animal* a = new Dog("Rex");
    a->Speak(); // 现在输出 "Rex barks."

    delete a;
    return 0;
}
```

`override` 关键字是 C++11 引入的，它的作用是**显式声明这个函数在覆盖基类的虚函数**。编译器会帮你检查：如果基类里没有一个签名匹配的虚函数，就报错。没有 `override` 程序也能编译运行，但加上是好习惯——能防止函数签名写错（比如把 `Speak()` 误写成 `Speak(int)` 导致变成重载而非覆盖）而自己完全不知道。

## vtable：虚函数的底层实现

虚函数为什么能做到动态分派？靠的是**虚函数表（vtable）**。

### 对象在内存里长什么样

每个**含有虚函数的类**都有一张对应的 vtable，这张表在编译期生成，存在程序的只读数据段里，所有该类的对象共享这一张表。

vtable 本质上是一个函数指针数组，里面存着这个类的所有虚函数的实际地址：

```
Animal 的 vtable:
  [0] -> Animal::Speak
  [1] -> Animal::~Animal   （如果析构函数是虚的）

Dog 的 vtable:
  [0] -> Dog::Speak        （覆盖了 Animal::Speak）
  [1] -> Dog::~Dog
```

每个对象在内存最前面都有一个隐藏的指针，叫 **vptr**（虚函数表指针），指向所属类的 vtable。对象在构造时，构造函数会把 vptr 指向正确的 vtable。

所以一个 `Dog` 对象在内存里大概长这样：

```
+----------+
| vptr     |  →  Dog 的 vtable → [Dog::Speak, Dog::~Dog, ...]
+----------+
| name     |  （继承自 Animal 的成员）
+----------+
```

一个 `Animal` 对象：

```
+----------+
| vptr     |  →  Animal 的 vtable → [Animal::Speak, Animal::~Animal, ...]
+----------+
| name     |
+----------+
```

### 调用虚函数的过程

```cpp
Animal* a = new Dog("Rex");
a->Speak();
```

这行调用在运行期经历了：

1. 读 `a` 所指对象内存最前面的 vptr，得到 Dog 的 vtable 地址
2. 从 vtable 里按照 `Speak` 的固定槽位取出函数指针
3. 跳转过去，调用 `Dog::Speak`

相比直接调用（直接跳转到一个编译期确定的地址），虚函数调用多了**两次内存访问**（读 vptr、读 vtable 里的函数指针）。这就是虚函数有运行期开销的根本原因。

在绝大多数业务代码里这点开销可以忽略。但如果你在写游戏引擎的热路径，或者对大量对象做高频虚函数调用，这个开销就值得考虑了。

另外，vptr 本身占用对象内存（64 位系统上是 8 字节）。一个只含一个 `int` 成员的类如果有虚函数，对象大小就会从 4 字节变成 16 字节（加上 vptr 和对齐）。

## 纯虚函数与接口

有时候你想定义一个"协议"：任何实现它的类都必须提供某个函数，但基类本身不提供任何实现。这就是**纯虚函数**：

```cpp
class Drawable {
public:
    virtual void Draw() = 0;  // 纯虚函数，= 0 表示"无实现"
    virtual ~Drawable() = default;
};
```

规则：
- 含有纯虚函数的类是**抽象类**，不能直接实例化（`Drawable d;` 会编译报错）
- 派生类必须实现所有纯虚函数，否则派生类也变成抽象类，同样不能实例化

C++ 没有 `interface` 关键字（Java/C# 有）。**只含纯虚函数的抽象类**就是 C++ 里模拟接口的标准方式：

```cpp
#include <iostream>
#include <vector>
#include <memory>

class Drawable {
public:
    virtual void Draw() = 0;
    virtual ~Drawable() = default;
};

class Circle : public Drawable {
public:
    void Draw() override {
        std::cout << "Drawing Circle" << std::endl;
    }
};

class Square : public Drawable {
public:
    void Draw() override {
        std::cout << "Drawing Square" << std::endl;
    }
};

void RenderAll(const std::vector<std::unique_ptr<Drawable>>& shapes) {
    for (const auto& shape : shapes) {
        shape->Draw();  // 动态分派，具体调用哪个 Draw 由运行期对象类型决定
    }
}

int main() {
    std::vector<std::unique_ptr<Drawable>> shapes;
    shapes.push_back(std::make_unique<Circle>());
    shapes.push_back(std::make_unique<Square>());
    shapes.push_back(std::make_unique<Circle>());

    RenderAll(shapes);
    return 0;
}
```

输出：
```
Drawing Circle
Drawing Square
Drawing Circle
```

`RenderAll` 完全不知道传进来的具体类型，它只依赖 `Drawable` 这个接口。新增一个 `Triangle` 类只需要继承 `Drawable` 并实现 `Draw()`，不用改 `RenderAll` 一行代码。这就是多态的实际价值。

## 虚析构函数：一个很容易中招的坑

如果你用基类指针管理派生类对象，**基类的析构函数必须声明为 virtual**，否则 `delete` 时只会调用基类的析构函数，派生类的析构函数不会被调用，资源泄漏。

来看实际演示：

```cpp
#include <iostream>

class Base {
public:
    Base() { std::cout << "Base constructed" << std::endl; }
    ~Base() { std::cout << "Base destructed" << std::endl; }  // 没有 virtual！
};

class Derived : public Base {
public:
    Derived() { std::cout << "Derived constructed" << std::endl; }
    ~Derived() { std::cout << "Derived destructed" << std::endl; }
};

int main() {
    Base* obj = new Derived();
    delete obj;
    return 0;
}
```

输出：
```
Base constructed
Derived constructed
Base destructed
```

`Derived destructed` 根本没出现。`Derived` 的析构函数没有被调用。如果 `Derived` 里有 `new` 出来的内存、文件句柄、互斥锁等资源，全部泄漏。

加上 `virtual` 就对了：

```cpp
class Base {
public:
    Base() { std::cout << "Base constructed" << std::endl; }
    virtual ~Base() { std::cout << "Base destructed" << std::endl; }
};
```

输出：
```
Base constructed
Derived constructed
Derived destructed
Base destructed
```

析构顺序是先派生类后基类，这是正确的行为。

**规则很简单：只要一个类会被继承，析构函数就应该声明为 `virtual`。** 就算基类的析构函数什么都不做，也要写成 `virtual ~Base() = default;`。

## final：禁止继续继承或覆盖

C++11 还引入了 `final` 关键字，用于两个场景：

**禁止类被继承：**

```cpp
class Animal {
public:
    virtual void Speak() {}
};

class Dog final : public Animal {
public:
    void Speak() override {}
};

class Poodle : public Dog {  // 编译报错：Dog 是 final，不能被继承
};
```

**禁止虚函数被进一步覆盖：**

```cpp
class Animal {
public:
    virtual void Speak() {}
};

class Dog : public Animal {
public:
    void Speak() final {}  // Speak 在这里终止覆盖链
};

class Poodle : public Dog {
public:
    void Speak() override {}  // 编译报错：Dog::Speak 是 final
};
```

`final` 的实际用途之一是性能优化：编译器知道某个虚函数不会再被覆盖，有时可以将虚函数调用优化为直接调用（去虚化，devirtualization），省掉 vtable 查找的开销。

## 小结

| 特性 | 关键点 |
|---|---|
| 继承 | `class Dog : public Animal`；子类拥有父类全部成员 |
| 无 virtual | 编译期静态绑定，基类指针调用的是基类函数 |
| virtual | 运行期动态分派，靠 vtable + vptr 实现 |
| override | 显式标注覆盖，让编译器帮你检查签名 |
| 纯虚函数 | `= 0`；抽象类不能实例化；模拟接口 |
| 虚析构函数 | 基类只要会被继承就应该加 virtual，否则 delete 时资源泄漏 |
| final | 禁止继续继承或覆盖；可能帮助编译器去虚化 |

vtable 机制不复杂，但理解它之后，很多之前困惑的问题（为什么不加 virtual 就调用错了、为什么虚函数有开销、为什么要虚析构函数）就都有了清晰的解释。
