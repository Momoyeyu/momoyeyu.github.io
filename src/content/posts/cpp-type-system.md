---
title: C++ cast 与 union
date: 2023-11-22
description: 'C++ 四种 cast 的语义差异、reinterpret_cast 的内存重解释，以及 union 在类型转换中的应用。'
tags: [C++, 类型系统]
category: C++ 进阶
episode: 13
draft: false
lang: 'zh_CN'
---

C++ 有四种 cast 运算符，很多人只会用 `(int)x` 这种 C 风格的暴力转换，或者干脆所有情况都用 `static_cast`。但这四种 cast 背后的语义差异非常大——有些在编译期检查，有些在运行期检查，有些根本什么都不做只是骗骗编译器。搞清楚这些差异，对写出正确的底层代码（尤其是 AI Infra 里大量涉及的数值精度转换）至关重要。

---

## 四种 cast：从安全到危险

### `static_cast`：编译期的"合理转换"

`static_cast` 是最常用的一种，它在编译期做类型检查，确保转换是"有意义的"。

```cpp
// 数值类型之间的转换
double d = 3.14;
int i = static_cast<int>(d);  // 截断为 3，合法

// 父类指针 -> 子类指针（向下转型）
class Animal {};
class Dog : public Animal {};

Animal* a = new Dog();
Dog* dog = static_cast<Dog*>(a);  // 编译通过，但不验证运行时类型
```

注意最后这个例子：如果 `a` 实际上指向的不是 `Dog` 对象，`static_cast` 不会告诉你，你拿到的是一个悬空指针，后续行为是未定义行为（UB）。

**使用场景**：数值类型转换、已知安全的继承体系转换、`void*` 和具体类型之间的转换。

---

### `dynamic_cast`：运行期的"安全向下转型"

`dynamic_cast` 专门用于继承体系中的**向下转型**（从父类到子类）。它在运行时检查对象的实际类型：

```cpp
class Animal { virtual void speak() {} };  // 必须有虚函数
class Dog : public Animal {};
class Cat : public Animal {};

Animal* a = new Cat();

Dog* dog = dynamic_cast<Dog*>(a);  // 转型失败，返回 nullptr
if (dog == nullptr) {
    // 走到这里，因为 a 实际上是 Cat
}

Cat* cat = dynamic_cast<Cat*>(a);  // 成功
```

如果转型的目标是引用而不是指针，失败时会抛出 `std::bad_cast` 异常：

```cpp
try {
    Dog& dog = dynamic_cast<Dog&>(*a);  // 抛异常
} catch (const std::bad_cast& e) {
    // 捕获到
}
```

**代价**：`dynamic_cast` 依赖 RTTI（Run-Time Type Information），有运行时开销——它需要在对象的虚函数表里查类型信息。在性能敏感的 hot path 里要谨慎使用。

**使用场景**：你真的不确定对象的动态类型，需要安全地尝试向下转型的时候。

---

### `reinterpret_cast`：告诉编译器"别管类型，直接重解释这块内存"

这是最危险的 cast。它不做任何实际的转换操作——没有任何运行时代码——只是让编译器把某块内存当作另一种类型来解读。

```cpp
int i = 42;
// 把 int* 当作 float* 来用——不做任何转换，直接重新解读内存
float* fp = reinterpret_cast<float*>(&i);
float f = *fp;  // 读出来的是 int 42 的位模式所对应的 float 值
```

这和 C 语言的强制转换 `(float*)&i` 等价，完全由程序员自己负责正确性。

**reinterpret_cast 的本质**：它是纯粹的编译期操作，只改变了编译器对那块内存的"看法"。生成的机器码里，没有任何额外指令——就是把那个地址拿来当别的类型用。

**使用场景**：底层硬件编程、序列化/反序列化、以及下面要讲的 type punning。

---

### `const_cast`：添加或去除 `const`

`const_cast` 是四种 cast 里最窄用途的一个，专门用来添加或去除 `const` 限定符：

```cpp
const int x = 10;
int* px = const_cast<int*>(&x);
*px = 20;  // 危险！x 本身是 const，这是 UB
```

`const_cast` 的合法场景：当你有一个 `const` 指针，但你**确定**它指向的对象不是真正的 const，只是接口声明成 const 的（比如调用某个老 C 库时）。如果底层对象真的是 `const`，通过 `const_cast` 修改它是 UB。

```cpp
// 合法用法：legacy API 要求非 const，但你知道它不会修改
void legacy_print(char* s);  // 老接口
const char* msg = "hello";
legacy_print(const_cast<char*>(msg));  // 只读，不修改，安全
```

---

## Type Punning：把一块内存当两种类型读

Type Punning（类型双关）是一种技巧：同一块内存，用两种不同类型的视角来解读它的位模式。

最典型的例子，也是计算机图形学史上最著名的 hack 之一——**Quake III 的快速平方根倒数**：

```cpp
float Q_rsqrt(float number) {
    long i;
    float x2, y;
    const float threehalfs = 1.5F;

    x2 = number * 0.5F;
    y  = number;
    i  = *(long*)&y;           // type punning：把 float 的位模式当 int 读
    i  = 0x5f3759df - (i >> 1);  // 神奇的魔数，利用 IEEE 754 的指数结构
    y  = *(float*)&i;          // 再把 int 当 float 读回来
    y  = y * (threehalfs - (x2 * y * y));  // 一次牛顿迭代精化结果
    return y;
}
```

这段代码的核心技巧是：IEEE 754 float 的位模式里，指数部分的位移动等价于对数值取对数，所以把 float 的位当 int 来做算术，可以非常廉价地估算平方根倒数。

这是 type punning 最经典的案例，但在现代 C++ 里，`*(long*)&y` 这种写法**在技术上是 UB**。

---

### Strict Aliasing 规则：为什么 reinterpret_cast 是 UB

C++ 有一条**严格别名规则**（strict aliasing rule）：编译器可以假设两个不同类型的指针不会指向同一块内存（除了 `char*` 和 `unsigned char*`）。

这个规则让编译器能做更激进的优化——如果 `float*` 和 `int*` 不可能指向同一块内存，编译器就不需要考虑修改其中一个会影响另一个的情况，可以大胆地重排指令、缓存寄存器。

```cpp
int i = 42;
float* fp = reinterpret_cast<float*>(&i);
*fp = 1.0f;
// 编译器（在开 -O2 的情况下）可能认为 i 还是 42
// 因为 strict aliasing 规则说 int* 和 float* 不会别名
int j = i;  // 可能仍然是 42，而不是 1.0f 的位模式
```

实际上，GCC/Clang 在 `-O2` 下都会执行这种优化，导致这类代码产生非预期的行为。

---

## 用 Union 做 Type Punning

Union 是另一种做 type punning 的方式，所有成员共享同一块内存：

```cpp
union FloatInt {
    float f;
    int   i;
};

FloatInt fi;
fi.f = 1.0f;
int bits = fi.i;  // 读出 float 的位模式：0x3F800000
```

这在 C 语言里是明确合法的。在 C++ 里**技术上是 UB**（C++ 标准不允许写入一个成员后读取另一个），但实际上 GCC 和 Clang 的文档都明确表示他们支持这种用法，MSVC 也是。

所以实践中 union type punning 被广泛使用，但如果你追求严格标准合规，用 C++20 的 `std::bit_cast`。

---

### `std::bit_cast`：C++20 的正确做法

```cpp
#include <bit>

float f = 1.0f;
int i = std::bit_cast<int>(f);  // 安全，合法，无 UB
```

`std::bit_cast` 要求源类型和目标类型大小相同，且都是 trivially copyable 的。它在编译期就能内联，开销和 `memcpy` 一样为零，但语义明确、无 UB。

上面的 Quake 代码用现代 C++ 重写：

```cpp
float Q_rsqrt_modern(float number) {
    float x2 = number * 0.5F;
    float y = number;

    uint32_t i = std::bit_cast<uint32_t>(y);
    i = 0x5f3759df - (i >> 1);
    y = std::bit_cast<float>(i);

    y = y * (1.5F - (x2 * y * y));
    return y;
}
```

---

## Union 的其他用途：节省内存

除了 type punning，union 最自然的用途是**让多个字段共享同一块内存**，大小取最大成员：

```cpp
union Value {
    int   i;
    float f;
    char  s[8];
};
// sizeof(Value) == 8（取 s 的大小）
```

经典应用场景——脚本引擎里的动态值类型：

```cpp
struct DynamicValue {
    enum class Type { Int, Float, String };
    Type type;
    union {
        int   i;
        float f;
        char* s;
    };
};
```

这就是一个简版 tagged union，运行时通过 `type` 字段判断当前存的是什么类型。

---

### `std::variant`：类型安全的 Union（C++17）

`std::variant` 是 tagged union 的标准库替代品——它始终知道自己当前持有的是哪种类型，构造和析构都自动处理，不会出现裸 union 那种"写入 float 却读 int"的静默错误。相比裸 union，它有额外的类型标记存储和访问时的分支开销，因此适合不追求极致性能的场合。对于脚本引擎里的动态值类型、协议解析中的多态字段等场景，它是比手写 tagged union 更安全的选择。

`std::variant` 的完整用法（`std::visit`、`overloaded` 模式、`std::any`）见 [std::optional、variant 与 any](/posts/cpp-optional-variant/)。

---

## AI Infra 场景：fp16/bf16/fp32 的精度转换

这些 cast 技巧在 AI Infra 里几乎无处不在。深度学习模型里大量使用混合精度：

- 权重可能是 fp16 或 bf16
- 激活值可能是 fp32
- 量化模型可能是 int8 甚至 int4

CUDA 里的 `__half`（fp16）类型就是这个问题的典型代表：

```cpp
#include <cuda_fp16.h>

// float -> __half 的转换
float fp32_val = 1.5f;
__half fp16_val = __float2half(fp32_val);

// 底层实现本质上是 type punning
// __half 内部存的是 uint16_t，直接操作位模式
uint16_t bits = *reinterpret_cast<uint16_t*>(&fp16_val);
```

更底层的场景——在 CUDA kernel 里手动做 bf16/fp32 转换（在不支持 bf16 硬件原语的设备上）：

```cpp
// bf16 就是 float32 截断掉低 16 位的尾数
// 所以 fp32 -> bf16 的转换可以直接操作位模式
uint32_t fp32_bits = std::bit_cast<uint32_t>(fp32_val);
uint16_t bf16_bits = static_cast<uint16_t>(fp32_bits >> 16);  // 截断低位

// 反向：bf16 -> fp32，低 16 位补零
uint32_t back = static_cast<uint32_t>(bf16_bits) << 16;
float fp32_back = std::bit_cast<float>(back);
```

这就是为什么搞 AI Infra 的人必须对 type punning 和 union 了然于胸——这些东西每天都在用，不理解的话很容易写出在某些优化级别下行为异常的代码。

另一个场景是**向量化加载**。CUDA 里经常用 `float4`/`int4` 这样的宽类型来一次加载 128 位，然后用 `reinterpret_cast` 把它解读成四个 fp32：

```cpp
// 一次加载 4 个 float，使用向量化指令
float4 vec = *reinterpret_cast<float4*>(ptr);
float a = vec.x, b = vec.y, c = vec.z, d = vec.w;
```

---

## 类型转换运算符

前面讲的都是你主动去"转"某个值——用 cast 语法显式告诉编译器。但 C++ 还允许你在类里定义**转换运算符**，让对象在需要的时候自动变成另一种类型。

### 语法

```cpp
operator TargetType() const { return ...; }
```

注意没有返回类型写在前面，因为返回类型就是 `TargetType` 本身，写了反而多余。

### 隐式转换运算符

定义了转换运算符之后，对象可以在合适的上下文里直接被当成目标类型用：

```cpp
class Fraction {
    int num_, den_;
public:
    Fraction(int n, int d) : num_(n), den_(d) {}

    // 隐式转换为 double
    operator double() const { return (double)num_ / den_; }

    // 显式转换为 bool（是否非零）
    explicit operator bool() const { return num_ != 0; }
};

Fraction f{1, 2};
double d = f;        // OK，隐式调用 operator double()
if (f) { ... }      // OK，explicit operator bool 在条件中允许
// bool b = f;      // 编译错误，explicit 禁止这种隐式转换
```

### 隐式转换的危险

听起来很方便，但隐式转换是一把双刃剑。假设你定义了 `operator int()`，那在某个你完全没预期的地方——比如比较运算、函数重载决议——编译器可能悄悄帮你转了，逻辑 bug 就这么出现了，还不一定有编译警告。

`std::string` 就故意没有提供 `operator const char*()`，必须显式调用 `.c_str()`。这不是懒，而是刻意设计：如果有隐式转换，`std::string` 对象在很多地方会无声地退化成裸指针，造成悬空指针、生命周期问题。

### `explicit` 关键字

给转换运算符加 `explicit`，就只允许显式转换，隐式的通通报错：

```cpp
explicit operator bool() const { return num_ != 0; }
```

加了 `explicit` 之后，以下三种方式合法：

```cpp
static_cast<bool>(f)  // 显式 cast
if (f) { ... }        // if/while 条件——编译器视为显式
bool b = (bool)f;     // C 风格显式 cast
```

但直接隐式用就不行了：

```cpp
bool b = f;  // 编译错误
```

C++ 标准库大量使用这个模式——`std::optional`、`std::shared_ptr`、`std::unique_ptr` 都定义了 `explicit operator bool()`，让你可以写 `if (ptr)` 判空，但不会意外地把智能指针隐式转成 `bool` 然后用在数值运算里：

```cpp
std::optional<int> opt = 42;
if (opt) {           // OK，条件里的 explicit bool 转换
    int v = *opt;
}
// int x = opt + 1;  // 编译错误，不会隐式转成 bool 再转 int
```

### 和 explicit 构造函数的关系

`explicit` 构造函数和 `explicit` 转换运算符是同一问题的两面：

- `explicit` 构造函数：阻止"其他类型 → 本类"的隐式转换
- `explicit` 转换运算符：阻止"本类 → 其他类型"的隐式转换

两者都是在说：我知道这个转换在语义上是有意义的，但我不想让编译器在背后偷偷帮你做，用的时候请明确表达你的意图。

经验法则：除了 `operator bool()` 这种几乎总是 `explicit` 的情况，其他数值类型的转换运算符（`operator int()`、`operator double()`）也应该仔细想想是否真的需要隐式——如果不确定，加 `explicit` 总是更安全的选择。

---

## 总结

| Cast | 检查时机 | 安全性 | 主要用途 |
|------|----------|--------|----------|
| `static_cast` | 编译期 | 较安全 | 数值转换、已知安全的向下转型 |
| `dynamic_cast` | 运行期 | 安全（有开销） | 继承体系中不确定的向下转型 |
| `reinterpret_cast` | 无检查 | 危险 | 内存重解释、底层操作 |
| `const_cast` | 编译期 | 视情况 | 去除/添加 const |

Type punning 的安全选项排名：

1. `std::bit_cast`（C++20）：标准、安全、无开销，首选
2. `memcpy`：标准、安全，编译器通常会优化掉实际拷贝
3. Union（GCC/Clang 扩展）：几乎所有编译器都支持，但技术上是 UB
4. `reinterpret_cast`：违反 strict aliasing，可能在高优化级别下出问题

写底层 C++ 的一个基本原则：能用 `static_cast` 就不用 `reinterpret_cast`，能用 `std::bit_cast` 就不手写 union。危险的工具不是不能用，但要清楚地知道自己在做什么、潜在的 UB 是什么、以及你的编译器保证了什么。
