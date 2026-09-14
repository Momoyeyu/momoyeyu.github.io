---
title: C++ 字符串
date: 2023-04-02
description: 'C 风格字符串的内存布局、std::string 的堆分配，以及零拷贝的 string_view。'
tags: [C++, STL]
category: C++ 入门
episode: 9
draft: false
lang: 'zh_CN'
---

字符串，几乎每个程序都离不开它。Python 里写 `"hello"` 就完事了，Java 里有 `String` 对象帮你打理一切。但 C++ 里的字符串，藏着很多其他语言刻意隐藏的底层细节——而理解这些细节，正是写出高效 C++ 代码的关键。

这一篇我们从最底层的 `char` 数组讲起，一路走到 C++17 的 `std::string_view`。

---

## C 风格字符串：本质是 char 数组

在 C 里，字符串不是一种类型，它就是一个 `char` 数组。关键在于：数组末尾有一个特殊字符 `'\0'`（null terminator，值为 0），告诉程序"字符串到这里结束了"。

```cpp
char greeting[6] = {'h', 'e', 'l', 'l', 'o', '\0'};
```

更常见的写法是直接用字符串字面量：

```cpp
char greeting[] = "hello";
// 编译器自动在末尾加 '\0'，所以实际占 6 个字节
```

### '\0' 为什么这么重要？

因为数组本身不记录长度。`strlen()` 计算字符串长度的方式，就是从头遍历，直到遇到 `'\0'` 为止——这是 O(n) 的操作，并且返回的长度**不包含** `'\0'` 本身。

```cpp
#include <cstring>
#include <iostream>

int main() {
    char s[] = "hello";
    std::cout << strlen(s) << "\n"; // 输出 5，不含 '\0'
    std::cout << sizeof(s) << "\n"; // 输出 6，含 '\0'
}
```

这就是一个经典的 C 陷阱：

```cpp
char arr[5] = "hello"; // 错！"hello" 需要 6 个字节（含 '\0'），越界了
```

### 字符串字面量存在哪里？

```cpp
const char* p = "hello";
```

这里 `"hello"` 是一个**字符串字面量**，存储在程序的**只读内存段**（通常是 `.rodata`）。`p` 只是一个指向那块内存的指针，你不能修改它：

```cpp
p[0] = 'H'; // 未定义行为，运行时可能崩溃
```

注意类型：字符串字面量的类型是 `const char*`，不是 `std::string`，也不是 `char[]`。

---

## std::string：堆上的可变字符串

C 风格字符串太危险，手动管理内存太麻烦。C++ 标准库给了我们 `std::string`，它把这一切都封装好了。

```cpp
#include <string>
#include <iostream>

int main() {
    std::string s = "hello";
    s += " world";
    std::cout << s << "\n";       // hello world
    std::cout << s.size() << "\n"; // 11
}
```

### std::string 的内部结构

`std::string` 对象内部大致有三个字段：

- **ptr**：指向堆上字符数组的指针
- **size**：当前字符串的长度
- **capacity**：已分配的内存大小（可能大于 size）

当你修改字符串时，如果 `size` 超过 `capacity`，它会重新分配一块更大的堆内存（通常是 2 倍扩容），然后把内容拷贝过去。

### 小字符串优化（SSO）

实现细节里有个很聪明的优化：**SSO（Small String Optimization）**。对于短字符串（通常是 15 个字符以内，视实现而定），`std::string` 不去堆上分配内存，而是直接把字符存在对象自身的栈空间里。

```cpp
std::string short_s = "hi";        // 大概率走 SSO，不堆分配
std::string long_s  = "this is a much longer string"; // 堆分配
```

这对性能很重要：配置文件里的 key、日志里的字段名，很多都是短字符串，SSO 让它们几乎没有堆分配开销。

### 常用操作

```cpp
#include <string>
#include <iostream>

int main() {
    std::string s = "hello, world";

    // 拼接
    std::string s2 = s + "!";

    // 子串（返回新 string，有拷贝）
    std::string sub = s.substr(7, 5); // "world"

    // 查找
    size_t pos = s.find("world"); // 7
    if (pos != std::string::npos) {
        std::cout << "找到了，位置：" << pos << "\n";
    }

    // 其他
    std::cout << s.size() << "\n";   // 12
    std::cout << s.empty() << "\n";  // 0（false）

    // 获取 C 字符串指针（传给 C 函数用）
    const char* cp = s.c_str();
}
```

### 拼接的性能陷阱

`+` 运算符每次都会创建临时对象。如果你在循环里频繁拼接：

```cpp
// 慢：每次 + 都分配新内存
std::string result;
for (int i = 0; i < 1000; i++) {
    result = result + std::to_string(i) + ",";
}
```

更好的做法是预先分配或用 `std::ostringstream`：

```cpp
#include <sstream>

std::ostringstream oss;
for (int i = 0; i < 1000; i++) {
    oss << i << ",";
}
std::string result = oss.str();
```

或者如果知道大概长度，用 `reserve()`：

```cpp
std::string result;
result.reserve(5000); // 预分配，避免多次重新分配
for (int i = 0; i < 1000; i++) {
    result += std::to_string(i);
    result += ',';
}
```

---

## 字符串字面量的各种形式

C++ 支持几种字符串字面量语法，值得了解：

```cpp
// 普通字符串字面量，类型 const char*
const char* s1 = "hello";

// C++14 字面量后缀，直接得到 std::string
using namespace std::string_literals;
std::string s2 = "hello"s;

// UTF-8 字符串（C++11）
const char* s3 = u8"你好";

// 原始字符串（raw string），不处理转义
const char* s4 = R"(这里的 \n 不会换行，C:\path\to\file 直接可用)";
std::cout << s4 << "\n";

// 多行原始字符串
const char* json = R"({
    "name": "llama3",
    "size": "8B"
})";
```

原始字符串在处理正则表达式、文件路径、JSON 模板时特别好用，不需要到处写 `\\`。

---

## std::string_view（C++17）：零拷贝的字符串视图

这是 C++17 加入的一个轻量级工具，也是现代 C++ 里处理字符串的推荐方式之一。

### string_view 是什么？

`std::string_view` 本质上只是一个 `(ptr, length)` 对——一个指针加一个长度。它**不拥有**字符串的内存，不分配任何东西，也不拷贝任何内容。

```cpp
#include <string_view>
#include <iostream>

int main() {
    std::string s = "hello, world";
    std::string_view sv = s; // 没有拷贝，sv 只是指向 s 的数据

    std::cout << sv.size() << "\n"; // 12
    std::cout << sv.substr(7, 5) << "\n"; // "world"，也没有拷贝！
}
```

`sv.substr()` 返回的是另一个 `string_view`，只是调整了指针和长度，没有任何内存分配。

### 为什么比 const std::string& 更好？

这是 `string_view` 最重要的使用场景。考虑这个函数：

```cpp
// 旧写法
void log(const std::string& msg) {
    std::cout << "[LOG] " << msg << "\n";
}

log("server started"); // 问题：这里会隐式构造一个临时 std::string！
```

传 `const char*` 或字符串字面量给 `const std::string&`，编译器会偷偷帮你构造一个临时 `std::string` 对象，这涉及堆分配。

换成 `string_view`：

```cpp
// 新写法
void log(std::string_view msg) {
    std::cout << "[LOG] " << msg << "\n";
}

log("server started"); // 只传了一个指针+长度，零拷贝
log(some_string);      // 也没有拷贝
log(some_string.substr(5, 10)); // 哦等等，substr 返回 std::string，这里还是有拷贝
```

用 `string_view` 来做参数，可以无缝接受 `const char*`、`std::string`、字符串字面量，并且都是零拷贝（或最小代价）。

### 注意悬空引用

`string_view` 不管理内存，所以你必须保证原始字符串的生命周期比 `string_view` 更长：

```cpp
std::string_view dangerous() {
    std::string s = "hello";
    return s; // 错！s 在函数结束后销毁，返回的 view 指向已释放的内存
}
```

这是 `string_view` 唯一需要小心的地方。在函数参数里用它一般没问题，但不要把它存起来指向一个临时对象。

---

## 字符串操作速查

```cpp
#include <string>
#include <iostream>

int main() {
    std::string s = "hello world";

    // 查找与子串
    std::cout << s.find("world") << "\n";    // 6
    std::cout << s.substr(6) << "\n";        // "world"
    std::cout << s.substr(0, 5) << "\n";     // "hello"

    // C++20: starts_with / ends_with
    std::cout << s.starts_with("hello") << "\n"; // 1
    std::cout << s.ends_with("world") << "\n";   // 1

    // 字符串转数字
    std::string num = "42";
    int i = std::stoi(num);
    double d = std::stod("3.14");

    // 数字转字符串
    std::string from_num = std::to_string(42);

    // 替换
    size_t pos = s.find("world");
    if (pos != std::string::npos) {
        s.replace(pos, 5, "C++");
    }
    std::cout << s << "\n"; // "hello C++"
}
```

---

## AI Infra 场景里的字符串

在 AI 基础设施代码里，字符串操作无处不在：

**配置文件解析**：读取模型名称、路径、超参数。`string_view` 可以在不拷贝的情况下切分和查找配置项。

**日志格式化**：每秒可能输出几千条日志。用 `std::ostringstream` 或预先 `reserve()` 的 `std::string` 避免频繁堆分配。

**模型名称 key 查找**：在 `std::unordered_map<std::string, ...>` 里用 `string_view` 查找，C++26 之前需要一些技巧，但 C++20 的 heterogeneous lookup 可以帮到你。

**Tokenizer**：把原始文本切分成 token，大量用到 `substr`。高性能 tokenizer 会用 `string_view` 而不是 `std::string` 来表示 token，避免为每个 token 分配内存。

---

## 总结

| 类型 | 存储位置 | 可变 | 分配内存 | 适用场景 |
|---|---|---|---|---|
| `const char*` / 字符串字面量 | 只读内存段 | 否 | 否 | C API 交互 |
| `char[]` | 栈 | 是 | 否 | 小的临时缓冲区 |
| `std::string` | 堆（或 SSO 优化在栈） | 是 | 是 | 通用可变字符串 |
| `std::string_view` | 不拥有 | 否 | 否 | 只读参数、零拷贝视图 |

C++ 字符串的复杂性来自它的历史包袱——C 风格字符串带着 `\0` 的设计一直延续下来。但正是因为理解了 `\0` 的存在、堆分配的代价、SSO 的妙处，以及 `string_view` 的零拷贝哲学，你才能在需要性能的场合做出正确的选择。

下一篇我们聊聊 C++ 的引用与指针——同样是 C++ 里最容易踩坑、也最值得深挖的话题。
