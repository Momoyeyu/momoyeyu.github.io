---
title: C++ 数据布局 AoS vs SoA
date: 2023-09-12
description: 'Array of Structs 与 Struct of Arrays 的内存访问模式差异，以及对 SIMD 和 CUDA 性能的影响。'
tags: [C++, 性能, AI Infra]
category: C++ 进阶
episode: 9
draft: false
lang: 'zh_CN'
---

在 AI Infra 和 CUDA 开发里，数据布局（data layout）是一个高频考点，也是真正决定性能上限的底层问题。面试时问你"AoS 和 SoA 有什么区别"，不是考你背定义，而是考你有没有真正理解内存访问模式。

这篇文章从 CPU 缓存原理讲起，一路聊到 GPU warp coalescing，争取让你彻底搞清楚这件事。

---

## 先搞懂 CPU 是怎么读内存的

CPU 和内存之间的速度差距是巨大的——现代 CPU 一个时钟周期能执行几条指令，但访问一次主存要 ~100ns，相当于几百个时钟周期。所以 CPU 引入了多级缓存（L1/L2/L3），但缓存空间有限，关键在于**如何高效利用缓存**。

CPU 读取内存时，不是按字节或按 int 来读，而是以 **cache line** 为单位加载，每次加载 **64 字节**。这个 64 字节不是随机定的，是根据 DRAM 的 burst 传输长度设计的——DRAM 的内部结构使得连续地址的访问速度远快于随机访问，64 字节正好能摊平一次 DRAM row activation 的开销。

```
内存地址空间（示意）：
[  0 ~  63]  ← cache line 0
[ 64 ~ 127]  ← cache line 1
[128 ~ 191]  ← cache line 2
...
```

**结论：如果你访问的数据在内存上连续，加载一次 cache line 就能处理多个元素，效率极高；如果数据分散，每次访问都要重新加载一个 cache line，cache miss 拖垮性能。**

---

## AoS：Array of Structs

最直觉的写法：

```cpp
struct Particle {
    float x, y, z, w;  // 4 × 4 = 16 字节
};

Particle particles[N];
```

内存里长这样：

```
[x0 y0 z0 w0 | x1 y1 z1 w1 | x2 y2 z2 w2 | x3 y3 z3 w3 | ...]
 ^---- 16B --^  ^---- 16B --^
```

一个 cache line 64 字节，正好放 4 个 Particle：

```
cache line: [x0 y0 z0 w0 | x1 y1 z1 w1 | x2 y2 z2 w2 | x3 y3 z3 w3]
```

看起来不错？现在考虑一个典型操作：**对所有粒子的 x 坐标做统一更新**（比如物理模拟里更新位置）：

```cpp
for (int i = 0; i < N; i++) {
    particles[i].x += vx[i] * dt;
}
```

每次访问 `particles[i].x`，CPU 加载一整个 cache line（64 字节 = 4 个 particle），但这一轮循环**只用到了 x 字段**，其他 y/z/w 全是浪费。

**cache line 利用率：**
- 每个 Particle 16 字节，`x` 字段 4 字节
- 一个 cache line 装 4 个 Particle，有效数据只有 4 个 `x` = 16 字节
- **利用率 = 16 / 64 = 25%**

也就是说，75% 的内存带宽被浪费了。在大规模数据处理（N = 百万量级）时，这个浪费会直接导致程序跑满内存带宽上限，而算力却闲着。

---

## SoA：Struct of Arrays

把布局翻转过来：

```cpp
struct Particles {
    float x[N];
    float y[N];
    float z[N];
    float w[N];
};

Particles particles;
```

内存里长这样：

```
x: [x0 x1 x2 x3 x4 x5 x6 x7 x8 x9 x10 x11 x12 x13 x14 x15 ...]
y: [y0 y1 y2 y3 y4 y5 y6 y7 y8 y9 ...]
z: [z0 z1 z2 z3 ...]
w: [w0 w1 w2 w3 ...]
```

同样的操作，更新所有 x 坐标：

```cpp
for (int i = 0; i < N; i++) {
    particles.x[i] += vx[i] * dt;
}
```

现在 `particles.x[i]` 是连续地址，加载一个 cache line（64 字节 = 16 个 float），16 个元素全都是有效的 `x` 值，**利用率 100%**。

更爽的是，这个访问模式对 **SIMD** 极度友好。AVX2 的 `_mm256_load_ps` 一次加载 8 个 float，正好对应连续内存：

```cpp
// SIMD 版本（AVX2）
for (int i = 0; i < N; i += 8) {
    __m256 vx_vec = _mm256_load_ps(&particles.x[i]);
    __m256 dt_vec = _mm256_set1_ps(dt);
    __m256 vel    = _mm256_load_ps(&vx[i]);
    vx_vec = _mm256_fmadd_ps(vel, dt_vec, vx_vec);  // x += vx * dt
    _mm256_store_ps(&particles.x[i], vx_vec);
}
```

AoS 下，`x` 坐标之间有 12 字节的间隔（y/z/w），SIMD gather 指令虽然能做，但效率远不如连续加载。

---

## CUDA 里的 Warp Coalescing

GPU 的情况更极端。CUDA 中，**warp** 是调度的基本单元，一个 warp 包含 32 个 thread，这 32 个 thread 在同一时刻执行同一条指令（SIMT 模型）。

当 warp 里的 32 个 thread 发起内存访问时，硬件会尝试把这些访问**合并（coalesce）**成尽量少的内存事务。关键数学：

```
32 threads × 4 bytes (float) = 128 bytes
```

GPU 的全局内存事务最小单元正好是 **128 字节**（对应一个 cache line sector 的大小）。如果 warp 里的 thread 访问的是连续地址，硬件一次事务搞定，perfect coalescing。

**AoS 场景（kernel 只访问 x）：**

```cpp
// AoS CUDA kernel
__global__ void update_x(Particle* particles, float* vx, float dt, int N) {
    int tid = blockIdx.x * blockDim.x + threadIdx.x;
    if (tid < N) {
        particles[tid].x += vx[tid] * dt;  // strided access!
    }
}
```

Thread 0 访问 `particles[0].x`（地址 0），Thread 1 访问 `particles[1].x`（地址 16），Thread 2 访问 `particles[2].x`（地址 32）……

这 32 个地址跨度是：`31 × 16 = 496 字节`，横跨 `⌈496/128⌉ = 4` 个内存事务（实际还要考虑对齐，可能更多）。而且每个事务里只有 1/4 的数据是有用的（其他是 y/z/w）。

**SoA 场景：**

```cpp
// SoA CUDA kernel
__global__ void update_x(float* x, float* vx, float dt, int N) {
    int tid = blockIdx.x * blockDim.x + threadIdx.x;
    if (tid < N) {
        x[tid] += vx[tid] * dt;  // coalesced!
    }
}
```

Thread 0 访问 `x[0]`，Thread 1 访问 `x[1]`……32 个连续地址，正好 128 字节，**1 次事务搞定**，全部数据有效。

性能差距：strided access 可以比 coalesced access 慢 **20~32 倍**，这不是夸张，是实测数据。

---

## 基准测试：CPU 端 AoS vs SoA

下面是一个可以直接运行的测试，用 `std::chrono` 计时，N = 1600 万：

```cpp
#include <iostream>
#include <chrono>
#include <numeric>
#include <vector>
#include <random>

constexpr int N = 1 << 24;  // 16M elements

// AoS
struct ParticleAoS {
    float x, y, z, w;
};

// SoA
struct ParticlesSoA {
    std::vector<float> x, y, z, w;
    ParticlesSoA(int n) : x(n), y(n), z(n), w(n) {}
};

int main() {
    std::mt19937 rng(42);
    std::uniform_real_distribution<float> dist(0.0f, 1.0f);

    // 初始化 AoS
    std::vector<ParticleAoS> aos(N);
    for (auto& p : aos) {
        p.x = dist(rng); p.y = dist(rng);
        p.z = dist(rng); p.w = dist(rng);
    }

    // 初始化 SoA
    ParticlesSoA soa(N);
    for (int i = 0; i < N; i++) {
        soa.x[i] = dist(rng); soa.y[i] = dist(rng);
        soa.z[i] = dist(rng); soa.w[i] = dist(rng);
    }

    // 测试 AoS：对所有 x 求和
    {
        auto t0 = std::chrono::high_resolution_clock::now();
        float sum = 0.0f;
        for (int i = 0; i < N; i++) {
            sum += aos[i].x;
        }
        auto t1 = std::chrono::high_resolution_clock::now();
        double ms = std::chrono::duration<double, std::milli>(t1 - t0).count();
        std::cout << "AoS sum x: " << sum
                  << "  time: " << ms << " ms\n";
    }

    // 测试 SoA：对所有 x 求和
    {
        auto t0 = std::chrono::high_resolution_clock::now();
        float sum = 0.0f;
        for (int i = 0; i < N; i++) {
            sum += soa.x[i];
        }
        auto t1 = std::chrono::high_resolution_clock::now();
        double ms = std::chrono::duration<double, std::milli>(t1 - t0).count();
        std::cout << "SoA sum x: " << sum
                  << "  time: " << ms << " ms\n";
    }

    return 0;
}
```

编译和运行：

```bash
g++ -O2 -o bench bench.cpp && ./bench
```

在典型硬件上，SoA 版本会快 **2~4 倍**。如果关掉编译器优化（`-O0`），差距更明显，因为编译器会在 `-O2` 下做一些自动向量化，但即使如此，内存带宽的利用率差异依然显著。

> [!TIP]
> 如果想看更极端的差距，把 N 调大到 `1 << 26`（64M），这时数据集远超 L3 缓存，内存带宽成为真正的瓶颈。

---

## 什么时候用 AoS，什么时候用 SoA

| 场景 | 推荐布局 | 原因 |
|------|----------|------|
| 处理单个对象的全部属性 | AoS | 所有字段在一个 cache line，局部性好 |
| 批量处理所有对象的同一属性 | SoA | 连续访问，cache/SIMD/warp 友好 |
| CUDA kernel（大多数情况） | SoA | coalesced access，性能决定性的差距 |
| 小规模数据（能完全 fit 进 L1） | 无所谓 | 差距可以忽略 |
| 面向对象设计，逻辑清晰优先 | AoS | 可读性更好，性能不是瓶颈时合理选择 |

---

## 进阶：AoSoA（Array of Struct of Arrays）

有一种折中方案叫 **AoSoA**，也叫 Tiled SoA，适合对齐 SIMD 宽度：

```cpp
// AoSoA，tile size = 8（对应 AVX2 的 8 × float）
struct ParticleTile {
    float x[8];
    float y[8];
    float z[8];
    float w[8];
};  // 128 字节，正好 2 个 cache line

ParticleTile tiles[N / 8];
```

访问 tile 内的 x 坐标时，8 个 float 完全连续，AVX2 无需任何 gather，直接 `_mm256_load_ps`。tile 之间跳跃的步长是 128 字节（固定的，可预测），prefetcher 能轻松处理。

这种布局在 ML framework 的 kernel 实现里非常常见，比如 oneDNN 对 NCHW 张量的某些优化 layout（nChw8c、nChw16c）本质上就是 AoSoA 思路：外层是 N×C_tile×H×W，内层是连续的 8 或 16 个 channel。

---

## 小结

- **Cache line 是 64 字节**，CPU 每次加载内存以此为单位；数据连续则利用率高，数据分散则带宽大量浪费
- **AoS** 对单对象完整访问友好，对批量单字段访问不友好（利用率 field_size / struct_size）
- **SoA** 对批量单字段访问友好，cache 利用率 100%，SIMD 和 CUDA warp coalescing 天然对齐
- **CUDA warp coalescing 的数学**：32 thread × 4 byte = 128 byte，正好等于 GPU 最小内存事务单元；SoA 一次搞定，AoS strided 需要多次，慢 20~32 倍
- **AoSoA** 是折中方案，在 SIMD 宽度（8/16）的粒度上做 SoA，兼顾逻辑分组和访问效率

在 AI Infra 工作里，模型训练和推理的 kernel 绝大多数是批量处理同一字段（权重、激活值），所以 SoA 或 AoSoA 是默认的正确选择。理解这一层，是从"会写 CUDA"到"能写高性能 CUDA"的必经之路。
