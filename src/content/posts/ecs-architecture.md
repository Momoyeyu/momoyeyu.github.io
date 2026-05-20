---
title: ECS 架构
published: 2026-05-14
description: '从游戏引擎到 AI Infra，理解 ECS 背后的数据导向设计思想。'
tags: [C++, 性能, AI Infra]
category: 随笔
draft: false
lang: 'zh_CN'
---

最近工作中接触到一个号称用了 ECS 架构的项目，翻了翻代码——组件里全是方法，处理器带着状态，和我理解的 ECS 差得有点远。想起之前看 The Cherno 的 Hazel 系列时讲过正经的 ECS 是怎么回事，于是回去重新看了一遍，顺便把这套东西理清楚。

## 一句话版本

**实体是 ID，组件是纯数据，系统是纯逻辑。**

- **Entity**：一个 `uint32_t`，没有数据没有方法，就是个标识符。类比数据库里的主键。
- **Component**：只有字段的结构体，没有方法。类比数据库里的一张表。
- **System**：无状态的函数，按组件签名查询并批量处理。类比业务层的 Service。

```cpp
using Entity = uint32_t;

struct Position { float x, y; };
struct Velocity { float dx, dy; };
struct Health   { int hp; };

void MovementSystem(World& world, float dt) {
    for (auto [entity, pos, vel] : world.view<Position, Velocity>()) {
        pos.x += vel.dx * dt;
        pos.y += vel.dy * dt;
    }
}
```

System 不关心"这是什么东西"，只关心"这个东西有没有我需要的组件"。
这是 ECS 最核心的思维转换：**不再问"是什么"，只问"有什么"。**

## 为什么要这么搞

传统 OOP 在游戏引擎里会撞两堵墙。

### 继承爆炸

你要做一个"会飞的敌人"，再做一个"会游泳的敌人"，再来一个"会飞会游泳还会喷火的 Boss"。继承树开始失控，多重继承带来菱形继承，接口和 Mixin 都不够干净。

Unity 的 `GameObject + MonoBehaviour` 用组合代替继承，解决了这个问题。但 MonoBehaviour 里面有方法（`Update()`、`Start()`），数据和行为还是绑在一起，内存还是散的。
这也是 Unity 后来搞 DOTS 的原因——MonoBehaviour 那套不是 ECS，顶多算 Component-Oriented。

ECS 是组合优于继承的终极形态：继承层级为零，"是什么"的判断全部变成"有没有这些组件"，运行时能力可加可减。

### Cache miss

这是更硬核的问题。OOP 场景里对象散落在堆上各处：

```cpp
std::vector<GameObject*> objects;
for (auto* obj : objects) {
    obj->Update(ts);  // 跳到堆上某个随机位置
}
```

每个对象的位置是随机的，`Update` 里访问 `transform.position` 又是一次指针跳转。一万个对象遍历下来，CPU cache 基本废了——L1 cache miss ~10ns，L2 ~30ns，主存 ~100ns。一帧 16ms 的预算，全花在等内存上。

ECS 的做法是同类组件在内存里连续存放：

```
OOP（对象散落在堆上）:
heap:[Player]  heap:[Enemy]  heap:[Bullet] ...

ECS（组件紧凑排列）:
Position 数组: [P0][P1][P2][P3][P4][P5] ...  ← 连续内存
Velocity 数组: [V0][V1][V2][V3][V4][V5] ...  ← 连续内存
```

CPU 一次预取就能把好几个 Position 拖进 cache line（64B），下一次迭代直接命中。
这就是 ECS 在十万子弹的 bullet hell 游戏里能稳 144 帧的根本原因。

## 一个完整的例子

在 ECS 里不再定义"Player 类"或"Enemy 类"，而是用组件组合来描述实体：

| 实体 | 组件 |
| --- | --- |
| 玩家 | Position + Velocity + Health + PlayerInput + Sprite + Collider |
| 敌人 | Position + Velocity + Health + AI + Sprite + Collider |
| 子弹 | Position + Velocity + Damage + Sprite + Collider + Lifetime |
| 墙 | Position + Sprite + Collider |

系统各司其职：

- **InputSystem**：查询 `PlayerInput + Velocity`，把按键转成速度
- **AISystem**：查询 `AI + Velocity + Position`，决定敌人怎么动
- **MovementSystem**：查询 `Position + Velocity`，做位置更新——不管是玩家、敌人还是子弹，一视同仁
- **CollisionSystem**：查询 `Position + Collider`，检测碰撞
- **DamageSystem**：处理碰撞中的 `Health + Damage`，扣血、判定死亡
- **RenderSystem**：查询 `Position + Sprite`，画到屏幕上

MovementSystem 不区分实体类型，所有拥有 Position 和 Velocity 的实体在一个紧密循环里全部处理完。**同质化批处理就是性能的来源。**

运行时修改也很自然：想让一个敌人"冰冻住"？`registry.emplace<Frozen>(entity)` 一行。MovementSystem 加一个过滤条件排除 Frozen 即可，不用在 Enemy 类里加 `bool isFrozen` 然后到处 if。

## OOP vs CO vs ECS

这三者最容易搞混。

**纯 OOP**——数据和行为绑在类里，继承爆炸，对象散落堆上，cache 不友好。

**Unity 的 Component-Oriented**——组合代替继承，解决了继承爆炸。但 Component 里有方法，数据和行为没有彻底分离，内存布局依然不连续。

**ECS**——组件纯数据，系统纯逻辑，彻底分离。同类组件内存连续，cache 友好，天然可并行。

Cherno 在 Hazel 里用的 entt 就是真正的 ECS。他专门讲过为什么换掉原来的 GameObject 设计，值得看。

## 背后的工程思想

ECS 让我真正感兴趣的不是游戏引擎本身，而是它背后的几个思想。这些思想和后端、基础设施领域高度同构。

### 存算分离

Component Pool 是存储层，System 是计算层，Entity Registry 是元数据层。System 无状态、可独立扩展、可热替换。
这和 Snowflake、Databricks 的云原生存算分离架构是一回事。

### 数据导向设计

Mike Acton 在 CppCon 2014 那个著名演讲里的核心论点：**程序的本质是数据变换。先问数据长什么样、怎么访问，再设计代码结构。**

ECS 把 AoS vs SoA 的选择推到了极致——每种组件就是一个 SoA 列，遍历时连续访问，cache line 利用率拉满。

类比后端：**列式存储 vs 行式存储**。ClickHouse、DuckDB 用列存就是这个道理——当你只关心几个字段时，按列连续存放吞吐量暴涨。ECS 就是把列存思想搬到了运行时内存。

### 关系代数

`world.view<A, B, C>()` 本质是一次关系连接：

```sql
SELECT entity_id, A, B, C
FROM entities
WHERE entity HAS A AND HAS B AND HAS C
```

每种组件就是一张表，实体 ID 是主键。entt 的查询优化器会挑最小的组件池作为驱动表——小表驱动大表，和数据库优化器一个思路。

Archetype 实现（Unity DOTS、Bevy）更激进：把拥有相同组件集合的实体打包成内存块，查询直接定位到块上，零分支遍历。类比的话，这就是物化视图。

### 局部性原理

冯·诺依曼架构最大的瓶颈是内存墙。ECS 在三个维度上贴合了局部性：

- **时间局部性**：System 在一个 tick 内连续访问同类组件
- **空间局部性**：同类组件内存连续
- **算法局部性**：相似逻辑聚合在同一个 System 内

OOP 在这三点上几乎全输——虚函数调用打断分支预测，对象散落堆上打断空间局部性，多态分发打断算法局部性。

### 显式依赖

ECS 强迫你显式声明 System 要查询哪些组件。这带来两个能力：

- **依赖图可静态分析** → 自动并行调度（Bevy 的调度器就是这么做的）
- **副作用可追踪** → 哪个 System 读写哪个组件一目了然

和 React Hooks 的 deps 数组、Rust 的借用检查是同一种思路。

## 和 AI Infra 的关系

| ECS 思想 | AI Infra / 后端的同构概念 |
| --- | --- |
| 数据行为分离 | 无状态服务 + 独立存储 |
| 数据导向设计 | 列式存储、向量化执行引擎 |
| 存算分离 | Snowflake、Databricks 架构 |
| 组件查询 | 关系代数 join、物化视图 |
| 局部性原理 | CPU cache 优化、向量化数据库 |
| 批处理 | 向量化执行、SIMD、GPU compute |

一句话浓缩：ECS 是"列式存储 + 无状态计算 + 关系查询"三位一体在运行时内存中的实现。
它本质上是把数据库领域几十年的经验——存算分离、列存、向量化、DAG 调度——借到了游戏引擎和实时系统中。

对我来说，理解 ECS 的收获不在于学会了一个游戏引擎的设计模式，而在于它让我更直觉地理解了为什么 CUDA kernel 要连续访存、为什么推理引擎要做 batching、为什么高性能系统都在避免 OOP。这些东西的底层逻辑是相通的。

## 适用场景与代价

**适合**：大量同质对象 + 性能敏感。游戏引擎是典型（粒子系统、bullet hell、大规模单位），模拟、实时数据处理也用得上。

**代价**：
- 调试比 OOP 难——实体状态分散在 N 个组件池里，需要编辑器聚合查看
- 思维转换成本高
- 小规模、业务逻辑多变的系统可能过度工程

所以主流引擎都是混合架构：Unreal 用 Actor + Component 为主，Niagara 粒子系统才走 ECS 思路；Unity 主流还是 GameObject，DOTS 作为高性能场景的补充。

另外，实际工作中见过不少自称"ECS 架构"的系统，组件里塞满了方法，处理器带着一堆状态，执行顺序是硬编码的 pipeline——三条核心约束一条没守。不是说不好用，但严格来说那叫 Component-Oriented，不叫 ECS。
