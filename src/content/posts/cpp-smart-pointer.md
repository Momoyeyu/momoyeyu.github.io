---
title: C++ 智能指针与 RAII
date: 2023-04-21
description: 'unique_ptr、shared_ptr、weak_ptr 的用法与区别，以及 RAII 自动内存管理机制。'
tags: [C++, 内存]
category: C++ 进阶
episode: 1
draft: false
lang: 'zh_CN'
---

## 简介

智能指针可以自动管理内存，避免因忘记调用 `delete` 而造成的内存泄漏。

## 前置代码

本文示例基于以下头文件和 `Entity` 类：

```cpp
#include<iostream>
#include<string>
#include<memory> // 引入智能指针

class Entity
{
public:
    Entity()
    {
        std::cout << "Created Entity!" << std::endl;
    }

    ~Entity()
    {
        std::cout << "Destroyed Entity!" << std::endl;
    }

    void Print() {}
};
```

## unique_ptr

下面是 `unique_ptr` 的基本用法，花括号用于显式标记作用域：

```cpp
... // 省略前面的代码
int main()
{
    {// 显式作用域开始
        
        std::unique_ptr<Entity> entity = std::make_unique<Entity>();

        entity->Print();
    }// entity 在此离开作用域，自动释放内存

    //main 结束
    std::cin.get();
}
```

`unique_ptr` **不能被拷贝**，这也是其名称的含义。以下用法是非法的：

```cpp
class Example
{
    ...//omit
};
...//omit
    std::unique_ptr<Example> uniq_ptr = std::make_unique<Example>();
    void* ptr
    ptr = uniq_ptr // 非法，unique_ptr 不可拷贝
```

尝试拷贝时编译器会报错。如需转移所有权，可使用移动语义（`std::move`）。

## shared_ptr

`shared_ptr` 通过**引用计数**实现共享所有权：

- 每当一个新的 `shared_ptr` 共享同一对象，引用计数加一；
- 每当一个 `shared_ptr` 销毁，引用计数减一；
- 引用计数归零时，内存才会被释放。

```cpp
int main()
{
    std::shared_ptr<Entity> entity;
    // entity 已声明，但尚未初始化
    {
        std::shared_ptr<Entity> shared_entity = std::make_shared<Entity>();

        entity = shared_entity; // entity 开始共同持有该对象

        entity->Print();
    }
    // shared_entity 在此离开作用域，但内存尚未释放，entity 仍持有
    // because ptr "entity" hold it's memory
}
```

## weak_ptr

`weak_ptr` 可以看作一种特殊的 `shared_ptr`——它可以引用一个 `shared_ptr` 管理的对象，但**不影响引用计数**。

```cpp
int main()
{
    std::weak_ptr<Entity> entity;
    // entity 已声明，但尚未初始化
    {
        std::shared_ptr<Entity> shared_entity = std::make_shared<Entity>();

        entity = shared_entity;

        shared_entity->Print();
    }
    // shared_entity 离开作用域，引用计数归零，内存释放
    // 可通过 weak_ptr 检查其指向的内存是否已被释放
}
```

当所有关联的 `shared_ptr` 都销毁后，`weak_ptr` 不再持有内存，但可以用 `expired()` 或 `lock()` 检查对象是否仍然存在。`weak_ptr` 的典型用途是**打破循环引用**。

## 总结

C++ 中的智能指针用于自动管理内存的分配与释放，防止内存泄漏和悬空指针。三种常用类型均以模板实现：

- `unique_ptr`：独占所有权，不可拷贝，只能移动。适合**单一指针管理一个对象**的场景，离开作用域时自动销毁对象。

- `shared_ptr`：共享所有权，多个指针可指向同一对象，通过**引用计数**追踪引用数量，计数归零时自动销毁对象。

- `weak_ptr`：配合 `shared_ptr` 使用，提供非拥有性引用，**不影响引用计数**，常用于打破循环引用，并可检查对象是否已被销毁。
