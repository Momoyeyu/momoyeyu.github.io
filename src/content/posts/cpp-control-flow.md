---
title: C++ 控制流
published: 2023-02-19
description: '条件判断、循环和 switch 背后的机制，以及 break/continue/return 的用法。'
tags: [C++]
category: C++ 入门
episode: 5
draft: false
lang: 'zh_CN'
---

控制流这个话题看起来很基础——if/else、for、while，Python 和 Java 都有，有什么好讲的？

答案是：C++ 的控制流在底层有很多有趣的细节，理解这些细节不仅能帮你写出更好的代码，还能让你在读汇编或做性能优化时少走弯路。

## if / else：不只是 true 和 false

先从最简单的 if 说起。在大多数语言里，if 的条件必须是布尔值。但在 C++ 里，if 判断的本质是：**这个值是否为零**。

```cpp
int x = 42;
if (x) {
    // x != 0，所以进入这里
}

int* ptr = nullptr;
if (ptr) {
    // ptr == nullptr == 0，所以不进入
}

double d = 0.0;
if (d) {
    // 0.0 == 0，所以不进入
}
```

这不是语法糖，这是 C++ 的核心规则：**任何非零值都隐式转换为 true**。这就是为什么你可以写 `if (ptr)` 来检查指针是否为空，而不必写 `if (ptr != nullptr)`——两者在语义和生成的机器码上完全等价。

### 汇编层面的 if

如果你用 Compiler Explorer 看一段简单的 if 代码，会发现编译器生成的汇编大概长这样：

```asm
cmp eax, 0    ; 比较 eax 和 0
je  .else     ; 如果相等（即为零）就跳转到 else 分支
; ... then 分支的代码
jmp .end
.else:
; ... else 分支的代码
.end:
```

`cmp` + 条件跳转指令（`je`/`jne`/`jg` 等）——这就是 if 的本质。CPU 不知道什么是"条件判断"，它只会比较和跳转。C++ 的 if 只是对这个机制的高级封装。

### 一个有趣的边界情况

```cpp
if (1) {
    std::cout << "永远执行" << std::endl;
}
```

条件是字面量 `1`，编译器在编译期就知道这个分支永远为真。开启优化后，编译器会直接把 if 结构去掉，就像你根本没写 if 一样——这叫**常量折叠**（constant folding）。反过来，`if (0)` 里的代码会被完全删除，不生成任何机器码。

## for 循环：三种写法，各有用处

### 传统 for

```cpp
for (int i = 0; i < 10; i++) {
    std::cout << i << std::endl;
}
```

三段式：初始化、条件、步进。初始化里声明的变量只在循环内可见——这一点和 C 语言早期版本不同，C++ 明确了作用域。

### 范围 for（Range-based for）

C++11 引入的现代写法，遍历容器时首选：

```cpp
std::vector<int> nums = {1, 2, 3, 4, 5};

// 按值复制——每个元素都会被复制一次
for (int n : nums) {
    std::cout << n << std::endl;
}

// 按引用——不复制，直接访问原始元素
for (const int& n : nums) {
    std::cout << n << std::endl;
}

// 懒人写法，让编译器推导类型
for (const auto& n : nums) {
    std::cout << n << std::endl;
}
```

**为什么要用 `const auto&`？**

如果元素是 `int` 这种基础类型，按值复制无所谓。但如果是 `std::string`、`std::vector` 或者自定义的大对象，每次循环都复制一遍代价很高。用引用可以避免不必要的拷贝。加上 `const` 是因为你只是遍历，不需要修改——明确语义，也让编译器有更多优化空间。

如果你需要修改元素：

```cpp
for (auto& n : nums) {
    n *= 2;  // 直接修改原始元素
}
```

## while 和 do-while：先判断还是先执行

### while

```cpp
int i = 0;
while (i < 10) {
    std::cout << i++ << std::endl;
}
```

先检查条件，再执行循环体。如果一开始条件就为假，循环体一次都不执行。

### do-while

```cpp
int i = 0;
do {
    std::cout << i++ << std::endl;
} while (i < 10);
```

先执行一次循环体，再检查条件。**保证至少执行一次**——这是它和 while 的唯一区别，也是它存在的意义。

do-while 的典型使用场景：需要先做一件事，然后根据结果决定是否继续。比如读取用户输入并验证：

```cpp
int input;
do {
    std::cout << "请输入一个正数：";
    std::cin >> input;
} while (input <= 0);
```

## switch：比 if-else 链更快的秘密

当你有很多分支要判断同一个变量时，switch 不只是让代码更好看，它在底层有实质性的性能优势。

```cpp
int command = getCommand();

switch (command) {
    case 1:
        doAction1();
        break;
    case 2:
        doAction2();
        break;
    case 3:
        doAction3();
        break;
    default:
        doDefault();
        break;
}
```

### Jump Table：switch 的底层魔法

当 case 的值是**连续或接近连续的整数**时，编译器可以生成一张**跳转表**（jump table）：一个存储各个 case 入口地址的数组。执行时，编译器直接用变量值作为索引查表，**一次跳转就到达目标分支**，时间复杂度是 O(1)。

而 if-else 链是顺序比较，最坏情况要比较 N 次，时间复杂度 O(N)。

这意味着：当 case 很多时，switch 比等价的 if-else 链快得多。case 越密集，跳转表的效果越好。

### Fall-through：设计如此，但要小心

switch 有一个很多人被坑过的行为：**执行完一个 case 后，如果没有 `break`，会继续执行下一个 case**，这叫 fall-through。

```cpp
switch (x) {
    case 1:
        std::cout << "one" << std::endl;
        // 没有 break！
    case 2:
        std::cout << "two" << std::endl;
        break;
    case 3:
        std::cout << "three" << std::endl;
        break;
}
```

如果 `x == 1`，输出会是：
```
one
two
```

有时候 fall-through 是故意的：

```cpp
switch (day) {
    case MONDAY:
    case TUESDAY:
    case WEDNESDAY:
    case THURSDAY:
    case FRIDAY:
        std::cout << "工作日" << std::endl;
        break;
    case SATURDAY:
    case SUNDAY:
        std::cout << "周末" << std::endl;
        break;
}
```

这里让多个 case 共享同一个处理逻辑，是合理的用法。

C++17 引入了 `[[fallthrough]]` 属性，可以显式标注你是故意 fall-through，消除编译器警告：

```cpp
switch (x) {
    case 1:
        doSomething();
        [[fallthrough]];  // 告诉编译器：这是故意的
    case 2:
        doSomethingElse();
        break;
}
```

### default 分支

`default` 处理所有没有匹配到的情况，相当于 if-else 里的最后一个 else。养成好习惯：**总是写 default**，哪怕里面只是一个断言或者日志，这样能在调试时捕获意外情况。

## break / continue / return

这三个关键字都能改变控制流，但作用范围不同：

### break

跳出**当前**循环或 switch，执行之后的代码：

```cpp
for (int i = 0; i < 10; i++) {
    if (i == 5) break;  // 跳出 for 循环
    std::cout << i << std::endl;
}
// 输出：0 1 2 3 4
```

注意：break 只跳出**一层**。嵌套循环里，break 只跳出最内层的那个循环。

### continue

跳过当前迭代，直接进入下一次循环：

```cpp
for (int i = 0; i < 10; i++) {
    if (i % 2 == 0) continue;  // 跳过偶数
    std::cout << i << std::endl;
}
// 输出：1 3 5 7 9
```

### return

直接退出**整个函数**，不管当前在多少层循环里：

```cpp
bool findValue(const std::vector<int>& vec, int target) {
    for (int v : vec) {
        if (v == target) return true;  // 找到了，直接退出函数
    }
    return false;
}
```

### 关于频繁使用 break 的一点看法

break 本身没问题，但**在循环中过度依赖 break 来控制流程**会让代码变得难读。读者必须追踪所有可能的退出点，才能理解循环什么时候结束。

比较这两种写法：

```cpp
// 不好：用 break 控制流程
int result = -1;
for (int i = 0; i < n; i++) {
    if (condition1(i)) {
        if (condition2(i)) {
            result = i;
            break;
        }
    }
}

// 更好：提取成函数，用 return 表达意图
int findResult(int n) {
    for (int i = 0; i < n; i++) {
        if (condition1(i) && condition2(i)) {
            return i;
        }
    }
    return -1;
}
```

后者意图更清晰：这个函数就是在找东西，找到了就返回。break 不是不能用，但如果一个循环里有多个 break，通常是个信号——考虑把循环提取成独立的函数。

## 三目运算符

三目运算符（ternary operator）的语法很简单：

```cpp
condition ? expr_if_true : expr_if_false
```

但它和 if-else 有一个本质区别，很多人没意识到：**三目运算符是表达式，if-else 是语句**。

"表达式"的意思是它有返回值，可以出现在任何需要值的地方——变量初始化、函数参数、return 语句。if-else 做不到这一点：

```cpp
// 好：简洁清晰
int abs_val = x >= 0 ? x : -x;
std::string label = score >= 60 ? "pass" : "fail";

// 函数参数中使用
std::cout << (n % 2 == 0 ? "even" : "odd") << '\n';
```

The Cherno 在视频里强调这一点：三目运算符不是 if-else 的缩写，它们解决的是不同层面的问题。当你需要一个**值**，而这个值取决于某个条件时，三目是正确的工具。

### 类型兼容性

两个分支的类型必须兼容，编译器会做隐式转换。`int` 和 `double` 没问题，编译器把结果统一成 `double`；但如果两边类型风马牛不相及，就会报错。这也是为什么偶尔需要显式转换。

### 性能

和等价的 if-else 完全一样，编译器生成的汇编没有区别。选三目还是 if-else，完全是可读性的考量，不是性能的考量。

### 什么时候别用

嵌套三目是可读性杀手：

```cpp
// 坏：嵌套三目，可读性差
int grade = score >= 90 ? 4 : score >= 70 ? 3 : score >= 60 ? 2 : 1;

// 改用 if-else 更清晰
int grade;
if (score >= 90)      grade = 4;
else if (score >= 70) grade = 3;
else if (score >= 60) grade = 2;
else                  grade = 1;
```

规则很简单：如果三目运算符让你的代码**更难一眼看懂**，就换回 if-else。它是工具，不是炫技手段。

## 小结

| 控制结构 | 核心要点 |
|---------|---------|
| if | 本质是判断值是否为零；任何非零值为 true |
| for | 范围 for 遍历容器时用 `const auto&` |
| while | 先判断再执行 |
| do-while | 先执行再判断，保证至少一次 |
| switch | 可生成跳转表，连续整数 case 比 if-else 快 |
| break | 跳出当前一层循环或 switch |
| continue | 跳过当前迭代 |
| return | 退出整个函数 |

控制流是程序的骨架。理解它的底层机制——比如 if 在汇编层面就是比较和跳转，switch 可以用跳转表实现 O(1) 分支——能帮你在写代码时做出更有依据的选择，而不是靠直觉和习惯。

下一篇我们聊聊函数，包括参数传递（值传递 vs 引用传递）和返回值优化（RVO）。
