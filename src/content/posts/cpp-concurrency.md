---
title: C++ 并发与原子操作
date: 2023-11-05
description: 'std::thread 的使用、数据竞争与互斥锁、原子操作的内存序，以及和 CUDA stream 的关系。'
tags: [C++, 并发, AI Infra]
category: C++ 进阶
episode: 12
draft: false
lang: 'zh_CN'
---

AI Infra 开发离不开并发。CPU 端要多线程准备 batch 数据，GPU 端要管理多个 CUDA stream，两者之间还要同步。没有扎实的并发基础，调 bug 会让你怀疑人生——程序偶尔崩溃、结果随机错误，而且只在生产环境复现。

这篇文章从 `std::thread` 出发，讲清楚数据竞争、互斥锁、原子操作和内存序，最后把这些概念和 CUDA 的异步模型对应起来。

---

## 1. std::thread 基础

### 创建线程

```cpp
#include <thread>
#include <iostream>

void worker(int id) {
    std::cout << "Thread " << id << " running\n";
}

int main() {
    std::thread t(worker, 42);  // 立即启动，参数默认拷贝
    t.join();                   // 等待线程结束
    return 0;
}
```

`std::thread` 构造时线程就启动了，第一个参数是可调用对象（函数、lambda、仿函数），后面跟参数。

### join vs detach

这是最容易踩的坑之一：

```cpp
{
    std::thread t(worker, 1);
    // 忘记 join 或 detach → 析构时调用 std::terminate，程序直接崩溃
}
```

- **`join()`**：主线程阻塞，等子线程结束后继续。子线程的生命周期由主线程管理。
- **`detach()`**：线程独立运行，主线程不等它。适合"发射后不管"的场景，但要确保线程访问的数据在它结束前一直有效——否则就是悬空引用。

```cpp
std::thread t(worker, 1);
t.detach();  // 线程独立运行，t 不再持有句柄
// t.join()  // detach 后不能再 join，会抛异常
```

实践建议：绝大多数情况下用 `join()`，或者用后面会提到的线程池。`detach()` 用错很难调试。

### 传引用

默认情况下参数是拷贝的，想传引用要用 `std::ref`：

```cpp
void increment(int& x) { x++; }

int val = 0;
std::thread t(increment, std::ref(val));
t.join();
// val == 1
```

不加 `std::ref` 直接传 `val`，函数拿到的是拷贝，原来的 `val` 不会变。

### 获取线程 ID

```cpp
#include <thread>
#include <iostream>

void show_id() {
    std::cout << "Thread ID: " << std::this_thread::get_id() << "\n";
}

int main() {
    std::cout << "Main thread ID: " << std::this_thread::get_id() << "\n";
    std::thread t(show_id);
    t.join();
}
```

---

## 2. 数据竞争（Data Race）

### 什么是数据竞争

两个线程同时访问同一块内存，**至少一个是写操作**，且没有同步机制——这就是数据竞争，属于未定义行为（UB）。

```cpp
// 错误示范：数据竞争
int counter = 0;

void bad_increment() {
    for (int i = 0; i < 100000; i++) {
        counter++;  // 读-改-写，不是原子操作！
    }
}

int main() {
    std::thread t1(bad_increment);
    std::thread t2(bad_increment);
    t1.join();
    t2.join();
    std::cout << counter << "\n";  // 不是 200000，每次运行结果不同
}
```

`counter++` 看起来是一条语句，但实际上分三步：读取 counter → 加 1 → 写回。两个线程可能同时读到同一个值，各自加 1，最后写回的结果是少加了一次。

### 为什么数据竞争难以发现

现代 CPU 是多核的，每个核都有自己的 L1/L2 Cache。核 A 写了一个值，不会立即刷新到内存，核 B 读到的可能是它自己 Cache 里的旧值。这就是为什么数据竞争的结果是"随机的"——取决于 Cache 同步的时机，而这个时机在每次运行时都不一样。

### std::mutex

用 mutex 保护共享数据：

```cpp
#include <mutex>

int counter = 0;
std::mutex mtx;

void safe_increment() {
    for (int i = 0; i < 100000; i++) {
        mtx.lock();
        counter++;
        mtx.unlock();
    }
}
```

但手动 `lock/unlock` 很危险——如果中间抛了异常，`unlock` 不会被调用，程序死锁。

### std::lock_guard：RAII 封装

```cpp
void safe_increment() {
    for (int i = 0; i < 100000; i++) {
        std::lock_guard<std::mutex> guard(mtx);  // 构造时 lock
        counter++;
        // 离开作用域时自动 unlock，即使抛异常也没问题
    }
}
```

`lock_guard` 是零开销的 RAII 包装，构造时加锁，析构时解锁。大多数场景够用。

### std::unique_lock：更灵活

`unique_lock` 支持延迟加锁、手动解锁、转移所有权，主要用在需要配合条件变量的场景：

```cpp
std::unique_lock<std::mutex> lock(mtx);  // 构造时加锁
// ... 做一些事情
lock.unlock();  // 手动解锁
// ... 做不需要锁保护的事情
lock.lock();    // 再次加锁
```

---

## 3. std::atomic：不需要 mutex 的原子操作

### 为什么 mutex 代价高

`mutex.lock()` 在锁被占用时会让当前线程进入等待——这通常需要系统调用（用户态切换到内核态），耗时大约几微秒，是原子操作的 **10–100 倍**。对于简单的计数器递增，用 mutex 太重了。

### std::atomic 基本用法

```cpp
#include <atomic>

std::atomic<int> counter{0};

void atomic_increment() {
    for (int i = 0; i < 100000; i++) {
        counter++;           // 原子递增
        counter.fetch_add(1); // 等价写法，返回旧值
    }
}
```

`std::atomic` 利用 CPU 的硬件原语（如 x86 的 `LOCK XADD` 指令），保证操作不可分割，不需要进内核态。

### compare_exchange

CAS（Compare-And-Swap）是实现无锁数据结构的基石：

```cpp
std::atomic<int> val{0};

int expected = 0;
int desired  = 1;

// 如果 val == expected，就把 val 设为 desired，返回 true
// 否则把 expected 更新为 val 的当前值，返回 false
bool success = val.compare_exchange_strong(expected, desired);
```

CAS 失败时通常放在循环里重试：

```cpp
int old_val = val.load();
int new_val;
do {
    new_val = old_val + 1;
} while (!val.compare_exchange_weak(old_val, new_val));
// compare_exchange_weak 可能伪失败（spurious failure），但在循环中性能更好
```

---

## 4. 内存序（Memory Order）

这是并发里最烧脑的部分，但搞懂了你才算真正理解并发。

### 问题背景

CPU 和编译器都会对指令重排（reorder）以优化性能。单线程看没问题，但多线程下重排可能导致意想不到的结果：

```cpp
// 线程 1
data = 42;       // (1)
flag = true;     // (2)

// 线程 2
while (!flag) {} // (3)
use(data);       // (4)
```

从逻辑上看，线程 2 在 flag 为 true 后才读 data，应该能看到 42。但 CPU 可能把 (1) 和 (2) 重排，线程 2 在 flag 为 true 时 data 还没写入。内存序就是控制这种可见性的机制。

### 六种内存序

| 内存序 | 含义 |
|--------|------|
| `memory_order_relaxed` | 只保证原子性，不保证顺序 |
| `memory_order_consume` | 几乎没人用，实现复杂，跳过 |
| `memory_order_acquire` | 读操作，保证后续操作不会被重排到此前 |
| `memory_order_release` | 写操作，保证之前操作不会被重排到此后 |
| `memory_order_acq_rel` | 读-改-写操作，同时具有 acquire 和 release 语义 |
| `memory_order_seq_cst` | 全局顺序，最强保证，默认值 |

### 实践：acquire/release 建立 happens-before

```cpp
std::atomic<bool> flag{false};
int data = 0;

// 线程 1（生产者）
data = 42;
flag.store(true, std::memory_order_release);  // release：之前的写不会被排到这之后

// 线程 2（消费者）
while (!flag.load(std::memory_order_acquire)) {} // acquire：之后的读不会被排到这之前
assert(data == 42);  // 一定能看到 42
```

`release` 保证 `data = 42` 发生在 `flag.store` 之前；`acquire` 保证 `flag.load` 成功后，后续对 data 的读能看到 release 之前的所有写入。这就建立了 **happens-before** 关系。

### relaxed：只要原子性

```cpp
std::atomic<int> counter{0};

// 只需要计数准确，不关心顺序
counter.fetch_add(1, std::memory_order_relaxed);
```

多线程计数器经典用法。不涉及其他共享数据，用 relaxed 性能最好。

### 实践建议

**不确定的时候用默认的 `seq_cst`**，它是最安全的。性能分析确认 atomic 操作是瓶颈后，再考虑换 relaxed 或 acquire/release。过早优化内存序是很多并发 bug 的来源。

---

## 5. std::async 与 std::future

有时候你想异步执行一个任务，不关心内部线程管理，只要能拿到结果——这是 `std::async` 的用武之地。

```cpp
#include <future>
#include <iostream>

int heavy_compute(int n) {
    // 模拟耗时计算
    return n * n;
}

int main() {
    // 异步启动，返回 future
    std::future<int> fut = std::async(std::launch::async, heavy_compute, 10);

    // 主线程继续做其他事情
    std::cout << "Computing...\n";

    // 需要结果时阻塞等待
    int result = fut.get();  // 类似 cudaStreamSynchronize
    std::cout << "Result: " << result << "\n";
}
```

`std::launch::async` 强制在新线程中运行（不加这个参数，实现可以选择延迟执行）。

### promise/future 配对传值

有时候你需要在一个线程里设置值，在另一个线程里等待它：

```cpp
std::promise<int> prom;
std::future<int> fut = prom.get_future();

std::thread producer([&prom]() {
    // 做一些计算
    prom.set_value(42);  // 设置值，唤醒等待的线程
});

int val = fut.get();  // 阻塞，直到 set_value 被调用
producer.join();
```

---

## 6. 线程池：为什么频繁创建线程代价高

创建一个线程需要：分配栈空间（默认 8MB）、初始化线程状态、系统调用……整个过程大约需要几十到上百微秒。如果每个任务都创建销毁线程，开销会超过任务本身。

线程池的思路：提前创建固定数量的线程，通过任务队列分发工作：

```cpp
#include <thread>
#include <queue>
#include <mutex>
#include <condition_variable>
#include <functional>
#include <vector>

class ThreadPool {
public:
    ThreadPool(size_t num_threads) {
        for (size_t i = 0; i < num_threads; i++) {
            workers.emplace_back([this] {
                while (true) {
                    std::function<void()> task;
                    {
                        std::unique_lock<std::mutex> lock(queue_mutex);
                        condition.wait(lock, [this] {
                            return !tasks.empty() || stop;
                        });
                        if (stop && tasks.empty()) return;
                        task = std::move(tasks.front());
                        tasks.pop();
                    }
                    task();
                }
            });
        }
    }

    void enqueue(std::function<void()> task) {
        {
            std::lock_guard<std::mutex> lock(queue_mutex);
            tasks.push(std::move(task));
        }
        condition.notify_one();
    }

    ~ThreadPool() {
        {
            std::lock_guard<std::mutex> lock(queue_mutex);
            stop = true;
        }
        condition.notify_all();
        for (auto& t : workers) t.join();
    }

private:
    std::vector<std::thread> workers;
    std::queue<std::function<void()>> tasks;
    std::mutex queue_mutex;
    std::condition_variable condition;
    bool stop = false;
};
```

使用：

```cpp
ThreadPool pool(4);  // 4 个工作线程

for (int i = 0; i < 100; i++) {
    pool.enqueue([i] {
        // 处理第 i 个任务
    });
}
// ThreadPool 析构时等待所有任务完成
```

---

## 7. 和 CUDA 的对应关系

搞 AI Infra 的同学，理解这些 CPU 并发概念后，可以直接对应到 CUDA：

| CPU 概念 | CUDA 对应 |
|----------|-----------|
| `std::thread` | CUDA stream（GPU 上的执行队列） |
| `thread.join()` / `future.get()` | `cudaStreamSynchronize()` |
| `std::mutex` | `atomicCAS` 实现的 GPU 锁（一般避免用） |
| `std::atomic<int>` | `atomicAdd`、`atomicCAS` 等内置函数 |
| 线程池 | CUDA stream pool（复用 stream 避免创建销毁开销） |

### 典型 AI Infra 场景

```
CPU 线程 1 ──── 准备 batch 数据 ──── cudaMemcpyAsync ────┐
CPU 线程 2 ──── 准备 batch 数据 ──── cudaMemcpyAsync ────┤  GPU stream 0
                                                          ├──────────────── kernel 执行
CPU 线程 3 ──── 后处理上一个 batch 结果                   │
                                                          └── cudaStreamSynchronize
```

CPU 端用线程池并行准备数据，GPU 端用多个 stream 重叠传输和计算。`cudaStreamSynchronize` 就是 `future.get()`——阻塞等待 GPU 端完成。

### CUDA 的内存序问题

GPU 同样有 Cache 一致性问题，`atomicAdd` 在 GPU 端对应 `std::atomic::fetch_add`。但 GPU 上的 atomic 操作因为线程数极多，竞争激烈时会成为严重瓶颈（所有 warp 串行执行 atomic）。常见优化：warp 内先 reduce（`__reduce_add_sync`），再做一次 atomic。

---

## 小结

| 工具 | 适用场景 | 代价 |
|------|----------|------|
| `std::mutex` + `lock_guard` | 保护复杂共享状态 | 高（可能进内核态） |
| `std::atomic` + `seq_cst` | 简单计数器、标志位 | 低（硬件原语） |
| `std::atomic` + `relaxed` | 纯计数，不需要顺序保证 | 最低 |
| `std::atomic` + `acquire/release` | 生产者-消费者同步 | 低 |
| `std::async` / `std::future` | 异步任务，需要等结果 | 中（创建线程） |
| 线程池 | 大量短任务 | 低（复用线程） |

并发代码的最大敌人是隐式假设——"这个操作肯定是原子的""这个值肯定已经更新了"。养成习惯：有共享数据就想保护机制，有顺序依赖就想内存序。

下一篇会讲 `std::condition_variable` 和更复杂的同步模式，以及 AI Infra 里常见的生产者-消费者队列实现。
