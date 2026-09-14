---
title: C++ 位运算
date: 2024-08-15
description: '二进制基础、AND/OR/XOR/NOT/移位运算，以及位运算在 GPU 编程中的应用。'
tags: [C++, AI Infra]
category: C++ 进阶
episode: 20
draft: false
lang: 'zh_CN'
---

位运算是真正接近硬件的操作。大多数教程介绍完六个符号就结束了，但如果你在做 AI Infra 或 CUDA 开发，位运算几乎无处不在——量化、地址对齐、warp ballot、sparse mask——全都依赖对二进制的精确操控。这篇文章从二进制基础讲起，把每种运算的"为什么"说清楚，最后落到 GPU 编程的实际场景。

---

## 二进制基础

整数在内存中就是一串 0 和 1。`int` 在大多数平台上是 4 字节，也就是 32 位：

```cpp
sizeof(int); // 4（字节）= 32 位
```

无符号整数直接按权展开：第 0 位权重 1，第 1 位权重 2，第 n 位权重 2^n。

有符号整数用**补码**（two's complement）表示。补码的规则是：正数和无符号数相同；负数先对正数取反（所有位翻转），再加 1。

为什么用补码？因为补码让加法电路对有符号和无符号数完全一致，硬件不需要额外的减法单元。

一个直接推论：`-1` 的补码是全 1（所有 32 位都是 1）。验证一下：

```
+1  = 0000...0001
取反 = 1111...1110
加 1 = 1111...1111  ← 这就是 -1
```

所以 `-1` 的十六进制表示是 `0xFFFFFFFF`，和 `~0` 完全相同。这不是巧合，而是补码设计的结果。

另一个推论：32 位有符号整数的范围是 `-2^31` 到 `2^31 - 1`，最小值的补码是 `1000...0000`（符号位为 1，其余全 0），没有对应的正数，这也是为什么 `abs(INT_MIN)` 会溢出。

---

## 六种位运算符

### `&`（AND）：提取特定位

两个操作数的对应位**都是 1** 时，结果才是 1。

```
  1010 1100
& 0000 1111
-----------
  0000 1100
```

最核心的用途是**掩码（mask）**：用一个特定的二进制模式提取你关心的那几位，其余位清零。

```cpp
uint8_t byte = 0b10110101;

// 提取低 4 位
uint8_t low_nibble = byte & 0x0F; // 0000 0101 = 5

// 检查某个标志位是否被设置
bool has_flag = (byte & 0b00100000) != 0;
```

### `|`（OR）：设置特定位

两个操作数的对应位**任意一个是 1** 时，结果就是 1。

```
  1010 0000
| 0000 1111
-----------
  1010 1111
```

用途：**无条件地把某一位设为 1**，不影响其他位。

```cpp
uint32_t flags = 0b0000;
flags |= 0b0100; // 把第 2 位设为 1，其余位不变
```

### `^`（XOR）：翻转特定位

两个操作数的对应位**不同**时，结果是 1；相同时，结果是 0。

```
  1010 1010
^ 0000 1111
-----------
  1010 0101
```

XOR 有个有趣的性质：`a ^ a = 0`，`a ^ 0 = a`。这意味着：

```cpp
// 无临时变量交换两个整数
int a = 5, b = 7;
a ^= b; // a = a ^ b
b ^= a; // b = b ^ (a ^ b) = a（原始 a）
a ^= b; // a = (a ^ b) ^ a = b（原始 b）
// 注意：a 和 b 必须是不同的变量（不同内存地址），否则结果为 0

// 翻转特定位
x ^= (1 << n); // 翻转第 n 位
```

### `~`（NOT）：取反所有位

一元运算符，把所有位翻转。

```cpp
int x = 0;    // 0000...0000
int y = ~x;   // 1111...1111 = -1（补码）

uint32_t mask = ~0u; // 全 1 掩码，0xFFFFFFFF
```

`~0` 等于 `-1` 这一点在构造掩码时很有用。注意 `~` 是按位取反，不是逻辑非 `!`。

### `<<`（左移）：乘以 2 的幂

把所有位向左移动 n 位，右边补 0，左边溢出的位丢弃。

```cpp
int x = 1;
x << 3; // 1 * 2^3 = 8
x << 0; // 不变
```

**等价于乘以 2^n**，但比乘法快（现代编译器通常会自动转换，但写出来更清晰）。

注意：对有符号整数左移超出范围是**未定义行为（UB）**。如果需要可预测的行为，用无符号整数：

```cpp
uint32_t flag = 1u << 31; // 安全
int flag = 1 << 31;       // UB（溢出有符号整数）
```

### `>>`（右移）：除以 2 的幂，但要注意符号

右移分两种：

- **逻辑右移**：左边补 0，无符号整数使用。
- **算术右移**：左边补符号位（正数补 0，负数补 1），有符号整数使用。

```cpp
int8_t a = -8;    // 1111 1000
a >> 2;           // 1111 1110 = -2（算术右移，符号位填充）

uint8_t b = 200;  // 1100 1000
b >> 2;           // 0011 0010 = 50（逻辑右移，0 填充）
```

为什么这样设计？算术右移对有符号负数相当于**向下取整的除以 2**：`-8 >> 2 = -2`（等价于 `-8 / 4`）。这样有符号整数的移位运算在数学上保持一致。

C++ 标准规定：对有符号整数的右移行为是**实现定义的**（implementation-defined），但在 x86/ARM 上一致使用算术右移。如果你需要可移植的逻辑右移，用无符号类型。

---

## 常见位操作技巧

这些是每个 C++ 开发者都应该烂熟于心的操作：

```cpp
// 检查第 n 位是否为 1（n 从 0 开始，0 是最低位）
bool is_set = (x >> n) & 1;

// 设置第 n 位（强制为 1）
x |= (1 << n);

// 清除第 n 位（强制为 0）
x &= ~(1 << n);

// 翻转第 n 位
x ^= (1 << n);

// 获取最低位的 1（isolate lowest set bit）
int lowest = x & (-x);
// 例如：x = 0b10110100，-x 的补码使得 x & (-x) = 0b00000100

// 消去最低位的 1（clear lowest set bit）
x = x & (x - 1);
// 例如：x = 0b10110100 → 0b10110000

// 检查是否是 2 的幂（只有一个 1）
bool is_power_of_two = x > 0 && (x & (x - 1)) == 0;
// 原理：2 的幂只有一个 1，x-1 把那个 1 变成 0、低位变成全 1，AND 结果为 0

// 对 2 的幂取模（比 % 运算符快）
int remainder = x & (N - 1); // 等价于 x % N，当 N 是 2 的幂时
// 例如：x & 7 等价于 x % 8，x & 63 等价于 x % 64
```

`x & (x - 1)` 值得多说一句。`x - 1` 的效果是：把 x 的最低位的 1 清零，然后把它右边所有的 0 变成 1。AND 之后，最低位的 1 就消失了。这个技巧可以用来写 popcount（计算 1 的个数）的朴素实现：

```cpp
int popcount_naive(uint32_t x) {
    int count = 0;
    while (x) {
        x &= (x - 1); // 每次消去一个 1
        count++;
    }
    return count;
}
```

当然，实际中应该用内置函数（见下文）。

---

## 位标志（Bit Flags）

用一个整数的每一位表示一个布尔状态，是 C 和 C++ 中的经典模式：

```cpp
// 权限系统示例
const uint8_t READ  = 1 << 0; // 0b00000001
const uint8_t WRITE = 1 << 1; // 0b00000010
const uint8_t EXEC  = 1 << 2; // 0b00000100

uint8_t permissions = 0;

// 授权
permissions |= READ | WRITE;

// 检查权限
bool can_read  = (permissions & READ)  != 0;
bool can_write = (permissions & WRITE) != 0;
bool can_exec  = (permissions & EXEC)  != 0;

// 撤销权限
permissions &= ~WRITE;

// 检查是否有某组权限中的任意一个
bool has_any = (permissions & (READ | EXEC)) != 0;

// 检查是否同时拥有某组权限
bool has_all = (permissions & (READ | WRITE)) == (READ | WRITE);
```

与 `bool` 数组相比，位标志的优势：
- **内存紧凑**：32 个标志只需 4 字节，`bool[32]` 则需要 32 字节
- **操作原子**：一条指令完成多个标志的检查和设置
- **缓存友好**：紧凑数据更容易装入缓存行

OpenGL 和 Vulkan 的标志参数就是这种设计，例如 `VkBufferUsageFlags`。

---

## GPU 编程中的位运算

这是 AI Infra 开发者真正需要掌握的部分。在 CUDA 中，位运算不只是"性能优化技巧"，而是某些操作的唯一实现方式。

### `__ballot_sync`：warp 内的条件聚合

CUDA warp 有 32 个 thread，`__ballot_sync` 把 warp 内每个 thread 的某个条件（0 或 1）收集成一个 32 位整数，第 i 位对应第 i 个 lane：

```cuda
__device__ void example(int lane_id, bool condition) {
    // mask = 0xFFFFFFFF 表示 warp 内所有 32 个 thread 都参与
    uint32_t ballot = __ballot_sync(0xFFFFFFFF, condition);

    // ballot 的第 lane_id 位，就是当前 thread 的 condition
    // 第 k 位为 1，表示第 k 个 lane 的 condition 为 true

    // 统计满足条件的 thread 数量
    int count = __popc(ballot);

    // 只让满足条件的 thread 执行某段代码
    if (condition) {
        // 这里只有 ballot 中对应位为 1 的 thread 会执行
    }
}
```

实际场景：在 attention 计算中，某些 token 可能被 mask 掉。用 `__ballot_sync` 可以快速判断整个 warp 是否全部被 mask，如果是，直接跳过计算：

```cuda
bool is_masked = /* 当前 token 是否被 mask */;
uint32_t active_mask = __ballot_sync(0xFFFFFFFF, !is_masked);
if (active_mask == 0) return; // 整个 warp 都被 mask，直接退出
```

### `__popc`：popcount

`__popc(x)` 计算 x 中 1 的个数，对应 CPU 上的 `__builtin_popcount`（GCC）或 `_mm_popcnt_u32`（MSVC）。在 GPU 上这是一条单周期指令（`POPC`）。

```cuda
// 统计 sparse attention mask 中有效的 token 数量
uint32_t mask = /* 32 个 token 的有效性位图 */;
int active_count = __popc(mask);

// 用于计算 softmax 的分母时，只对有效 token 求和
```

### 量化：位操作打包/解包

int8 量化把 float32 压缩成 int8，节省 4 倍内存和带宽。4-bit 量化更激进，两个 4-bit 值打包进一个 int8：

```cuda
// 4-bit 量化的打包（两个 4-bit 值 → 一个 uint8）
__device__ uint8_t pack_int4(int8_t hi, int8_t lo) {
    return ((hi & 0x0F) << 4) | (lo & 0x0F);
}

// 解包
__device__ void unpack_int4(uint8_t packed, int8_t& hi, int8_t& lo) {
    // 高 4 位：右移 4 位，然后符号扩展
    hi = (int8_t)(packed >> 4);
    // 低 4 位：提取低 4 位，符号扩展（用位操作）
    lo = (int8_t)((packed << 4) >> 4); // 算术右移保留符号
}
```

CUTLASS 和 bitsandbytes 库中有大量这类代码。

### 地址对齐

CUDA 内存访问对齐是性能关键。向下对齐到 align（必须是 2 的幂）：

```cpp
// 将地址向下对齐到 align 字节（align 必须是 2 的幂）
size_t aligned_down = addr & ~(align - 1);

// 将地址向上对齐到 align 字节
size_t aligned_up = (addr + align - 1) & ~(align - 1);

// 示例：对齐到 128 字节（CUDA L2 cache line 大小）
const size_t CACHE_LINE = 128;
size_t aligned_addr = base_addr & ~(CACHE_LINE - 1);
```

`~(align - 1)` 是一个尾部为 0 的掩码：如果 align = 128 = `0b10000000`，那么 align - 1 = `0b01111111`，取反得到 `0b...11110000000`，AND 之后低 7 位清零，保证对齐。

这比取模运算快，因为避免了除法指令，且编译器可以更好地优化。

---

## std::bitset

如果不需要极致性能，`std::bitset` 提供更安全、可读性更好的接口：

```cpp
#include <bitset>

std::bitset<32> flags;

// 设置、清除、翻转
flags.set(3);       // 设置第 3 位
flags.reset(3);     // 清除第 3 位
flags.flip(3);      // 翻转第 3 位

// 查询
bool is_set = flags.test(3);  // 检查第 3 位（越界会抛出异常）
bool is_set2 = flags[3];      // 下标运算符（越界是 UB）
size_t count = flags.count(); // 统计 1 的个数

// 整体操作
flags.set();   // 全部置 1
flags.reset(); // 全部置 0
flags.flip();  // 全部翻转

// 与原始整数互转
uint32_t raw = static_cast<uint32_t>(flags.to_ulong());
std::bitset<32> from_int(0b10110101u);

// 按位运算（支持 &、|、^、~）
std::bitset<32> a(0xFF), b(0x0F);
auto c = a & b; // 0x0F
```

`std::bitset` 的大小必须是编译期常量。如果需要运行期大小，用 `std::vector<bool>`（虽然它的实现有争议）或手动管理 `uint64_t` 数组。

---

## 总结

位运算是最接近硬件语义的操作，理解它需要建立对二进制表示（尤其是补码）的直觉：

- **`&`** 用于提取和检查，**`|`** 用于设置，**`^`** 用于翻转
- **`~`** 取反，结合 `&` 实现清除；`~0 = -1` 来自补码定义
- **左移等于乘以 2^n**，对有符号数越界是 UB；**右移**有有符号/无符号两种语义
- `x & (x-1)` 消去最低位的 1，是 popcount 和幂次检查的基础

在 GPU 编程中，位运算直接映射到硬件指令：`__ballot_sync` 聚合 warp 内条件、`__popc` 计算 popcount、位打包实现低精度量化、位掩码实现高效地址对齐。这些不是"高级技巧"，而是 AI Infra 日常工作的基础设施。

下一篇会讲 C++ 的内存模型和原子操作——那也是 GPU 编程绕不开的话题。
