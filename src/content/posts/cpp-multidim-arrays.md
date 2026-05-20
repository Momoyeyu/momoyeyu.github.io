---
title: C++ 多维数组
published: 2023-07-20
description: '二维数组的内存模型、行主序 vs 列主序，以及 GEMM 的内存访问模式。'
tags: [C++, 内存, AI Infra]
category: C++ 进阶
episode: 6
draft: false
lang: 'zh_CN'
---

多维数组是 C++ 里最容易被"误解"的东西之一。很多人用了好几年，却从没想过 `int arr[3][4]` 和 `int** pp` 到底有什么本质区别。搞 AI Infra 的话，这个问题直接关系到你写出来的矩阵乘法快不快、CUDA kernel 会不会 cache miss 爆炸。

今天把这件事彻底说清楚。

---

## 二维数组的本质

先问一个问题：`int arr[3][4]` 在内存里是什么样的？

答案很简单：**连续的 12 个 int**。

```
arr[0][0] arr[0][1] arr[0][2] arr[0][3]
arr[1][0] arr[1][1] arr[1][2] arr[1][3]
arr[2][0] arr[2][1] arr[2][2] arr[2][3]
```

这 12 个元素在内存里是紧挨着放的，行与行之间没有任何间隔。这就是 **row-major（行主序）**，C 和 C++ 都遵循这个约定。

`arr[i][j]` 的地址计算：

```
address(arr[i][j]) = base + (i * 4 + j) * sizeof(int)
```

编译器在编译时就知道每行有 4 个元素，所以能算出正确的偏移。这一点非常关键——编译器需要知道列数，这也是为什么传二维数组给函数时必须指定列数。

---

## 指针与二维数组：`int (*p)[4]` vs `int**`

这是最容易搞混的地方，也是面试常考点。

```cpp
int arr[3][4] = { {1,2,3,4}, {5,6,7,8}, {9,10,11,12} };

// 正确：指向"长度为 4 的 int 数组"的指针
int (*p)[4] = arr;
// p[1][2] 等价于 arr[1][2]，地址计算完全一致

// 错误：int** 是指针的指针，和 arr 完全不是一回事
int** pp = arr;  // 编译报错或 UB
```

`int (*p)[4]` 的类型是"指向 `int[4]` 的指针"。`p + 1` 会跳过整整一行（16 字节），这和 `arr` 的内存布局完美匹配。

`int**` 是"指向 `int*` 的指针"。`pp[0]` 应该是一个 `int*`，但 `arr[0]` 其实是 `{1, 2, 3, 4}`——这里存的是 int 数据，不是指针。所以 `pp[0]` 会把那 4 个 int 的原始字节解释成一个地址，然后去解引用，直接 segfault。

**函数参数传二维数组：**

```cpp
// 这两种写法完全等价
void process(int arr[][4], int rows);
void process(int (*arr)[4], int rows);

// 调用
process(arr, 3);
```

列数 4 必须写死，因为编译器要用它来计算行偏移。如果列数是运行时确定的，就需要换一种方式。

---

## 动态二维数组的三种姿势

### 姿势一：`int**`——能用，但别用

```cpp
int rows = 3, cols = 4;

int** arr = new int*[rows];
for (int i = 0; i < rows; i++) {
    arr[i] = new int[cols];
}

// 使用
arr[1][2] = 42;

// 释放（容易忘）
for (int i = 0; i < rows; i++) {
    delete[] arr[i];
}
delete[] arr;
```

内存布局：

```
arr ──► [ptr0] [ptr1] [ptr2]
           │      │      │
           ▼      ▼      ▼
         [行0]  [行1]  [行2]
```

每行都是独立分配的，在内存里可能相差几百 KB。每次访问 `arr[i][j]` 需要两次解引用：先读指针 `arr[i]`，再读数据 `arr[i][j]`。对 cache 来说是灾难。

### 姿势二：`vector<vector<int>>`——方便，但同样不连续

```cpp
std::vector<std::vector<int>> arr(rows, std::vector<int>(cols, 0));

arr[1][2] = 42;  // 语法很友好
```

内存同样不连续，每个内层 `vector` 独立在堆上分配。在矩阵运算场景下，性能问题和 `int**` 一样。

### 姿势三：一维数组模拟——推荐，性能最好

```cpp
std::vector<int> arr(rows * cols, 0);

// 访问 [i][j]
arr[i * cols + j] = 42;

// 封装成 lambda 更易用
auto at = [&](int i, int j) -> int& {
    return arr[i * cols + j];
};
at(1, 2) = 42;
```

内存完全连续，12 个 int 紧挨着放，和 `int arr[3][4]` 的布局完全一样。这是在 AI Infra 里处理矩阵的标准做法。

---

## Row-major vs Column-major

C/C++ 用行主序（row-major）：元素按行存储，同一行的元素在内存里相邻。

Fortran、MATLAB、NumPy 默认用列主序（column-major）：元素按列存储，同一列的元素在内存里相邻。

用 3×3 矩阵举例：

```
逻辑矩阵：
| 1  2  3 |
| 4  5  6 |
| 7  8  9 |

Row-major（C/C++）内存：1 2 3 4 5 6 7 8 9
Col-major（Fortran）内存：1 4 7 2 5 8 3 6 9
```

这个差异在矩阵乘法里会造成巨大的性能差异。

---

## Cache 友好性：行主序的代价

现代 CPU 的 cache line 通常是 64 字节，也就是一次能加载 16 个 int。当你访问 `arr[i][j]` 时，CPU 会把 `arr[i][j]` 附近的元素一起加到 cache 里。

对于行主序的数组，哪种遍历方式快？

```cpp
// 按行遍历：cache 友好
// 每次访问的元素和上一次相邻，cache hit 率极高
for (int i = 0; i < N; i++) {
    for (int j = 0; j < N; j++) {
        sum += arr[i * N + j];  // 顺序访问内存
    }
}

// 按列遍历：cache 不友好
// 每次访问跳过整整一行（N * sizeof(int) 字节）
for (int j = 0; j < N; j++) {
    for (int i = 0; i < N; i++) {
        sum += arr[i * N + j];  // 每次跳 N 个元素
    }
}
```

实测对比（N = 4096，int 矩阵，约 64MB）：

```cpp
#include <vector>
#include <chrono>
#include <iostream>
#include <numeric>

int main() {
    const int N = 4096;
    std::vector<int> arr(N * N);
    std::iota(arr.begin(), arr.end(), 0);

    volatile long long sum = 0;

    // 行遍历
    auto t0 = std::chrono::high_resolution_clock::now();
    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++)
            sum += arr[i * N + j];
    auto t1 = std::chrono::high_resolution_clock::now();

    // 列遍历
    sum = 0;
    auto t2 = std::chrono::high_resolution_clock::now();
    for (int j = 0; j < N; j++)
        for (int i = 0; i < N; i++)
            sum += arr[i * N + j];
    auto t3 = std::chrono::high_resolution_clock::now();

    auto row_ms = std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count();
    auto col_ms = std::chrono::duration_cast<std::chrono::milliseconds>(t3 - t2).count();

    std::cout << "Row-major traversal: " << row_ms << " ms\n";
    std::cout << "Col-major traversal: " << col_ms << " ms\n";
    std::cout << "Slowdown: " << (float)col_ms / row_ms << "x\n";

    return 0;
}
```

典型结果：列遍历比行遍历慢 **5x 到 20x**，具体取决于矩阵大小和 CPU cache 大小。当矩阵大到装不进 L3 cache 时，差距最为明显。

---

## 矩阵转置的 Cache 问题

朴素转置：

```cpp
// 朴素实现：O(n²) 操作，但 cache 行为很差
void naive_transpose(float* A, float* B, int N) {
    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++)
            B[j * N + i] = A[i * N + j];  // 写 B 时列跳跃
}
```

问题在于：读 A 是行主序（友好），写 B 是列跳跃（不友好）。每次写 `B[j * N + i]`，`j` 在变，步长是 N，远超一个 cache line。

分块转置（Tiled Transpose）：

```cpp
// 分块转置：每次处理 TILE×TILE 的小块，局部性好
void tiled_transpose(float* A, float* B, int N, int TILE = 32) {
    for (int i = 0; i < N; i += TILE) {
        for (int j = 0; j < N; j += TILE) {
            // 处理当前块
            int imax = std::min(i + TILE, N);
            int jmax = std::min(j + TILE, N);
            for (int ii = i; ii < imax; ii++) {
                for (int jj = j; jj < jmax; jj++) {
                    B[jj * N + ii] = A[ii * N + jj];
                }
            }
        }
    }
}
```

TILE 大小通常选 32 或 64，使得一个块正好能装进 L1 cache。在这个尺度上，读 A 和写 B 的访问都局限在一个小区域里，cache miss 大幅减少。

这个技巧在 CUDA 里几乎是必学内容，因为 GPU 的 shared memory 就是用来做这种 tiling 的。

---

## GEMM 的访问模式

矩阵乘法 C = A × B，朴素实现：

```cpp
void gemm_naive(float* A, float* B, float* C, int M, int N, int K) {
    for (int i = 0; i < M; i++) {         // C 的行
        for (int j = 0; j < N; j++) {     // C 的列
            float sum = 0.0f;
            for (int k = 0; k < K; k++) { // 内积
                sum += A[i * K + k] *     // A 按行访问：友好
                       B[k * N + j];      // B 按列访问：不友好！
            }
            C[i * N + j] = sum;
        }
    }
}
```

最内层循环里，`A[i * K + k]` 随 k 增加步长为 1（行主序，友好），而 `B[k * N + j]` 随 k 增加步长为 N（列方向，不友好）。这就是朴素 GEMM 慢的根本原因之一。

解决方案之一：预先转置 B：

```cpp
void gemm_with_transpose(float* A, float* B, float* C, int M, int N, int K) {
    // 先转置 B，得到 B^T，shape 是 N×K
    std::vector<float> BT(N * K);
    for (int k = 0; k < K; k++)
        for (int j = 0; j < N; j++)
            BT[j * K + k] = B[k * N + j];

    // 现在用 BT[j * K + k] 访问，随 k 步长为 1，cache 友好
    for (int i = 0; i < M; i++) {
        for (int j = 0; j < N; j++) {
            float sum = 0.0f;
            for (int k = 0; k < K; k++) {
                sum += A[i * K + k] * BT[j * K + k];  // 两个都友好
            }
            C[i * N + j] = sum;
        }
    }
}
```

实际的高性能 GEMM（比如 OpenBLAS、cuBLAS）用的是更复杂的 tiling 策略，同时对 A 和 B 做分块，配合向量化指令和寄存器复用，才能达到接近理论峰值的性能。

---

## CUDA 中的矩阵

在 GPU 上，这个问题更加复杂，因为 GPU 的内存访问有 **coalescing** 要求：同一个 warp 里的 32 个线程最好同时访问连续的内存地址，否则会触发多次内存事务，带宽利用率暴跌。

### cuBLAS 的列主序约定

cuBLAS 是 Fortran legacy 的产物，默认使用**列主序**。如果你的矩阵是行主序的，有两种处理方式：

```cpp
// 方式一：利用转置等价关系
// C = A × B  (row-major)
// 等价于：C^T = B^T × A^T  (col-major)
// 所以把 A 当成 B^T，把 B 当成 A^T 传给 cuBLAS 即可
cublasSgemm(handle,
    CUBLAS_OP_N, CUBLAS_OP_N,
    N, M, K,        // 注意维度顺序也要交换
    &alpha,
    d_B, N,         // B 当 A^T 用
    d_A, K,         // A 当 B^T 用
    &beta,
    d_C, N);
```

这个技巧初看反直觉，但数学上完全等价。

### CUDA 内核中的二维矩阵访问

在自己写的 kernel 里，通常用一维数组配合行偏移：

```cpp
__global__ void matmul_kernel(float* A, float* B, float* C,
                               int M, int N, int K) {
    int row = blockIdx.y * blockDim.y + threadIdx.y;
    int col = blockIdx.x * blockDim.x + threadIdx.x;

    if (row < M && col < N) {
        float sum = 0.0f;
        for (int k = 0; k < K; k++) {
            // A[row][k]：同一 warp 的线程 row 相同，k 相同，访问同一元素
            // 这里没有 coalescing，因为线程按 col 分布
            sum += A[row * K + k] * B[k * N + col];
        }
        C[row * N + col] = sum;
    }
}
```

上面这个实现写 `C` 时是 coalesced 的（同一 warp 里 col 连续），但读 `A` 时每个线程读同一行不同 k，不同线程读不同行，也不太 coalesced。实际的优化需要用 shared memory 做 tiling，这是 CUDA 矩阵乘法的标准套路。

### `cudaMallocPitch`：对齐问题

GPU 对内存地址有对齐要求。`cudaMallocPitch` 会在每行末尾添加 padding，使得每行的起始地址满足对齐要求：

```cpp
float* d_A;
size_t pitch;  // 实际的行字节数（包含 padding）
cudaMallocPitch(&d_A, &pitch, cols * sizeof(float), rows);

// 访问 [i][j]
float* row_ptr = (float*)((char*)d_A + i * pitch);
float val = row_ptr[j];
```

`pitch` 通常是 512 字节的倍数。代价是内存浪费，收益是每行都对齐，global memory 访问效率更高。

---

## 总结

几个核心结论：

1. `int arr[3][4]` 是连续内存，行主序；`int**` 是指针的指针，两者完全不同，不能互换。

2. 动态二维数组优先用一维数组模拟（`vector<int>` + `i * cols + j`），保证内存连续。

3. 行主序下，按行遍历是 cache 友好的；按列遍历会大量 cache miss，实测慢 5-20x。

4. 矩阵乘法的内层循环对 B 的访问是列方向的，这是朴素 GEMM 性能差的根源；高性能实现通过转置或 tiling 解决。

5. cuBLAS 是列主序，利用 `C = A×B` 等价于 `C^T = B^T × A^T` 可以避免显式转置。

6. CUDA kernel 里，coalescing 要求同 warp 的线程访问连续内存，矩阵乘法的优化必须配合 shared memory tiling。

内存布局不是底层细节，是性能的核心。在 AI Infra 里，一个错误的遍历顺序可能让你的矩阵乘法慢十倍，而这十倍不是算法问题，纯粹是内存访问模式的问题。
