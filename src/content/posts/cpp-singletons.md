---
title: C++ 单例模式
date: 2024-03-15
description: '用 C++ 实现线程安全的单例、local static 的单例写法，以及单例的滥用问题。'
tags: [C++, OOP]
category: C++ 进阶
episode: 17
draft: false
lang: 'zh_CN'
---

## 什么是单例

单例（Singleton）是一种设计模式，目标很简单：**保证一个类在整个程序运行期间只有一个实例**，并提供一个全局访问点。

典型使用场景：

- **日志系统**：所有模块往同一个 logger 写，不能各自创建
- **配置管理器**：全局配置只需要解析一次
- **资源管理器**：统一管理纹理、字体等资源的生命周期
- **设备句柄**：GPU context（如 CUDA context）、cuBLAS handle，底层 API 通常要求单例语义

这些场景有一个共同特点：创建多个实例是错误的，或者代价极大。

---

## 朴素实现（有问题）

最直觉的写法是用一个静态指针：

```cpp
class Logger {
public:
    static Logger* Get() {
        if (!s_Instance)
            s_Instance = new Logger();
        return s_Instance;
    }

    void Log(const std::string& msg) { /* ... */ }

private:
    Logger() {}
    static Logger* s_Instance;
};

Logger* Logger::s_Instance = nullptr;
```

这个写法在单线程下能跑，但有几个明显的问题：

**线程不安全**：两个线程同时第一次调用 `Get()`，都看到 `s_Instance == nullptr`，然后都 `new` 出一个实例，其中一个会泄漏。

**内存泄漏**：没有对应的 `delete`，除非手动管理。

**可以被拷贝**：`Logger copy = *Logger::Get()` 可以编译通过，单例语义被破坏。

---

## Meyers Singleton（推荐写法）

Scott Meyers 推广了一种更简洁、线程安全的写法，利用 **local static** 的初始化保证：

```cpp
class Singleton {
public:
    static Singleton& Get() {
        static Singleton instance; // C++11 保证线程安全
        return instance;
    }

    // 禁止拷贝和赋值
    Singleton(const Singleton&) = delete;
    Singleton& operator=(const Singleton&) = delete;

    void DoSomething() { /* ... */ }

private:
    Singleton() {}  // 私有构造函数
};

// 使用方式
Singleton::Get().DoSomething();
```

几个关键点：

**返回引用而不是指针**：避免调用者意外 `delete Singleton::Get()`，引用在语义上更清晰——你只是在借用这个实例，并不拥有它。

**`= delete` 拷贝构造和赋值运算符**：防止这种破坏单例的写法：
```cpp
Singleton copy = Singleton::Get(); // 编译错误，完美
```

**私有构造函数**：外部无法直接 `new Singleton()`。

---

## C++11 的 Magic Statics

C++11 之前，local static 在多线程下是不安全的。考虑这个场景：

```
线程 A 进入 Get()，开始初始化 static instance
线程 B 同时进入 Get()，看到 instance 还没初始化完
线程 B 也开始初始化 → 两次构造，行为未定义
```

C++11 标准明确规定（[stmt.dcl]）：

> [!IMPORTANT]
> 如果多个线程同时试图初始化同一个 local static 变量，除了正在执行初始化的线程，其余线程都会阻塞，直到初始化完成。

编译器会在生成的代码里插入一个隐式的原子操作（通常是一个 `atomic<bool>` 或系统级 mutex），伪代码大概是：

```cpp
static Singleton instance; // 编译器展开为类似：

static std::atomic<bool> initialized{false};
static std::aligned_storage<sizeof(Singleton)> storage;

if (!initialized.load(std::memory_order_acquire)) {
    static std::mutex mtx;
    std::lock_guard<std::mutex> lock(mtx);
    if (!initialized.load(std::memory_order_relaxed)) {
        new (&storage) Singleton();
        initialized.store(true, std::memory_order_release);
    }
}
```

这个机制叫 **magic statics**。你写一行 `static Singleton instance;`，编译器帮你做了线程安全的 double-checked locking。

---

## 单例的生命周期问题

Local static 对象在程序结束时析构，析构顺序是构造顺序的**逆序**。

如果你有两个单例，`A` 的析构函数用到了 `B`，但 `B` 比 `A` 先构造（因此比 `A` 后析构），就会出问题：

```cpp
// A 的析构函数
~A() {
    B::Get().Log("A destroyed"); // B 可能已经析构了！
}
```

这就是臭名昭著的 **Static Initialization Order Fiasco（静态初始化顺序灾难）**。跨翻译单元的静态对象初始化顺序是未定义的，析构顺序同样不可靠。

规避方法：

1. 单例之间尽量不要相互依赖，尤其是在析构阶段
2. 在析构函数里检查依赖的单例是否还活着（用 `std::weak_ptr` 等手段，但这样实现就复杂了）
3. 从设计上避免这种互依赖

---

## 单例 vs 全局变量

有人会问：单例和全局变量有什么区别？

```cpp
// 全局变量
Logger g_logger; // main() 之前初始化

// 单例
Logger& logger = Logger::Get(); // 第一次调用时初始化（懒加载）
```

| | 全局变量 | 单例（Meyers） |
|---|---|---|
| 初始化时机 | main() 之前 | 第一次调用时 |
| 初始化顺序 | 跨翻译单元未定义 | 调用顺序决定 |
| 线程安全初始化 | 需要手动保证 | C++11 保证 |
| 可以禁止拷贝 | 不行 | 可以 |

但本质上，**两者都是全局状态**，都有相同的工程问题。

---

## 单例的问题

单例被滥用得非常严重，需要认真对待它的缺点：

**隐式依赖**：函数体内偷偷调用了 `Logger::Get()`，函数签名上看不出来这个依赖。代码读起来、测试起来都很痛苦。

```cpp
void ProcessData(const Data& data) {
    // 看函数签名你不知道这里有一个全局依赖
    Logger::Get().Log("Processing...");
    // ...
}
```

**测试困难**：单例是全局状态，单元测试之间会互相污染。你很难在测试 A 里用一个 mock logger，测试 B 里用真实 logger。

**多线程访问模式**：初始化是线程安全的，但 `Get()` 之后的操作不一定是。如果 `Singleton` 内部有可变状态，你还是需要自己加锁。

---

## 更好的替代：依赖注入

很多情况下，单例可以用**依赖注入（Dependency Injection）**替代：

```cpp
// 单例写法（隐式依赖）
class Engine {
    void Run() {
        Logger::Get().Log("Running"); // 隐藏依赖
    }
};

// 依赖注入写法（显式依赖）
class Engine {
public:
    explicit Engine(Logger& logger) : m_Logger(logger) {}
    void Run() {
        m_Logger.Log("Running"); // 依赖显式可见
    }
private:
    Logger& m_Logger;
};

// 调用方负责组装依赖
Logger logger;
Engine engine(logger);
engine.Run();
```

依赖注入的好处：

- 依赖关系在编译期可见，函数签名诚实
- 测试时可以传入 mock 对象
- 模块间耦合更低

代价是：你需要在某个地方（通常是 main 或 Application 类）把所有依赖"组装"起来，代码量稍多一些。

---

## AI Infra 中的单例场景

在 AI 基础设施代码里，有几个地方单例是合理的：

**CUDA Context**：`cudaSetDevice()` 绑定到当前线程，多设备管理器通常是单例。

```cpp
class CudaContextManager {
public:
    static CudaContextManager& Get() {
        static CudaContextManager instance;
        return instance;
    }
    void SetDevice(int device_id) { cudaSetDevice(device_id); }
private:
    CudaContextManager() { cudaSetDevice(0); }
};
```

**cuBLAS Handle**：创建 handle 代价很高，全局共享一个是常见做法（但要注意线程安全）。

**全局线程池**：推理服务里的 worker thread pool 通常只需要一个，按 CPU 核数初始化。

**推理引擎实例**：模型权重加载进内存之后，整个进程共享同一份，不可能每个请求都重新加载。

这些场景的共同点是：**资源本身在系统层面就是单例的**（GPU 就一块，内存里的权重就一份），用单例模式符合语义。

---

## 小结

| | 推荐 | 不推荐 |
|---|---|---|
| 实现方式 | Meyers Singleton（local static） | 静态指针 + 手动 `new` |
| 线程安全 | C++11 magic statics 保证 | 需要自己 double-checked locking |
| 拷贝控制 | `= delete` 拷贝构造和赋值 | 忘记禁用 |
| 使用场景 | 系统级资源、设备句柄 | 业务逻辑（用依赖注入替代） |

Meyers Singleton 的三行核心：local static、引用返回、`= delete` 拷贝。记住这三点，你的单例就不会出大问题。但更重要的是：**想清楚你是不是真的需要单例**，很多时候依赖注入是更好的选择。
