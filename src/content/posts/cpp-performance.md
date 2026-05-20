---
title: C++ 性能优化
published: 2024-10-22
description: 'std::chrono 计时、Benchmarking 方法论、内存分配追踪，以及 CLion Profiler 的使用。'
tags: [C++, 性能, AI Infra]
category: C++ 进阶
episode: 21
draft: false
lang: 'zh_CN'
---

AI Infra 工程师的日常，有很大一部分是在和"为什么这段代码这么慢"较劲。GPU 利用率上不去？先看看 CPU 端的数据预处理是不是瓶颈。模型推理延迟高？先量一量各个阶段的耗时。性能意识不是锦上添花，是这个领域的核心素养。

这篇文章覆盖 C++ 性能分析的常用工具和方法论：从最基础的 `std::chrono` 计时，到 Benchmarking 的坑，再到内存分配追踪和 CLion Profiler 的使用。

---

## 1. std::chrono 计时

最直接的性能分析方式就是在代码里插计时点。C++11 引入的 `std::chrono` 提供了高精度时钟，基本用法如下：

```cpp
#include <chrono>
#include <iostream>

auto start = std::chrono::high_resolution_clock::now();

// ... 被测代码 ...

auto end = std::chrono::high_resolution_clock::now();
auto duration = std::chrono::duration_cast<std::chrono::microseconds>(end - start);
std::cout << "耗时: " << duration.count() << " us\n";
```

`high_resolution_clock` 在大多数平台上对应系统最高精度的时钟，通常达到纳秒级分辨率，用于微秒级计时绰绰有余。

### RAII Timer：优雅的计时封装

每次手动写 start/end 很麻烦，而且容易在中途 return 或抛异常时漏掉计时。RAII 模式完美解决这个问题——构造时记录开始时间，析构时自动打印耗时：

```cpp
#include <chrono>
#include <iostream>
#include <string>

class Timer {
public:
    explicit Timer(const std::string& name = "")
        : m_name(name),
          m_start(std::chrono::high_resolution_clock::now()) {}

    ~Timer() {
        auto end = std::chrono::high_resolution_clock::now();
        auto duration = std::chrono::duration_cast<std::chrono::microseconds>(
            end - m_start);
        std::cout << "[Timer] " << m_name << " took "
                  << duration.count() << " us\n";
    }

    // 禁止拷贝，避免误用
    Timer(const Timer&) = delete;
    Timer& operator=(const Timer&) = delete;

private:
    std::string m_name;
    std::chrono::time_point<std::chrono::high_resolution_clock> m_start;
};
```

用起来极其简洁：

```cpp
void preprocess_batch(const std::vector<float>& data) {
    Timer t("preprocess_batch");
    // ... 数据预处理逻辑 ...
    // 函数返回时，t 析构，自动打印耗时
}
```

在 AI Infra 场景下，这个 Timer 特别适合快速定位 CPU 端 pipeline 中的热点。比如你发现 GPU 利用率只有 60%，大概率是 CPU 端的数据加载、tokenization 或者 tensor 构建在拖后腿，在各个阶段加 Timer 是第一步。

---

## 2. Benchmarking 方法论：别让编译器骗了你

微基准测试（microbenchmark）是个坑多的领域。你以为你在测某个函数的性能，实际上编译器可能已经把它整个删掉了。

### 陷阱一：编译器优化掉"无用"代码

看这个例子：

```cpp
#include <chrono>
#include <iostream>
#include <cmath>

void bad_benchmark() {
    auto start = std::chrono::high_resolution_clock::now();

    // 编译器发现 result 从未被使用，直接删掉整个循环！
    double result = 0.0;
    for (int i = 0; i < 1000000; ++i) {
        result += std::sqrt(static_cast<double>(i));
    }

    auto end = std::chrono::high_resolution_clock::now();
    auto us = std::chrono::duration_cast<std::chrono::microseconds>(end - start);
    std::cout << "耗时: " << us.count() << " us\n";  // 可能输出 0 us
}
```

开启 `-O2` 或 `-O3` 后，编译器分析出 `result` 的计算结果从未被使用，直接把整个循环删掉。你量到的是 0 微秒——完全虚假的结果。

**解决方案一：把结果输出出去**

```cpp
double result = 0.0;
for (int i = 0; i < 1000000; ++i) {
    result += std::sqrt(static_cast<double>(i));
}
// 让编译器认为 result 是"有用"的
std::cout << result << "\n";
```

**解决方案二：`volatile`**

```cpp
volatile double result = 0.0;
for (int i = 0; i < 1000000; ++i) {
    result += std::sqrt(static_cast<double>(i));
}
```

`volatile` 告诉编译器这个变量可能被外部修改或观察，不能随意优化掉对它的读写。注意 `volatile` 会带来一定开销（每次都强制内存访问），所以测量结果会偏慢，但至少不会被删掉。

**解决方案三：Google Benchmark 的 `DoNotOptimize`**

如果项目已经用了 Google Benchmark，用它提供的工具最为精确：

```cpp
#include <benchmark/benchmark.h>
#include <cmath>

static void BM_SqrtLoop(benchmark::State& state) {
    for (auto _ : state) {
        double result = 0.0;
        for (int i = 0; i < 1000000; ++i) {
            result += std::sqrt(static_cast<double>(i));
        }
        benchmark::DoNotOptimize(result);  // 防止结果被优化掉
    }
}
BENCHMARK(BM_SqrtLoop);
BENCHMARK_MAIN();
```

`DoNotOptimize` 的底层实现是通过内联汇编或 `volatile` 指针，让编译器认为这个值会被外部读取，从而保留计算。

### 陷阱二：CPU 频率调节

现代 CPU 有动态频率调节（Intel Turbo Boost / AMD Precision Boost）。冷启动时 CPU 可能在低频状态，跑几轮之后才升到峰值频率。如果你只跑一次，前几次的结果会偏慢。

**解决方案：Warm-up + 多次运行取平均**

```cpp
#include <chrono>
#include <iostream>
#include <vector>
#include <numeric>
#include <algorithm>

template<typename Func>
void benchmark(const std::string& name, Func f,
               int warmup_rounds = 5, int measure_rounds = 20) {
    // Warm-up 阶段：让 CPU 升频，填热 cache
    for (int i = 0; i < warmup_rounds; ++i) {
        f();
    }

    // 正式测量
    std::vector<long long> times;
    times.reserve(measure_rounds);

    for (int i = 0; i < measure_rounds; ++i) {
        auto start = std::chrono::high_resolution_clock::now();
        f();
        auto end = std::chrono::high_resolution_clock::now();
        times.push_back(
            std::chrono::duration_cast<std::chrono::microseconds>(end - start).count());
    }

    // 统计
    long long sum = std::accumulate(times.begin(), times.end(), 0LL);
    long long avg = sum / measure_rounds;
    long long min_t = *std::min_element(times.begin(), times.end());
    long long max_t = *std::max_element(times.begin(), times.end());

    std::cout << "[Benchmark] " << name << "\n"
              << "  avg=" << avg << " us"
              << "  min=" << min_t << " us"
              << "  max=" << max_t << " us\n";
}
```

### 陷阱三：Cache 冷热效应

第一次访问某块内存，数据不在 cache 里（cache miss），会比后续访问慢很多。如果你的基准测试每次都访问全新的内存，测到的是"冷 cache"性能；如果反复测同一块数据，测到的是"热 cache"性能。两者差距可能有数倍。

搞清楚你的真实场景是冷是热，然后让基准测试匹配它。

---

## 3. 内存分配追踪

频繁的堆内存分配（`malloc`/`free`，`new`/`delete`）是性能杀手。每次分配都可能涉及锁竞争（多线程场景）、系统调用，以及 TLB/cache 污染。在 AI Infra 的热路径（hot path）上——比如每处理一个 token 就 `new` 一个对象——很容易把吞吐量打下去。

### 重载全局 `operator new` 追踪分配

重载全局 `operator new` / `operator delete` 是零依赖的追踪手段，适合在代码审查阶段快速验证某段逻辑是否存在意料之外的堆分配。完整实现见 [内存模型：栈、堆与内存对齐](/posts/cpp-memory-model/)。

基本用法如下——先让追踪器就位，然后在被测代码前后调用 `reset()` 和 `print()`：

```cpp
// 假设 g_stats 和重载的 operator new/delete 已在翻译单元顶部定义
g_stats.reset();

std::vector<std::string> words;
for (int i = 0; i < 1000; ++i) {
    words.push_back("hello world this is a longer string");
}

g_stats.print();
// 输出类似：[AllocStats] allocs=11  bytes=36864  deallocs=0
// vector 扩容触发若干次 realloc，每个长字符串各触发一次堆分配
```

这个方法立竿见影，缺点是无法精确定位分配发生在哪一行，适合"有没有"的判断，不适合"在哪里"的定位。

### 工具链

- **Valgrind Massif**（Linux）：`valgrind --tool=massif --pages-as-heap=yes ./your_app`，生成详细的内存分配时间线，`ms_print` 可视化。
- **CLion Memory Profiler**：图形界面，在下文介绍。
- **Heaptrack**（Linux）：比 Massif 更现代，开销更低，支持火焰图。
- **Instruments Allocations**（macOS）：Xcode 自带，可以看每个分配的调用栈。

---

## 4. 小字符串优化（SSO）

说到内存分配，有一个 C++ 标准库的经典优化值得专门拿出来讲——`std::string` 的 Small String Optimization（SSO）。

`std::string` 内部维护一个 buffer。当字符串足够短时，直接把字符存在 `string` 对象自身的内存里（栈或者对象内部），完全不需要堆分配。只有字符串超过某个阈值，才会走 `malloc`。

阈值因实现而异：
- **GCC libstdc++**：15 字节（不含终止符 `\0`）
- **Clang libc++**：22 字节（不含终止符）
- **MSVC STL**：15 字节

可以用我们上面的分配追踪代码来验证：

```cpp
int main() {
    // 测试短字符串
    g_stats.reset();
    {
        std::string s1 = "hello";          // 5 字节，SSO
        std::string s2 = "hello world!!"; // 13 字节，SSO（GCC）
    }
    std::cout << "短字符串: ";
    g_stats.print();  // allocs=0，没有堆分配！

    // 测试长字符串
    g_stats.reset();
    {
        std::string s3 = "this string is definitely longer than 15 bytes";
    }
    std::cout << "长字符串: ";
    g_stats.print();  // allocs=1，发生了堆分配
}
```

也可以通过比较 `sizeof(std::string)` 和实际容量来推断 SSO buffer 大小：

```cpp
#include <iostream>
#include <string>

int main() {
    std::cout << "sizeof(std::string) = " << sizeof(std::string) << "\n";

    // 逐步增加长度，找到触发堆分配的临界点
    for (int len = 10; len <= 30; ++len) {
        g_stats.reset();
        std::string s(len, 'x');
        if (g_stats.alloc_count > 0) {
            std::cout << "SSO 阈值：" << len - 1 << " 字节\n";
            break;
        }
    }
}
```

**对 AI Infra 的实际意义**：如果你在处理 tokenization 时大量创建短字符串（比如词表里的 token 大多是几个字符），SSO 会自动帮你避免堆分配开销。但一旦某些 token 超过阈值，就会触发分配。如果量大，考虑用 `std::string_view`（零拷贝视图）替代。

---

## 5. CLion Profiler

CLion 内置了 CPU Profiler 和 Memory Profiler，对于日常开发来说够用，不用切到命令行工具。

### CPU Profiler

在 CLion 里，Run → Profile（或者工具栏上的小火焰图标）启动 CPU Profiler。有两种模式：

- **Sampling 模式**：以固定时间间隔采样调用栈，开销低（通常 <5%），适合生产性能分析。缺点是低频调用的函数可能采不到。
- **Instrumentation 模式**：在每个函数入口/出口插桩，精确统计每个函数的调用次数和耗时，但开销较大（可能 10x 以上），适合分析具体函数的行为。

Profiler 跑完之后，关注以下几个视图：
- **Call Tree / Flame Graph**：横向越宽说明耗时越长，从顶层往下找"宽"的调用。
- **Hot Methods**：按耗时排序的函数列表，直接找 Top 10 的热点函数。
- **Back Traces**：某个函数是被谁调用的，帮助理解调用路径。

### Memory Profiler

Memory Profiler 追踪堆分配，展示：
- 哪行代码分配了多少内存
- 内存的生命周期（分配到释放的时间段）
- 未释放的内存（潜在泄漏）

启动方式：Run → Profile with Memory Profiler。分析完成后，"Allocations" 视图按分配次数和大小排序，可以直接跳转到分配发生的源代码位置。

### AI Infra 扩展工具链

CLion Profiler 适合分析纯 CPU 端的代码。如果你需要分析 CPU-GPU 交互（比如 CUDA kernel 的启动延迟、数据搬运开销、CPU 等待 GPU 同步的时间），需要用 NVIDIA 的工具：

- **NSight Systems**：系统级 profiler，可以同时看 CPU 时间线和 GPU 时间线，找 CPU-GPU 交互的瓶颈。命令行：`nsys profile --stats=true ./your_app`
- **NSight Compute**：针对单个 CUDA kernel 的深度分析，看 warp occupancy、memory bandwidth、指令吞吐等。

在 macOS 上，CPU 端 profiling 推荐用 **Instruments**（Xcode 自带）：Time Profiler 模式对应 Sampling，Allocations 模式对应内存追踪，界面比 CLion 更强大。

Linux 上，`perf` 是瑞士军刀：

```bash
# 采样 CPU 时间
perf record -g ./your_app
perf report

# 看 cache miss
perf stat -e cache-misses,cache-references ./your_app
```

---

## 6. 常见优化思路

找到热点之后，怎么优化？以下是几个高频场景：

### 减少内存分配

**预分配**：如果知道大概需要多少元素，提前 `reserve`：

```cpp
std::vector<float> features;
features.reserve(batch_size * feature_dim);  // 避免多次扩容 realloc
```

**对象池（Object Pool）**：避免在热路径上反复 new/delete，预先分配一批对象，用完归还：

```cpp
template<typename T, size_t PoolSize = 1024>
class ObjectPool {
    std::array<T, PoolSize> m_storage;
    std::vector<T*> m_free;
public:
    ObjectPool() {
        m_free.reserve(PoolSize);
        for (auto& obj : m_storage) m_free.push_back(&obj);
    }
    T* acquire() {
        if (m_free.empty()) return new T{};  // fallback
        T* p = m_free.back(); m_free.pop_back();
        return p;
    }
    void release(T* p) { m_free.push_back(p); }
};
```

### 改善 Cache Locality

CPU cache line 通常是 64 字节。访问内存的模式是否连续，对性能影响极大。

**AoS vs SoA**：Array of Structures vs Structure of Arrays。

```cpp
// AoS：对单个粒子的全属性访问友好，但批量处理 x 坐标时跨步大
struct Particle { float x, y, z, mass; };
std::vector<Particle> particles_aos;

// SoA：批量处理 x 坐标时是连续内存，SIMD 友好，cache 命中率高
struct ParticlesSoA {
    std::vector<float> x, y, z, mass;
};
```

在 AI Infra 的数据预处理场景（比如批量归一化一个 feature 列），SoA 的 cache 命中率明显更高。

### 减少虚函数调用

虚函数调用需要通过 vtable 间接寻址，阻碍内联，对分支预测不友好。在性能极敏感的热路径上，考虑：
- 用模板 + CRTP 静态多态替代运行时多态
- 把同类型的对象放在一起处理（避免 vtable 频繁跳转）

### 避免不必要的拷贝

```cpp
// 错误：每次调用都拷贝一个 vector
void process(std::vector<float> data);

// 正确：传引用，不拷贝
void process(const std::vector<float>& data);

// 如果需要持有所有权：移动语义
void process(std::vector<float>&& data);

// 返回局部对象：RVO/NRVO 通常会自动优化，但显式 std::move 不会更快（反而可能阻止 RVO）
std::vector<float> make_data() {
    std::vector<float> result;
    // ...
    return result;  // 编译器会用 NRVO，不要 return std::move(result)
}
```

---

## 小结

性能优化的正确顺序是：**先量，再优化，再验证**。不要凭感觉猜热点，先用 Timer / Profiler 找到真正的瓶颈，再针对性地优化，最后用量化数据确认优化有效。

对于 AI Infra 工程师，CPU 端的优化往往不是终点，而是为了让 GPU 不空转——让数据预处理跟上 GPU 的消费速度，才是真正提升端到端吞吐的关键。

工具总结：
| 场景 | 工具 |
|------|------|
| 快速计时 | `std::chrono` + RAII Timer |
| 微基准测试 | Google Benchmark |
| CPU Profiling（开发阶段） | CLion CPU Profiler / Instruments (macOS) / perf (Linux) |
| 内存分配追踪 | 重载 `operator new` / CLion Memory Profiler / Heaptrack |
| CPU-GPU 交互分析 | NSight Systems |
| CUDA Kernel 分析 | NSight Compute |
