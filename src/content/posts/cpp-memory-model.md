---
title: C++ 内存模型
published: 2023-05-15
description: '深入理解栈和堆的底层机制、内存对齐的规则，以及追踪内存分配的技巧。'
tags: [C++, 内存, 性能]
category: C++ 进阶
episode: 2
draft: false
lang: 'zh_CN'
---

写 AI Infra 或者 CUDA kernel 的时候，内存管理是绕不开的话题。GPU 显存贵、CPU 内存带宽有限，一个不对齐的访问就能让性能掉一半。这篇文章从 CPU 侧的内存模型出发，搞清楚栈和堆在底层到底是怎么运作的，再聊聊内存对齐为什么重要，最后演示如何在 C++ 里追踪每一笔内存分配。

## 程序的内存全貌

一个运行中的进程，地址空间大致长这样（64-bit Linux 为例，地址从低到高）：

```
高地址
┌─────────────────────────────┐
│         Stack               │  ← 向下增长，局部变量、函数调用帧
├─────────────────────────────┤
│          ...                │  （大片未映射区域）
├─────────────────────────────┤
│         Heap                │  ← 向上增长，malloc/new 分配
├─────────────────────────────┤
│   BSS Segment               │  未初始化全局/静态变量（全零）
├─────────────────────────────┤
│   Data Segment              │  已初始化全局/静态变量
├─────────────────────────────┤
│   Text Segment              │  可执行代码（只读）
低地址
```

栈和堆从两端向中间增长，中间是一大片未映射的虚拟地址。两者碰头了就是栈溢出或堆耗尽——当然在 64-bit 地址空间里，理论上有 128 TB 可以用，一般不会真的碰。

## 栈（Stack）

### 分配的本质：一条指令

栈分配快到令人发指，原因很简单：**分配就是移动栈指针**。

在 x86-64 里，栈指针是 `RSP` 寄存器。函数进入时，编译器知道这个函数需要多少栈空间，于是直接一条指令搞定：

```asm
sub rsp, 32    ; 在栈上"分配"32字节，就这么简单
```

函数返回时：

```asm
add rsp, 32    ; "释放"栈内存，同样一条指令
```

没有系统调用，没有链表遍历，没有锁，**CPU 就是在做一次整数加减法**。这就是栈分配快的根本原因。

### 函数调用时发生了什么

调用一个函数，CPU 会：

1. 把返回地址压栈（`call` 指令隐含的操作）
2. 保存调用者的帧指针（`rbp`）
3. 移动 `rsp` 分配局部变量空间
4. 执行函数体

函数返回时逆序恢复，整个过程在纳秒级别完成。

```cpp
#include <iostream>

void foo() {
    int a = 1;   // 栈上，&a 就在当前帧里
    int b = 2;   // 紧挨着 a
    std::cout << "a @ " << &a << "\n";
    std::cout << "b @ " << &b << "\n";
    // 差值通常是 4（或者因对齐是 8）
}

int main() {
    foo();
    return 0;
}
```

你会看到 `a` 和 `b` 的地址非常接近，而且都比 `main` 的局部变量地址更低（栈向下增长）。

### 栈的限制

栈大小通常只有 **8 MB**（Linux 默认，可以用 `ulimit -s` 查看或修改）。这意味着：

- 不要在栈上分配大数组（`int arr[1000000]` 直接栈溢出）
- 递归层数过深也会溢出
- 大对象请放到堆上

生命周期由作用域决定：出了花括号，栈帧弹出，那块内存就"消失"了（实际上只是 RSP 移回去了，数据还在，只是随时可能被覆盖）。返回局部变量的指针是经典的 UB，别这样做。

## 堆（Heap）

### 分配的代价

`new` 或 `malloc` 从堆分配内存，代价比栈高得多：

1. **找空闲块**：堆内存管理器（glibc 的 ptmalloc、jemalloc 等）需要在空闲列表（free list）或 buddy system 中找到一个足够大的块
2. **处理碎片**：如果找到的块太大，需要切割，把剩余部分放回空闲列表
3. **可能触发系统调用**：堆内存不足时，需要调用 `brk()` 或 `mmap()` 向操作系统申请更多内存
4. **更新元数据**：堆管理器要记录这块内存的大小、状态等信息（通常藏在分配块头部的几个字节里）
5. **线程安全**：多线程环境下需要加锁（或使用 per-thread arena 等优化）

相比栈的一条 `sub rsp` 指令，堆分配的开销可能是它的 **几十倍甚至几百倍**。

```cpp
#include <iostream>
#include <chrono>

int main() {
    const int N = 1'000'000;

    // 测试堆分配
    auto t1 = std::chrono::high_resolution_clock::now();
    for (int i = 0; i < N; ++i) {
        int* p = new int(i);
        delete p;
    }
    auto t2 = std::chrono::high_resolution_clock::now();

    // 测试栈"分配"（编译器可能优化掉，仅作对比思路）
    auto t3 = std::chrono::high_resolution_clock::now();
    for (int i = 0; i < N; ++i) {
        int x = i;           // 栈上，函数内循环通常直接用寄存器
        (void)x;
    }
    auto t4 = std::chrono::high_resolution_clock::now();

    auto heap_ns = std::chrono::duration_cast<std::chrono::nanoseconds>(t2 - t1).count();
    auto stack_ns = std::chrono::duration_cast<std::chrono::nanoseconds>(t4 - t3).count();

    std::cout << "堆分配（百万次）: " << heap_ns / 1000 << " μs\n";
    std::cout << "栈变量（百万次）: " << stack_ns / 1000 << " μs\n";
    return 0;
}
```

### 堆的优势

堆分配慢，但它提供了栈不具备的能力：

- **生命周期完全可控**：什么时候 `delete` 你说了算
- **容量大**：可以分配几 GB 的内存（受物理内存和虚拟地址空间限制）
- **运行时决定大小**：`new int[n]`，`n` 可以是运行时变量

## 内存对齐（Memory Alignment）

### CPU 读内存的基本单元

现代 CPU 不是一个字节一个字节地读内存，而是以 **word** 为单位（通常 8 字节，即 64 位）。想象内存是一排格子，每格 8 字节，CPU 每次抓一格。

如果一个 `int`（4 字节）恰好跨了两格的边界：

```
字节地址:  0  1  2  3  4  5  6  7 | 8  9 10 11 12 13 14 15
            [        格0          ] [        格1          ]
                              [  int 跨边界了！  ]
                             ^6                 ^9
```

CPU 就必须读两次，然后拼接，性能白白损失。更糟的是，某些架构（如早期 ARM、SPARC）直接触发硬件异常（bus error）。

### 编译器的解决方案：Padding

编译器会自动在结构体成员之间插入填充字节（padding），确保每个成员都对齐到其自然对齐边界：

| 类型 | 大小 | 对齐要求（`alignof`） |
|------|------|----------------------|
| `char` | 1 | 1 |
| `short` | 2 | 2 |
| `int` | 4 | 4 |
| `float` | 4 | 4 |
| `double` | 8 | 8 |
| 指针（64-bit）| 8 | 8 |

规则是：**成员的起始地址必须是其 `alignof` 的整数倍**，而 **结构体整体的大小必须是最大成员对齐要求的整数倍**。

### 演示：字段顺序大不同

```cpp
#include <iostream>

struct Bad {
    char  a;    // 1 字节，offset 0
    // padding: 7 字节（为了让 b 对齐到 8）
    double b;   // 8 字节，offset 8
    char  c;    // 1 字节，offset 16
    // padding: 3 字节（为了让 d 对齐到 4）
    int   d;    // 4 字节，offset 20
    // padding: 4 字节（结构体大小需是 8 的倍数）
};              // sizeof(Bad) = 32

struct Good {
    double b;   // 8 字节，offset 0
    int    d;   // 4 字节，offset 8
    char   a;   // 1 字节，offset 12
    char   c;   // 1 字节，offset 13
    // padding: 2 字节（结构体大小需是 8 的倍数）
};              // sizeof(Good) = 16

int main() {
    std::cout << "sizeof(Bad)  = " << sizeof(Bad)  << "\n";  // 32
    std::cout << "sizeof(Good) = " << sizeof(Good) << "\n";  // 16

    std::cout << "\nBad 各成员 offset:\n";
    Bad bobj{};
    std::cout << "  a: " << (char*)&bobj.a - (char*)&bobj << "\n";  // 0
    std::cout << "  b: " << (char*)&bobj.b - (char*)&bobj << "\n";  // 8
    std::cout << "  c: " << (char*)&bobj.c - (char*)&bobj << "\n";  // 16
    std::cout << "  d: " << (char*)&bobj.d - (char*)&bobj << "\n";  // 20

    std::cout << "\nGood 各成员 offset:\n";
    Good gobj{};
    std::cout << "  b: " << (char*)&gobj.b - (char*)&gobj << "\n";  // 0
    std::cout << "  d: " << (char*)&gobj.d - (char*)&gobj << "\n";  // 8
    std::cout << "  a: " << (char*)&gobj.a - (char*)&gobj << "\n";  // 12
    std::cout << "  c: " << (char*)&gobj.c - (char*)&gobj << "\n";  // 13

    return 0;
}
```

输出：

```
sizeof(Bad)  = 32
sizeof(Good) = 16

Bad 各成员 offset:
  a: 0
  b: 8
  c: 16
  d: 20

Good 各成员 offset:
  b: 0
  d: 8
  a: 12
  c: 13
```

同样的四个成员，换个顺序，结构体从 32 字节缩到 16 字节。**大原则：按对齐要求从大到小排列成员。** 存一百万个这样的结构体，差了 16 MB，cache 命中率差距显著。

### `__attribute__((packed))` 与 `alignas`

如果你真的需要消除 padding（比如解析网络协议包、读取二进制文件），可以用：

```cpp
struct __attribute__((packed)) NetworkHeader {
    uint8_t  version;
    uint16_t length;
    uint32_t checksum;
};
// sizeof = 7，没有 padding
```

**代价**：每次访问未对齐的成员，CPU 都要多做一次读取和拼接，性能下降。在某些 RISC 架构上甚至直接崩溃（bus error）。用之前想清楚。

反过来，如果需要强制更高的对齐（比如 SIMD 需要 32 字节对齐），用 C++11 的 `alignas`：

```cpp
struct alignas(32) SimdFriendly {
    float data[8];  // 256-bit AVX 向量，需要 32 字节对齐
};

static_assert(alignof(SimdFriendly) == 32);
```

## 追踪内存分配

调试内存泄漏和性能问题时，了解程序到底做了多少次堆分配非常有用。C++ 允许重载全局 `operator new` 和 `operator delete`，我们可以借此插入追踪逻辑。

```cpp
#include <iostream>
#include <cstdlib>

// 简单的分配追踪器
struct AllocStats {
    size_t total_allocated = 0;
    size_t total_freed = 0;
    size_t alloc_count = 0;
    size_t free_count = 0;
};

static AllocStats g_stats;
static bool g_tracking = false;  // 防止追踪器自身的分配被计入

void* operator new(size_t size) {
    if (g_tracking) {
        g_stats.total_allocated += size;
        ++g_stats.alloc_count;
        std::cout << "[ALLOC] " << size << " bytes (累计 "
                  << g_stats.alloc_count << " 次, "
                  << g_stats.total_allocated << " 字节)\n";
    }
    return std::malloc(size);
}

void operator delete(void* ptr) noexcept {
    if (g_tracking) {
        ++g_stats.free_count;
    }
    std::free(ptr);
}

void operator delete(void* ptr, size_t size) noexcept {
    if (g_tracking) {
        g_stats.total_freed += size;
        ++g_stats.free_count;
    }
    std::free(ptr);
}

int main() {
    g_tracking = true;

    std::cout << "=== 分配一个 int ===\n";
    int* p1 = new int(42);

    std::cout << "\n=== 分配一个 double 数组 ===\n";
    double* p2 = new double[10];

    std::cout << "\n=== std::string 内部分配 ===\n";
    std::string s = "Hello, memory model!";  // 短字符串可能走 SSO，不触发堆分配

    std::cout << "\n=== 统计 ===\n";
    std::cout << "总分配次数: " << g_stats.alloc_count << "\n";
    std::cout << "总分配字节: " << g_stats.total_allocated << "\n";

    delete p1;
    delete[] p2;

    std::cout << "总释放次数: " << g_stats.free_count << "\n";
    std::cout << "泄漏检测: "
              << (g_stats.alloc_count == g_stats.free_count ? "无泄漏" : "有泄漏！")
              << "\n";

    g_tracking = false;
    return 0;
}
```

典型输出：

```
=== 分配一个 int ===
[ALLOC] 4 bytes (累计 1 次, 4 字节)

=== 分配一个 double 数组 ===
[ALLOC] 80 bytes (累计 2 次, 84 字节)

=== std::string 内部分配 ===
（短字符串 SSO，无堆分配）

=== 统计 ===
总分配次数: 2
总分配字节: 84
总释放次数: 2
泄漏检测: 无泄漏
```

这个技巧在做性能调优时非常好用：某个看似无害的函数调用了多少次 `new`？`std::vector` 在 `push_back` 时扩容了几次？一目了然。

> **更成熟的方案**：生产环境里推荐用 Valgrind（Linux）、AddressSanitizer（`-fsanitize=address`）或者 Heaptrack，功能更完整，无需修改代码。

## CUDA / GPU 侧的内存对齐（AI Infra 视角）

GPU 的内存体系和 CPU 类似，但对齐的重要性更上一个量级。

### GPU 的栈与堆

每个 CUDA thread 有自己的**私有栈**，用于存放局部变量和函数调用帧（存在寄存器文件里，溢出时放 local memory）。全局内存（`cudaMalloc` 分配）就是 GPU 的"堆"，访问延迟约 200-800 个时钟周期，比 L1 cache 慢两个数量级。

### Coalesced Access：GPU 对齐的核心

GPU 的内存控制器以 **32 字节或 128 字节的事务**（transaction）为单位读取全局内存。一个 warp（32 个 thread）同时发出内存请求时，硬件会尝试把这些请求合并成尽量少的事务——这就是 **coalesced memory access**。

如果 warp 里的 32 个 thread 访问连续对齐的内存，只需要 1 次事务：

```
thread 0 → addr 0
thread 1 → addr 4
thread 2 → addr 8
...
thread 31 → addr 124
→ 1 次 128 字节事务，完美 coalesced
```

如果访问是跳跃的（stride access）或者起始地址未对齐，就可能退化成 32 次独立事务，带宽利用率从 100% 掉到 3%。

```cuda
// 好的访问模式：AoS → SoA
// 差（Array of Structs）:
struct Particle { float x, y, z, w; };
__global__ void bad_kernel(Particle* p, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    // thread 0 访问 p[0].x，thread 1 访问 p[1].x
    // 地址间隔 16 字节（sizeof(Particle)），不连续
    float val = p[i].x;
}

// 好（Struct of Arrays）:
struct Particles { float* x; float* y; float* z; float* w; };
__global__ void good_kernel(Particles p, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    // thread 0 访问 p.x[0]，thread 1 访问 p.x[1]
    // 地址连续，完美 coalesced
    float val = p.x[i];
}
```

`cudaMalloc` 保证返回的地址至少 256 字节对齐，所以堆分配本身没问题。需要注意的是**自定义结构体的内存布局**和**数组起始地址的对齐**。

CUDA 提供了 `__align__` 关键字（类似 CPU 的 `alignas`）来强制对齐，配合向量类型（`float4`、`int2` 等）能最大化内存访问效率：

```cuda
// 用 float4 一次读 16 字节，减少内存事务次数
__global__ void vectorized_kernel(float4* data, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n / 4) {
        float4 v = data[i];  // 一次 16 字节读取，4 个 float
        v.x *= 2.0f;
        v.y *= 2.0f;
        v.z *= 2.0f;
        v.w *= 2.0f;
        data[i] = v;
    }
}
```

## 小结

| | 栈 | 堆 |
|---|---|---|
| 分配速度 | 极快（一条指令） | 较慢（找空闲块、可能系统调用） |
| 容量 | 小（~8 MB） | 大（~GB 级） |
| 生命周期 | 由作用域决定 | 手动管理（RAII / 智能指针） |
| 碎片问题 | 无 | 有（长期运行后） |
| 适合场景 | 小对象、短生命周期 | 大对象、动态大小、跨作用域 |

内存对齐的核心原则：
1. **按对齐要求从大到小排列结构体成员**，节省空间
2. 用 `sizeof` 和 `offsetof` 验证你的假设
3. `__attribute__((packed))` 消除 padding，但有性能代价
4. CUDA 里优先用 SoA 布局和向量类型，确保 coalesced access

分配追踪：
- 开发阶段重载 `operator new/delete` 快速定位热点
- 生产/测试阶段用 Valgrind、AddressSanitizer、Heaptrack

理解这些底层机制，写出来的代码不只是"能跑"，而是真的快。
