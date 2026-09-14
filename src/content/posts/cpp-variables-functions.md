---
title: C++ 变量、函数与头文件
date: 2023-02-12
description: '基本数据类型的内存大小、函数的声明与定义、头文件的工程意义。'
tags: [C++]
category: C++ 入门
episode: 4
draft: false
lang: 'zh_CN'
---

> 参考：The Cherno C++ 系列第 8–10 集

这一篇覆盖三件事：变量在内存里长什么样、函数怎么工作、头文件为什么要那样组织。这些东西 Python/Java 都替你藏好了，C++ 把它们摆在明面上——多费一点理解，换来的是真正知道自己在干什么。

---

## 基本数据类型

C++ 内置类型大概分这几组：

| 类型 | 典型字节数 | 说明 |
|---|---|---|
| `bool` | 1 字节 | `true` / `false` |
| `char` | 1 字节 | 本质是个整数 |
| `int` | 4 字节 | 最常用的整数 |
| `long` | 4 或 8 字节 | 平台相关 |
| `long long` | 8 字节 | 明确要 64-bit 就用它 |
| `float` | 4 字节 | 单精度浮点 |
| `double` | 8 字节 | 双精度浮点 |

**先说一件容易误解的事**：上面的字节数不是 C++ 语言标准规定的，是"实现定义的（implementation-defined）"。标准只保证 `sizeof(char) == 1`、`sizeof(int) >= sizeof(short)` 这类相对关系。上表的数字之所以对，是因为**大多数现代 64 位平台**（x86_64、ARM64）都这样实现——不是上帝说的，是因为这些宽度刚好跟 CPU 的原生操作宽度对齐，效率最好。

想自己验证？`sizeof()` 是个运算符（不是函数），编译期就能求值：

```cpp
#include <iostream>

int main() {
    std::cout << "bool:      " << sizeof(bool)      << " 字节\n";
    std::cout << "char:      " << sizeof(char)      << " 字节\n";
    std::cout << "int:       " << sizeof(int)       << " 字节\n";
    std::cout << "long:      " << sizeof(long)      << " 字节\n";
    std::cout << "long long: " << sizeof(long long) << " 字节\n";
    std::cout << "float:     " << sizeof(float)     << " 字节\n";
    std::cout << "double:    " << sizeof(double)    << " 字节\n";
    return 0;
}
```

在大多数 64 位 macOS/Linux 上，`long` 是 8 字节，Windows 上是 4 字节——这就是"实现定义"的含义。需要明确宽度时，用 `<cstdint>` 里的 `int32_t`、`int64_t`，不会有歧义。

### `unsigned` 修饰符

默认整数是有符号的（`signed`），可以存负数。加上 `unsigned` 之后把符号位也拿来存数值：

```cpp
int a = -1;           // 有符号，-2147483648 ~ 2147483647
unsigned int b = 0;   // 无符号，0 ~ 4294967295
```

溢出 `unsigned` 会绕回（wrap around），溢出 `signed` 是未定义行为——这是 C++ 的一个经典坑，记住就好。

### `char` 不只是字符

很多人以为 `char` 只用来存字母，其实它就是一个 1 字节的整数：

```cpp
char c = 'A';         // 'A' 的 ASCII 码是 65
std::cout << c;       // 输出 A
std::cout << (int)c;  // 输出 65
```

后面写网络协议、解析二进制文件的时候，`char`/`unsigned char` 当字节缓冲区用是很常见的操作。

### `float` vs `double`

```cpp
float  f = 3.14f;   // 后缀 f 表示单精度，不加 f 字面量默认是 double
double d = 3.14;
```

`float` 4 字节，有效位约 7 位十进制；`double` 8 字节，约 15 位。除非有内存或性能压力（比如 GPU shader、大规模向量计算），默认用 `double`，精度更安全。

---

## 变量在内存中

声明一个变量，本质是在内存里划出一块区域，给它起个名字，告诉编译器这块区域存的是什么类型的数据。

```cpp
int x = 42;
```

这行代码做了三件事：在栈上分配 4 字节；把值 `42` 写进去；让后续代码用名字 `x` 来引用这块内存。

### 内存地址

C++ 可以直接拿到变量的地址：

```cpp
int x = 42;
std::cout << &x << "\n";  // 输出类似 0x7ffee4b8a9bc
```

`&` 是"取地址"运算符，返回的是一个指针（后面会专门讲）。在 CLion 里调试时，**Variables** 面板里每个变量旁边都有地址，可以直接看到，不用自己 `cout`。

### 小端存储（Little-Endian）

`int x = 0x01020304` 在内存里怎么放？x86/ARM 都是小端（little-endian）：低地址存低字节。

```
地址     内容
&x+0  →  0x04   (最低字节)
&x+1  →  0x03
&x+2  →  0x02
&x+3  →  0x01   (最高字节)
```

日常写代码不太需要操心这个，但如果以后要读二进制文件、搞网络包，小端 vs 大端是绕不开的概念。

---

## 函数

如果你用过 Python 或 Java，函数/方法的基本概念应该很熟。C++ 特有的地方是**声明和定义的分离**。

### 声明 vs 定义

**声明（declaration）**：告诉编译器"有这么一个函数，它长这样"，但不给出具体实现：

```cpp
int add(int a, int b);  // 声明，以分号结尾
```

**定义（definition）**：给出完整实现：

```cpp
int add(int a, int b) {
    return a + b;
}
```

声明可以出现多次，定义只能有一次（One Definition Rule，ODR）。

为什么要分开？因为编译器处理一个 `.cpp` 文件时是从上到下的。如果 `main` 写在前面，`add` 写在后面，编译器看到 `add(1, 2)` 这个调用时还不知道 `add` 长什么样——要么把定义放到调用之前，要么先给个声明。实际工程里，函数通常定义在另一个文件里，这时声明的意义就更大了。

### 函数调用的底层

调用一个函数，底层发生了：

1. 把参数压入栈（或放进寄存器，取决于调用约定）
2. 把返回地址（调用点的下一条指令地址）压栈
3. 跳转到函数代码
4. 函数执行，结果放在约定的位置（通常是寄存器）
5. 弹出返回地址，跳回去

这个过程叫**栈帧（stack frame）**。每次函数调用都开一帧，返回时就收掉。这也是为什么无限递归会"栈溢出"——栈的空间是有限的，帧不停压，最终撑爆。

知道这个机制之后，你就能理解为什么**频繁调用小函数在极端性能场景下有开销**——每次都要压栈弹栈。编译器的 inline 优化就是为了消除这个开销（把函数体直接展开到调用点，省掉跳转）。

### `main` 是入口点

`main` 函数是操作系统和 C++ 运行时约定好的入口，程序从这里开始执行。它的返回值是进程退出码，`return 0` 表示正常退出，非零表示出错（Shell 脚本里 `$?` 就是读这个值）。

---

## 头文件的工程意义

当项目只有一个 `.cpp` 文件的时候，声明写在哪里都行。一旦项目拆成多个文件，问题就来了：`math_utils.cpp` 里有 `add` 函数，`main.cpp` 怎么知道它存在？

答案是**头文件（`.h` / `.hpp`）**：把声明集中放在头文件里，谁需要用，就 `#include` 谁的头文件。

```
math_utils.h       ← 声明
math_utils.cpp     ← 定义（#include "math_utils.h"）
main.cpp           ← 使用（#include "math_utils.h"）
```

`math_utils.h`：

```cpp
#pragma once

int add(int a, int b);
int multiply(int a, int b);
```

`math_utils.cpp`：

```cpp
#include "math_utils.h"

int add(int a, int b) {
    return a + b;
}

int multiply(int a, int b) {
    return a * b;
}
```

`main.cpp`：

```cpp
#include <iostream>
#include "math_utils.h"

int main() {
    std::cout << add(3, 4) << "\n";      // 7
    std::cout << multiply(3, 4) << "\n"; // 12
    return 0;
}
```

### 为什么定义不能放头文件

如果把 `add` 的函数体写进头文件，然后 `main.cpp` 和另一个 `foo.cpp` 都 `#include "math_utils.h"`，编译之后链接时会看到两份 `add` 的定义——ODR 违反，链接报错。

头文件只放声明，定义留在一个 `.cpp` 文件里，链接时就只有一份定义，没有问题。

### 例外：模板和 `inline` 函数

模板（template）的实现必须放在头文件里，因为编译器在实例化模板时需要看到完整的定义。`inline` 函数标了 `inline` 之后可以在多个翻译单元里有"相同的"定义，所以也可以放头文件。这两个例外记住就行，以后遇到会有更深的理解。

### `#pragma once`

头文件通常加上 `#pragma once`（或者传统的 `#ifndef` 守卫）防止被同一个编译单元 include 两次。`#pragma once` 更简洁，主流编译器都支持，优先用它。

---

## 类型推导：`auto`

C++11 引入了 `auto`，让编译器根据初始化表达式自动推断类型：

```cpp
auto x = 42;        // int
auto y = 3.14;      // double
auto z = 'A';       // char
auto s = "hello";   // const char*（不是 std::string，注意）
```

`auto` 的好处在类型很长的时候最明显：

```cpp
// 不用写完整类型名
auto it = some_vector.begin();  // 而不是 std::vector<int>::iterator it = ...
```

一个常见的误解是 `auto` 会损失类型信息或有运行时开销——不会，类型推断完全在编译期完成，生成的代码和手写类型名一模一样。

不过也别滥用，`auto` 有时会让代码可读性变差。用的原则：类型显而易见、或者类型名写出来反而噪音时用 `auto`；需要明确表达意图（比如 `int` 而不是 `long long`）时还是手写。

---

## 小结

| 知识点 | 关键结论 |
|---|---|
| 数据类型大小 | 实现定义，不是标准固定；现代 64 位平台 `int`=4、`double`=8 |
| `sizeof` | 编译期运算符，用来验证类型大小 |
| `char` | 本质是 1 字节整数，不只是字符 |
| 函数声明 vs 定义 | 声明可多次，定义只能一次（ODR） |
| 函数调用 | 底层是压栈/弹栈，有开销，inline 可消除 |
| 头文件 | 只放声明，`.cpp` 放定义；模板和 `inline` 例外 |
| `auto` | 编译期类型推断，无运行时开销，别滥用 |

下一篇会聊指针和引用——C++ 里让很多人第一次感到"这门语言不好惹"的地方，也是它最有意思的地方。
