---
title: 从零理解 PPO
date: 2026-10-05
description: 本文以 PPO 为目标，从马尔可夫决策过程、价值函数、策略梯度讲起，经过 Actor-Critic、GAE 与信任域，最终理解 PPO 以及它在 LLM 的 RLHF 中的用法。
tags: [LLM, 强化学习, PPO]
category: LLM
episode: 4
draft: true
lang: zh_CN
---

# 前言

在 LLM 的训练流程中，预训练和 SFT 之后通常还有一个对齐阶段。[InstructGPT](https://arxiv.org/abs/2203.02155) 所采用的 RLHF（Reinforcement Learning from Human Feedback）正是这一阶段的经典方案，而它所使用的优化算法就是 [PPO](https://arxiv.org/abs/1707.06347)（Proximal Policy Optimization）。

PPO 本身并不复杂，但它建立在一整套强化学习概念之上：策略、回报、价值函数、优势函数、策略梯度、重要性采样……如果跳过这些基础，直接去读 PPO 的目标函数，很容易只记住一个 `clip`，却不理解它为什么长这样。

因此，本文将以 PPO 为学习目标，从零开始梳理这条路线：

$$
\text{MDP}
\rightarrow
\text{价值函数}
\rightarrow
\text{策略梯度}
\rightarrow
\text{Actor-Critic}
\rightarrow
\text{信任域}
\rightarrow
\text{PPO}
\rightarrow
\text{RLHF}.
$$

每一步都只引入“下一步必须用到”的概念，并配上可以直接运行的代码。文中的全部代码已整理进开源仓库 [small-language-model](https://github.com/Momoyeyu/small-language-model) 的 PPO 模块，包含按章节编号的演示脚本、完整的训练脚本以及覆盖每一条结论的测试，可以配合本文一起阅读。

# 为什么需要强化学习

监督学习的前提是：每个输入都有一个“正确答案”。模型只需要让自己的输出尽量接近标签即可。但很多问题并不满足这个前提：

1. **没有标准答案，只有好坏评价**。下棋时，没有人能告诉你每一步的“正确走法”，只能在终局知道输赢；
2. **决策是连续的**。当前的动作会改变之后看到的局面，进而影响后续所有决策；
3. **奖励是延迟的**。一局棋输了，很难直接判断是哪一步导致的，这就是所谓的信用分配（credit assignment）问题。

强化学习（Reinforcement Learning，RL）研究的正是这一类问题：智能体（agent）在环境（environment）中不断做出动作，环境给出反馈（奖励），智能体的目标是学会一个策略，使长期累积的奖励最大。

LLM 同样面临这样的问题。SFT 本质上是监督学习：给定 prompt 和人工撰写的回答，最大化回答的似然。但对于“什么样的回答更好”，人类往往更容易给出比较，而不是写出一个标准答案；而且一个回答的好坏通常要看完整个回答才能判断，无法落实到每一个 token 上。

> **能否只告诉模型“这个回答比那个好”，就让它学会生成更好的回答？**

这正是强化学习擅长的问题形式，也是 RLHF 的出发点。在进入 RLHF 之前，我们先从强化学习最基本的数学框架开始。

# 马尔可夫决策过程

强化学习通常用**马尔可夫决策过程**（Markov Decision Process，MDP）来描述智能体与环境的交互。一个 MDP 由以下要素组成：

* **状态** $s \in \mathcal{S}$：环境当前的情况，例如棋盘局面；
* **动作** $a \in \mathcal{A}$：智能体可以做出的选择；
* **状态转移** $P(s' \mid s, a)$：在状态 $s$ 下执行动作 $a$ 后，转移到状态 $s'$ 的概率；
* **奖励** $r(s, a)$：执行动作后环境给出的即时反馈；
* **折扣因子** $\gamma \in [0, 1]$：衡量未来奖励相对于当前奖励的重要程度。

“马尔可夫”指的是：下一个状态只取决于当前状态和动作，而与更早的历史无关，即 $P(s_{t+1} \mid s_t, a_t, s_{t-1}, \dots) = P(s_{t+1} \mid s_t, a_t)$。

这些要素构成了一个不断循环的交互过程：

![agent-env](/img/posts/llm-ppo/agent-env.svg)

智能体的行为由**策略**（policy） $\pi(a \mid s)$ 描述，它给出在状态 $s$ 下选择各个动作的概率。与环境交互时，智能体从初始状态 $s_0$ 出发，按照策略采样动作 $a_0 \sim \pi(\cdot \mid s_0)$，环境给出奖励 $r_0$ 并转移到 $s_1$，如此往复，直到回合（episode）结束。这一串交互记录称为**轨迹**（trajectory）：

$$
\tau = (s_0, a_0, r_0, s_1, a_1, r_1, \dots, s_{T-1}, a_{T-1}, r_{T-1}),
$$

其中 $T$ 是回合长度。

## 回报与折扣

智能体关心的不是某一步的即时奖励，而是从当前时刻开始的累积奖励，称为**回报**（return）：

$$
G_t
=
r_t + \gamma r_{t+1} + \gamma^2 r_{t+2} + \cdots
=
\sum_{k=0}^{T-t-1} \gamma^k r_{t+k}.
$$

折扣因子 $\gamma$ 有两个作用：一是让无限长的回报保持有限；二是表达“越远的奖励越不确定、越不重要”的偏好。$\gamma$ 越接近 1，智能体越“有远见”；$\gamma = 0$ 时，智能体只关心眼前的奖励。

回报满足一个简单的递推关系：

$$
G_t = r_t + \gamma G_{t+1},
$$

这意味着我们可以从轨迹的末尾倒序计算所有时刻的回报，只需一次遍历。后文的价值函数、GAE 都会反复用到这种“倒序递推”的写法。

强化学习的目标就是找到一个策略，使期望回报最大：

$$
\pi^* = \arg\max_{\pi} \; \mathbb{E}_{\tau \sim \pi}\left[ G_0 \right].
$$

## 代码示例

本文的代码只依赖 PyTorch，所有代码块共用下面的导入（完整可运行的版本见 [small-language-model](https://github.com/Momoyeyu/small-language-model)）：

```python
import copy
import math
import random

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.distributions import Categorical
```

本文的实验环境是经典的 CartPole：一根杆子通过铰链连在小车上，小车可以在一条有限长的轨道上左右移动，目标是让杆子尽量长时间不倒。

![cartpole](/img/posts/llm-ppo/cartpole.svg)

对应到 MDP 的各个要素：

* **状态**：一个 4 维向量，依次为小车位置、小车速度、杆子倾角和杆子角速度，每个回合开始时都在 0 附近随机初始化；
* **动作**：$\{0, 1\}$，表示向左或向右给小车施加一个固定大小的力；
* **奖励**：每坚持一步奖励为 1，因此回报就是坚持的步数；
* **状态转移**：由小车与杆子的力学方程决定，每一步推进 0.02 秒，对智能体来说是未知的；
* **回合结束**：杆子倾角超过 12° 或小车位置超出 ±2.4 时任务失败，坚持满 500 步时被强制截断。

环境对外只暴露两个接口：`reset()` 返回初始状态；`step(action)` 返回 `(next_state, reward, terminated, truncated)`。其中 `terminated` 表示任务本身失败，`truncated` 表示达到了最大步数被强制截断。二者在语义上不同：被截断时，智能体本可以继续获得奖励，这个区别在后面计算价值时会再次出现。

我们手写了这个环境，物理参数与 [Gymnasium](https://gymnasium.farama.org/environments/classic_control/cart_pole/) 中的实现一致，完整代码见开源仓库中的 [envs/cartpole.py](https://github.com/Momoyeyu/small-language-model/blob/master/envs/cartpole.py)。对于理解后面的算法而言，知道上面这些规则就足够了。

有了环境，就可以用任意策略采样一条轨迹，并按前面的递推式倒序计算回报：

```python
def discounted_returns(rewards: list[float], gamma: float) -> list[float]:
    returns, G = [], 0.0
    for r in reversed(rewards):
        G = r + gamma * G
        returns.append(G)
    return returns[::-1]


def rollout(env: CartPole, policy) -> tuple[list[list[float]], list[int], list[float]]:
    states, actions, rewards = [], [], []
    s, done = env.reset(), False
    while not done:
        a = policy(s)
        s_next, r, terminated, truncated = env.step(a)
        states.append(s)
        actions.append(a)
        rewards.append(r)
        s, done = s_next, terminated or truncated
    return states, actions, rewards
```

用均匀随机的策略跑一下：

```python
env = CartPole()                      # 来自仓库中的 envs/cartpole.py
states, actions, rewards = rollout(env, lambda s: random.randint(0, 1))
len(rewards)                          # 随机策略平均只能坚持约 22 步
discounted_returns([1.0, 0.0, 2.0, 3.0], 0.9)  # [4.807, 4.23, 4.7, 3.0]
```

随机策略平均只能坚持约 22 步，而一直向右推的策略平均只能坚持约 9 步。接下来的所有内容，都是为了回答同一个问题：如何从交互数据中学出一个能坚持 500 步的策略。

# 价值函数

回报 $G_t$ 是一个随机变量：同样的状态，由于策略和环境的随机性，每次得到的回报都可能不同。为了评价“一个状态有多好”，我们需要对回报取期望，这就是**价值函数**（value function）。

**状态价值函数** $V^\pi(s)$ 表示从状态 $s$ 出发、之后一直按照策略 $\pi$ 行动时的期望回报：

$$
V^\pi(s) = \mathbb{E}_\pi\left[ G_t \mid s_t = s \right].
$$

**动作价值函数** $Q^\pi(s, a)$ 表示在状态 $s$ 下先执行动作 $a$，之后再按照 $\pi$ 行动时的期望回报：

$$
Q^\pi(s, a) = \mathbb{E}_\pi\left[ G_t \mid s_t = s, a_t = a \right].
$$

二者的关系很直接：$V^\pi(s)$ 是 $Q^\pi(s, a)$ 按照策略对动作取平均的结果，即 $V^\pi(s) = \mathbb{E}_{a \sim \pi(\cdot \mid s)}\left[ Q^\pi(s, a) \right]$。

## 贝尔曼方程

把回报的递推式 $G_t = r_t + \gamma G_{t+1}$ 代入价值函数的定义，就得到了**贝尔曼方程**（Bellman equation）：

$$
V^\pi(s)
=
\mathbb{E}_{a \sim \pi(\cdot \mid s),\, s' \sim P(\cdot \mid s, a)}
\left[
r(s, a) + \gamma V^\pi(s')
\right].
$$

同理，动作价值函数满足：

$$
Q^\pi(s, a)
=
\mathbb{E}_{s' \sim P(\cdot \mid s, a)}
\left[
r(s, a) + \gamma V^\pi(s')
\right].
$$

贝尔曼方程的含义是：**一个状态的价值，等于即时奖励加上下一个状态的折扣价值**。它把“对整条未来轨迹求期望”这个困难的问题，转化成了“只看一步”的递推关系。当环境的转移概率已知时，可以反复用右边更新左边，直到收敛，这就是**策略评估**（policy evaluation）。

当转移概率未知时，还可以直接采样大量轨迹，用回报的样本均值估计价值，这就是**蒙特卡洛**（Monte Carlo，MC）估计。两种方法殊途同归，但后者不需要知道环境模型，这一点对后文至关重要。

## 优势函数

有了 $V$ 和 $Q$，就可以回答一个更细的问题：

> **在状态 $s$ 下，动作 $a$ 比“平均水平”好多少？**

这就是**优势函数**（advantage function）：

$$
A^\pi(s, a) = Q^\pi(s, a) - V^\pi(s).
$$

由于 $V^\pi(s)$ 是 $Q^\pi(s, a)$ 在策略下的平均，优势函数在策略下的期望恒为零：$\mathbb{E}_{a \sim \pi}\left[ A^\pi(s, a) \right] = 0$。$A > 0$ 说明这个动作好于平均，应该更多地选择它；$A < 0$ 则相反。优势函数是本文的核心概念之一，从策略梯度到 PPO，所有的更新方向本质上都由它决定。

## 代码示例

CartPole 的状态是连续的，无法枚举，因此我们换一个经典的小例子来验证上面的公式：[Sutton & Barto](http://incompleteideas.net/book/the-book-2nd.html) 书中的**随机游走**（random walk）。一条链上有 A 到 E 五个非终止状态，两端各有一个终止状态；智能体从中间的 C 出发，每一步以 1/2 的概率向左或向右移动，到达右端终止状态时获得奖励 1，其他情况奖励均为 0。

在 $\gamma = 1$ 下，状态的价值就是“最终从右端离开的概率”，其解析解为 $V(A), \dots, V(E) = \frac{1}{6}, \frac{2}{6}, \dots, \frac{5}{6}$。我们分别用贝尔曼方程迭代和蒙特卡洛采样来求它：

```python
N_STATES = 7  # 0 与 6 为终止状态，1..5 对应 A..E


def walk_step(s: int) -> tuple[int, float]:
    s_next = s + random.choice([-1, 1])
    return s_next, 1.0 if s_next == N_STATES - 1 else 0.0


def policy_evaluation(gamma: float = 1.0, tol: float = 1e-10) -> list[float]:
    V = [0.0] * N_STATES
    while True:
        delta = 0.0
        for s in range(1, N_STATES - 1):
            v_new = 0.0
            for s_next in (s - 1, s + 1):
                r = 1.0 if s_next == N_STATES - 1 else 0.0
                v_new += 0.5 * (r + gamma * V[s_next])
            delta = max(delta, abs(v_new - V[s]))
            V[s] = v_new
        if delta < tol:
            return V


def monte_carlo(num_episodes: int, gamma: float = 1.0) -> list[float]:
    total, count = [0.0] * N_STATES, [0] * N_STATES
    for _ in range(num_episodes):
        s, states, rewards = N_STATES // 2, [], []
        while 0 < s < N_STATES - 1:
            s_next, r = walk_step(s)
            states.append(s)
            rewards.append(r)
            s = s_next
        for s, G in zip(states, discounted_returns(rewards, gamma)):
            total[s] += G
            count[s] += 1
    return [t / c if c else 0.0 for t, c in zip(total, count)]
```

`policy_evaluation` 直接利用已知的转移概率做贝尔曼更新，`monte_carlo` 则只通过与环境交互得到的样本估计价值。运行结果：

```python
V = policy_evaluation()   # [0, 0.1667, 0.3333, 0.5, 0.6667, 0.8333, 0]
monte_carlo(10000)        # [0, 0.165, 0.328, 0.491, 0.659, 0.83, 0]，误差 < 0.01

# 在 C 处向右的优势：Q(C, 右) = 0 + V(D)
V[4] - V[3]               # A(C, 右) = +1/6
V[2] - V[3]               # A(C, 左) = -1/6
```

贝尔曼迭代精确收敛到解析解，蒙特卡洛估计在 10000 个回合后误差也已小于 0.01。两个动作的优势一正一负、互为相反数，在均匀策略下平均恰好为零，与上一节的性质一致。

# 策略梯度

有了价值函数，一种自然的思路是：先估计出每个动作的价值，再选价值最大的动作。这类方法称为**基于价值**（value-based）的方法，代表作是 Q-learning 与 DQN。但 PPO 走的是另一条路：**直接把策略参数化，然后用梯度上升优化它**。

用参数为 $\theta$ 的神经网络表示策略 $\pi_\theta(a \mid s)$，它输入状态，输出各个动作的概率分布。优化目标是期望回报：

$$
J(\theta) = \mathbb{E}_{\tau \sim \pi_\theta}\left[ R(\tau) \right],
\quad
R(\tau) = \sum_{t=0}^{T-1} \gamma^t r_t.
$$

这类方法称为**策略梯度**（policy gradient）方法。相比基于价值的方法，它天然支持随机策略和连续动作空间，并且优化目标就是我们真正关心的回报。对 LLM 而言，策略就是语言模型本身——它本来就是一个输出下一个 token 概率分布的网络。

## 策略梯度定理

问题在于：$J(\theta)$ 是对轨迹分布求期望，而轨迹分布既依赖策略 $\pi_\theta$，也依赖未知的环境转移 $P$。如何对它求梯度？

一条轨迹出现的概率为：

$$
p_\theta(\tau)
=
p(s_0)
\prod_{t=0}^{T-1}
\pi_\theta(a_t \mid s_t)
P(s_{t+1} \mid s_t, a_t).
$$

对 $J(\theta)$ 求梯度，并利用 $\nabla_\theta p_\theta = p_\theta \nabla_\theta \log p_\theta$ 这一恒等式（称为 log-derivative trick）：

$$
\nabla_\theta J(\theta)
=
\int \nabla_\theta p_\theta(\tau) R(\tau) \, d\tau
=
\int p_\theta(\tau) \nabla_\theta \log p_\theta(\tau) R(\tau) \, d\tau
=
\mathbb{E}_{\tau \sim \pi_\theta}
\left[
\nabla_\theta \log p_\theta(\tau) R(\tau)
\right].
$$

关键在于 $\log p_\theta(\tau)$ 展开后，$p(s_0)$ 和 $P(s_{t+1} \mid s_t, a_t)$ 都与 $\theta$ 无关，求梯度时直接消失：

$$
\nabla_\theta \log p_\theta(\tau)
=
\sum_{t=0}^{T-1}
\nabla_\theta \log \pi_\theta(a_t \mid s_t).
$$

于是：

$$
\nabla_\theta J(\theta)
=
\mathbb{E}_{\tau \sim \pi_\theta}
\left[
\sum_{t=0}^{T-1}
\nabla_\theta \log \pi_\theta(a_t \mid s_t) \, R(\tau)
\right].
$$

这就是**策略梯度定理**的一种形式。它最重要的意义在于：**梯度中不含环境模型**。我们不需要知道环境如何转移，只需要用当前策略采样轨迹，就能得到梯度的无偏估计。

还可以做一个简化：$t$ 时刻的动作不可能影响 $t$ 时刻之前的奖励，因此可以把 $R(\tau)$ 换成从 $t$ 时刻开始的回报 $G_t$（reward-to-go），这不改变梯度的期望，却去掉了与该动作无关的噪声：

$$
\nabla_\theta J(\theta)
=
\mathbb{E}_{\tau \sim \pi_\theta}
\left[
\sum_{t=0}^{T-1}
\nabla_\theta \log \pi_\theta(a_t \mid s_t) \, G_t
\right].
$$

严格来说，折扣情形下还应有一个 $\gamma^t$ 系数，但实践中几乎总是省略它，这相当于更平等地对待轨迹中的每一步，引入的偏差通常可以接受。

这个公式的直觉非常清晰：$\nabla_\theta \log \pi_\theta(a_t \mid s_t)$ 是“提高动作 $a_t$ 概率”的方向，$G_t$ 是这个方向的权重。回报高的动作被加强，回报低的动作被削弱。

## REINFORCE

直接用采样估计上面的期望，就得到了最经典的策略梯度算法 [REINFORCE](https://link.springer.com/article/10.1007/BF00992696)：

1. 用当前策略 $\pi_\theta$ 采样一条完整轨迹；
2. 倒序计算每一步的回报 $G_t$；
3. 以 $\sum_t \nabla_\theta \log \pi_\theta(a_t \mid s_t) \, G_t$ 为梯度更新 $\theta$。

在代码中，通常构造一个“伪损失”，让自动微分替我们算出这个梯度：

$$
\mathcal{L}(\theta)
=
-\frac{1}{T}
\sum_{t=0}^{T-1}
\log \pi_\theta(a_t \mid s_t) \, G_t.
$$

注意这里的 $G_t$ 被当作常数，不参与求导。这个“损失”本身的数值没有意义，它只是一个梯度恰好等于 $-\nabla_\theta J$ 的函数。

REINFORCE 的问题在于**方差很大**。$G_t$ 是整条轨迹后续所有随机性的累积，同一个状态下同一个动作，两次采样得到的 $G_t$ 可能相差悬殊。更糟糕的是，在 CartPole 这样奖励恒为正的环境中，所有动作的 $G_t$ 都是正数，因此每个被采样到的动作都会被“加强”，只是加强的程度不同。梯度方向要靠大量样本才能平均出来。

## 基线

降低方差的经典方法是引入一个**基线**（baseline） $b(s_t)$，把权重从 $G_t$ 换成 $G_t - b(s_t)$：

$$
\nabla_\theta J(\theta)
=
\mathbb{E}_{\tau \sim \pi_\theta}
\left[
\sum_{t=0}^{T-1}
\nabla_\theta \log \pi_\theta(a_t \mid s_t)
\left( G_t - b(s_t) \right)
\right].
$$

> **减去一个基线，会不会改变梯度的期望？**

不会，只要基线只依赖状态、不依赖动作。因为对任意状态 $s$：

$$
\mathbb{E}_{a \sim \pi_\theta}
\left[
\nabla_\theta \log \pi_\theta(a \mid s) \, b(s)
\right]
=
b(s)
\sum_a \pi_\theta(a \mid s) \nabla_\theta \log \pi_\theta(a \mid s)
=
b(s)
\nabla_\theta \sum_a \pi_\theta(a \mid s)
=
b(s) \nabla_\theta 1
=
0.
$$

也就是说，基线项的期望恒为零，它不引入偏差，却能显著降低方差。一个很好的基线选择是状态价值 $V(s_t)$：此时 $G_t - V(s_t)$ 衡量的是“这次的实际回报比该状态的平均回报好多少”，好于平均的动作被加强，差于平均的被削弱——这正是上一节的**优势函数**的一个采样估计。

实际中 $V(s)$ 未知，因此用另一个神经网络 $V_\phi(s)$ 来拟合它，以回报 $G_t$ 为回归目标：

$$
\mathcal{L}_V(\phi)
=
\frac{1}{T}
\sum_{t=0}^{T-1}
\left( V_\phi(s_t) - G_t \right)^2.
$$

至此，策略梯度可以写成一个统一的形式：

$$
\nabla_\theta J(\theta)
=
\mathbb{E}
\left[
\sum_{t}
\nabla_\theta \log \pi_\theta(a_t \mid s_t) \, \Psi_t
\right],
$$

其中权重 $\Psi_t$ 可以是 $G_t$、$G_t - V(s_t)$，也可以是 $Q^\pi(s_t, a_t)$ 或 $A^\pi(s_t, a_t)$。后文的所有改进，本质上都是在寻找一个**偏差更小、方差也更小**的 $\Psi_t$。

## 代码示例

策略网络与价值网络都用一个两层的 MLP。策略网络输出 logits，再包装成 `Categorical` 分布，这样采样和计算 $\log \pi_\theta(a \mid s)$ 都很方便：

```python
def mlp(in_dim: int, out_dim: int, hidden: int = 64) -> nn.Sequential:
    return nn.Sequential(
        nn.Linear(in_dim, hidden), nn.Tanh(),
        nn.Linear(hidden, hidden), nn.Tanh(),
        nn.Linear(hidden, out_dim),
    )


class Policy(nn.Module):
    def __init__(self, obs_dim: int, n_actions: int) -> None:
        super().__init__()
        self.net = mlp(obs_dim, n_actions)

    def forward(self, obs: torch.Tensor) -> Categorical:
        # obs: [B, obs_dim]
        return Categorical(logits=self.net(obs))  # logits: [B, n_actions]
```

带基线的 REINFORCE 每采样一个完整回合就更新一次，`use_baseline=False` 时退化为原始的 REINFORCE：

```python
def reinforce(
    env: CartPole,
    num_episodes: int = 1000,
    gamma: float = 0.99,
    lr: float = 1e-3,
    use_baseline: bool = True,
    device: str = "cpu",
) -> list[float]:
    policy = Policy(env.obs_dim, env.n_actions).to(device)
    value = mlp(env.obs_dim, 1).to(device)
    pi_opt = torch.optim.Adam(policy.parameters(), lr=lr)
    v_opt = torch.optim.Adam(value.parameters(), lr=lr)

    def act(s: list[float]) -> int:
        with torch.no_grad():
            return policy(torch.tensor(s, device=device)).sample().item()  # s: [obs_dim] -> int

    history = []
    for _ in range(num_episodes):
        states, actions, rewards = rollout(env, act)
        obs = torch.tensor(states, device=device)                        # [T, 4]
        acts = torch.tensor(actions, device=device)                      # [T]
        G = torch.tensor(discounted_returns(rewards, gamma), device=device)  # [T]

        if use_baseline:
            b = value(obs).squeeze(-1)                                   # [T]
            v_loss = F.mse_loss(b, G)
            v_opt.zero_grad()
            v_loss.backward()
            v_opt.step()
            weight = G - b.detach()
        else:
            weight = G

        log_prob = policy(obs).log_prob(acts)                            # [T]
        pi_loss = -(log_prob * weight).mean()
        pi_opt.zero_grad()
        pi_loss.backward()
        pi_opt.step()
        history.append(sum(rewards))
    return history
```

有两个容易出错的细节。第一，`weight = G - b.detach()` 中的 `detach()` 不能省略：基线只是一个常数权重，如果不截断梯度，策略损失的梯度会流进价值网络，破坏基线“不依赖动作”的前提。第二，采样时要放在 `torch.no_grad()` 下，否则每一步都会构建一张用不到的计算图。

在 CartPole 上用 3 个随机种子各训练 1000 个回合：带基线的版本最后 100 个回合的平均回报达到 477 到 499，已经接近 500 步的上限；去掉基线后，结果在不同种子之间差异很大：我们在 CPU、CUDA 与 MPS 上共跑了 9 次，只有 2 次超过 470，其余 7 次都停留在 110 到 190 之间。这种“有时能学会、有时学不会”的不稳定，正是高方差的直接体现。

但带基线的 REINFORCE 为此消耗了超过 30 万步的环境交互，而且每条轨迹只被使用一次就丢弃了。这就引出了后文要解决的两个问题：如何进一步降低方差，以及如何更充分地利用每一批数据。

# Actor-Critic

带基线的 REINFORCE 已经同时拥有了两个网络：一个负责选动作的策略网络，一个负责评价状态的价值网络。这种结构称为 **Actor-Critic**：Actor（演员）即策略 $\pi_\theta$，Critic（评论家）即价值函数 $V_\phi$。

但 REINFORCE 仍有一个根本限制：它的权重 $G_t$ 必须等到回合结束才能算出来，而且包含了整条轨迹后续的全部随机性。Actor-Critic 方法的核心改进是：**让 Critic 不仅作为基线，还参与估计回报本身**。

## 时序差分

回顾贝尔曼方程：$V^\pi(s_t) = \mathbb{E}\left[ r_t + \gamma V^\pi(s_{t+1}) \right]$。这启发我们：可以用“一步真实奖励 + 下一个状态的估计价值”来代替完整的回报 $G_t$。二者之差称为**时序差分误差**（temporal difference error，TD error）：

$$
\delta_t = r_t + \gamma V(s_{t+1}) - V(s_t).
$$

如果 $V$ 恰好等于真实的 $V^\pi$，那么：

$$
\mathbb{E}\left[ \delta_t \mid s_t, a_t \right]
=
r_t + \gamma \mathbb{E}\left[ V^\pi(s_{t+1}) \right] - V^\pi(s_t)
=
Q^\pi(s_t, a_t) - V^\pi(s_t)
=
A^\pi(s_t, a_t),
$$

即 TD 误差是优势函数的一个无偏估计。与 $G_t - V(s_t)$ 相比，$\delta_t$ 只包含一步的随机性，**方差小得多**；但它依赖于 Critic 的估计，而 Critic 不可能完全准确，因此会引入**偏差**。

这就是强化学习中经典的偏差-方差权衡：

| 估计 | 形式 | 偏差 | 方差 |
| --- | --- | --- | --- |
| 蒙特卡洛 | $G_t - V(s_t)$ | 无偏（与 $V$ 是否准确无关） | 高，包含后续所有随机性 |
| 单步 TD | $r_t + \gamma V(s_{t+1}) - V(s_t)$ | 有偏，依赖 $V$ 的准确程度 | 低，只包含一步随机性 |

介于二者之间，可以先累积 $n$ 步真实奖励，再用 $V$ 估计剩下的部分，得到 **$n$ 步优势估计**：

$$
\hat{A}_t^{(n)}
=
r_t + \gamma r_{t+1} + \cdots + \gamma^{n-1} r_{t+n-1} + \gamma^n V(s_{t+n}) - V(s_t).
$$

$n = 1$ 就是单步 TD，$n \to \infty$ 就是蒙特卡洛。$n$ 越大偏差越小、方差越大。那么 $n$ 应该取多少？

## GAE

[GAE](https://arxiv.org/abs/1506.02438)（Generalized Advantage Estimation）给出的答案是：不必选一个 $n$，而是把所有 $n$ 步估计按指数衰减加权平均。可以验证，$n$ 步优势估计恰好可以写成 TD 误差的折扣和：

$$
\hat{A}_t^{(n)} = \sum_{l=0}^{n-1} \gamma^l \delta_{t+l}.
$$

对 $\hat{A}_t^{(1)}, \hat{A}_t^{(2)}, \dots$ 以 $(1 - \lambda), (1 - \lambda)\lambda, (1 - \lambda)\lambda^2, \dots$ 为权重加权平均，整理后得到一个非常简洁的形式：

$$
\hat{A}_t^{\text{GAE}(\gamma, \lambda)}
=
\sum_{l=0}^{\infty} (\gamma \lambda)^l \delta_{t+l}.
$$

参数 $\lambda \in [0, 1]$ 控制偏差与方差的权衡：

* $\lambda = 0$：$\hat{A}_t = \delta_t$，即单步 TD，方差最小、偏差最大；
* $\lambda = 1$：$\hat{A}_t = \sum_l \gamma^l \delta_{t+l} = G_t - V(s_t)$，即蒙特卡洛，无偏但方差最大。

实践中常取 $\gamma = 0.99$、$\lambda = 0.95$。与回报一样，GAE 也可以倒序递推计算：

$$
\hat{A}_t = \delta_t + \gamma \lambda \hat{A}_{t+1}.
$$

有了优势估计，Critic 的回归目标也随之确定：$\hat{R}_t = \hat{A}_t + V(s_t)$。它同样是回报的一个低方差估计，在 $\lambda = 1$ 时恰好等于 $G_t$。

## 代码示例

`compute_gae` 对一段长度为 $T$ 的数据倒序递推。这段数据可能跨越多个回合，因此需要用 `dones` 标记回合边界：若第 $t$ 步之后回合结束，下一个状态的价值不应再参与计算，递推也要在此处断开。若数据的最后一步回合尚未结束，则用 `last_value` 即 $V(s_T)$ 做 bootstrap：

```python
def compute_gae(
    rewards: torch.Tensor,  # [T]
    values: torch.Tensor,   # [T]
    dones: torch.Tensor,    # [T]，第 t 步之后回合是否结束
    last_value: torch.Tensor,  # 标量，V(s_T)
    gamma: float,
    lam: float,
) -> tuple[torch.Tensor, torch.Tensor]:
    T = rewards.size(0)
    advantages = torch.zeros_like(rewards)   # [T]
    gae = 0.0
    for t in reversed(range(T)):
        next_value = last_value if t == T - 1 else values[t + 1]
        mask = 1.0 - dones[t]
        delta = rewards[t] + gamma * next_value * mask - values[t]
        gae = delta + gamma * lam * mask * gae
        advantages[t] = gae
    returns = advantages + values            # [T]
    return advantages, returns
```

可以直接验证两个极端情形：

```python
T, gamma = 10, 0.9
rewards, values = torch.rand(T), torch.rand(T)   # [T], [T]
dones = torch.zeros(T)                           # [T]
dones[4] = dones[-1] = 1.0              # 两个回合：0..4 与 5..9
last_value = torch.tensor(0.7)          # 标量

# λ = 1：退化为蒙特卡洛
adv, ret = compute_gae(rewards, values, dones, last_value, gamma, lam=1.0)  # [T], [T]
G = torch.tensor(discounted_returns(rewards[:5].tolist(), gamma)
                 + discounted_returns(rewards[5:].tolist(), gamma))         # [T]
torch.allclose(adv, G - values)         # True
torch.allclose(ret, G)                  # True

# λ = 0：退化为单步 TD
adv, _ = compute_gae(rewards, values, dones, last_value, gamma, lam=0.0)
next_values = torch.cat([values[1:], last_value.view(1)])   # [T]
torch.allclose(adv, rewards + gamma * next_values * (1 - dones) - values)  # True
```

这里有一个值得注意的简化：前文提到 `truncated` 与 `terminated` 语义不同。回合因超时被截断时，严格来说应该用截断时刻下一个状态的价值做 bootstrap，而不是当作价值为 0。本文为了简洁统一当作回合结束处理，这在 CartPole 中影响不大，但在长回合任务中值得单独处理。

# 信任域

到这里，我们已经有了一个完整的 Actor-Critic 算法：采样一批数据，用 GAE 估计优势，做一步策略梯度更新，然后丢弃这批数据重新采样。它仍有两个问题：

1. **步长难以选择**。策略梯度只告诉我们方向，没有告诉我们能走多远。步子一旦太大，策略可能突然变差；而策略变差后采样到的数据也会变差，训练很难恢复；
2. **样本利用率低**。策略梯度的期望是在当前策略下计算的，参数一更新，旧数据就“过期”了，每批数据只能用一次。

这两个问题可以归结为同一个问题：

> **能否用旧策略采样的数据，安全地对新策略做多步优化？**

## 重要性采样

第一步是解决“用旧数据评估新策略”的问题，工具是**重要性采样**（importance sampling）。对于任意函数 $f$ 和两个分布 $p$、$q$：

$$
\mathbb{E}_{x \sim p}\left[ f(x) \right]
=
\sum_x p(x) f(x)
=
\sum_x q(x) \frac{p(x)}{q(x)} f(x)
=
\mathbb{E}_{x \sim q}\left[ \frac{p(x)}{q(x)} f(x) \right].
$$

也就是说，从分布 $q$ 采样，再用权重 $\frac{p(x)}{q(x)}$ 修正，就能得到分布 $p$ 下期望的无偏估计。这个权重称为**重要性权重**。

```python
def importance_sampling(p: torch.Tensor, q: torch.Tensor, f: torch.Tensor, n: int = 1000):
    # p, q, f: [4]
    x = torch.multinomial(q, n, replacement=True)  # [n]，从行为分布 q 采样
    w = p[x] / q[x]                                # [n]，重要性权重
    return (w * f[x]).mean().item(), w.std().item()


p = torch.tensor([0.1, 0.2, 0.3, 0.4])             # [4]
f = torch.tensor([1.0, 2.0, 3.0, 4.0])             # [4]，真实期望为 3.0
importance_sampling(p, torch.tensor([0.15, 0.2, 0.3, 0.35]), f, 100000)  # 估计 ≈ 3.00，权重 std ≈ 0.15
importance_sampling(p, torch.tensor([0.7, 0.2, 0.07, 0.03]), f, 100000)  # 估计 ≈ 2.96，权重 std ≈ 2.39
```

两种情况下估计都是无偏的，但当 $q$ 与 $p$ 相差很大时，重要性权重的方差会急剧增大，估计变得不可靠。这个现象决定了后面所有方法的设计：**新旧策略不能相差太远**。

把重要性采样用到策略优化上：设采样数据的旧策略为 $\pi_{\theta_{\text{old}}}$，定义**概率比**（probability ratio）：

$$
\rho_t(\theta)
=
\frac{\pi_\theta(a_t \mid s_t)}{\pi_{\theta_{\text{old}}}(a_t \mid s_t)}.
$$

这里用 $\rho_t$ 而不是 PPO 原论文中的 $r_t$，是为了避免与奖励 $r_t$ 混淆。于是可以构造一个**替代目标**（surrogate objective）：

$$
L(\theta)
=
\mathbb{E}_{s_t, a_t \sim \pi_{\theta_{\text{old}}}}
\left[
\rho_t(\theta) \hat{A}_t
\right].
$$

可以验证，在 $\theta = \theta_{\text{old}}$ 处，$\nabla_\theta L(\theta)$ 恰好等于策略梯度 $\mathbb{E}\left[ \nabla_\theta \log \pi_\theta(a_t \mid s_t) \hat{A}_t \right]$，因为 $\nabla_\theta \rho_t = \rho_t \nabla_\theta \log \pi_\theta$，而 $\rho_t(\theta_{\text{old}}) = 1$。这意味着替代目标在旧策略附近是真实目标的一个良好近似，我们可以在同一批旧数据上反复优化它。

严格来说，这里只修正了动作分布的差异，而状态分布仍然来自旧策略。当新旧策略足够接近时，这个近似的误差是有界的，这正是下一节 TRPO 的理论出发点。

## TRPO

[TRPO](https://arxiv.org/abs/1502.05477)（Trust Region Policy Optimization）的做法是：最大化替代目标，同时约束新旧策略之间的 KL 散度不超过一个阈值 $\kappa$：

$$
\max_\theta \;
\mathbb{E}\left[ \rho_t(\theta) \hat{A}_t \right]
\quad
\text{s.t.}
\quad
\mathbb{E}_{s}
\left[
D_{\text{KL}}\left(
\pi_{\theta_{\text{old}}}(\cdot \mid s)
\,\|\,
\pi_\theta(\cdot \mid s)
\right)
\right]
\le
\kappa.
$$

这个约束区域就是所谓的**信任域**（trust region）：在旧策略附近的一个小范围内，替代目标是可信的，因此可以放心优化；超出这个范围，近似就失效了。TRPO 在理论上可以保证每次更新的性能单调不降（在一定近似条件下）。

但 TRPO 的实现相当复杂：它需要用共轭梯度法近似求解带约束的优化问题，涉及 Fisher 信息矩阵与向量的乘积，还需要线搜索来保证约束被满足。这些都让它难以与大模型常用的一阶优化器、参数共享结构结合。

> **能否用一个只需要一阶优化的简单目标，达到与信任域类似的效果？**

这正是 PPO 要做的事。

# PPO

PPO 保留了“新旧策略不能相差太远”这个核心思想，但把 TRPO 的硬约束换成了目标函数中的一个简单操作：**裁剪**（clip）。这让它可以直接用 Adam 这样的一阶优化器，在同一批数据上做多轮 minibatch 更新。

## 裁剪目标

PPO 的核心是如下的裁剪替代目标：

$$
L^{\text{CLIP}}(\theta)
=
\mathbb{E}_t
\left[
\min\left(
\rho_t(\theta) \hat{A}_t,\;
\operatorname{clip}\left(\rho_t(\theta), 1 - \epsilon, 1 + \epsilon\right) \hat{A}_t
\right)
\right],
$$

其中 $\epsilon$ 是裁剪范围，通常取 0.2。$\operatorname{clip}(\rho, 1 - \epsilon, 1 + \epsilon)$ 把概率比限制在 $[1 - \epsilon, 1 + \epsilon]$ 区间内。

乍看之下这个公式有些绕，按优势的正负分情况讨论就清楚了：

**当 $\hat{A}_t > 0$ 时**，这个动作好于平均，我们希望增大它的概率，即增大 $\rho_t$。目标变为 $\min(\rho_t, 1 + \epsilon) \hat{A}_t$：当 $\rho_t$ 超过 $1 + \epsilon$ 后，目标不再增长，梯度为零。也就是说，**好动作的概率最多只能被提高到旧策略的 $1 + \epsilon$ 倍**。

**当 $\hat{A}_t < 0$ 时**，这个动作差于平均，我们希望减小它的概率。目标变为 $\max(\rho_t, 1 - \epsilon) \hat{A}_t$：当 $\rho_t$ 低于 $1 - \epsilon$ 后，目标不再增长，梯度为零。也就是说，**坏动作的概率最多只能被降低到旧策略的 $1 - \epsilon$ 倍**。

另外两种情况同样值得注意：若 $\hat{A}_t > 0$ 而 $\rho_t < 1 - \epsilon$，或 $\hat{A}_t < 0$ 而 $\rho_t > 1 + \epsilon$，即策略已经朝着“错误”的方向走得太远时，$\min$ 会选择未裁剪的一项，梯度照常存在，把策略拉回来。可以总结为下表：

| 情况 | $\rho_t$ 的范围 | $\min$ 选中的项 | 梯度 |
| --- | --- | --- | --- |
| $\hat{A}_t > 0$ | $\rho_t > 1 + \epsilon$ | 裁剪项 | 0，停止继续加强 |
| $\hat{A}_t > 0$ | $\rho_t \le 1 + \epsilon$ | 未裁剪项 | 正常，加强该动作 |
| $\hat{A}_t < 0$ | $\rho_t < 1 - \epsilon$ | 裁剪项 | 0，停止继续削弱 |
| $\hat{A}_t < 0$ | $\rho_t \ge 1 - \epsilon$ | 未裁剪项 | 正常，削弱该动作 |

把 $L^{\text{CLIP}}$ 作为 $\rho_t$ 的函数画出来，裁剪的效果一目了然。圆点是每轮优化的起点 $\rho_t = 1$，虚线是未裁剪的 $\rho_t \hat{A}_t$，灰色区域是梯度为零的区间：

![clip-objective](/img/posts/llm-ppo/clip-objective.svg)

因此，$\min$ 的作用是取一个**悲观的下界**：裁剪只会阻止目标变得“过于乐观”，永远不会阻止策略修正错误。

可以用自动微分直接验证这一点。取 $\rho_t \approx 1.65$，已经超出 $[0.8, 1.2]$：

```python
log_prob = torch.tensor([0.0], requires_grad=True)     # [1]
ratio = torch.exp(log_prob - torch.tensor([-0.5]))   # [1]，ρ ≈ 1.65

for A in (1.0, -1.0):
    log_prob.grad = None
    adv = torch.tensor([A])                            # [1]
    obj = torch.min(ratio * adv, torch.clamp(ratio, 0.8, 1.2) * adv)
    obj.sum().backward(retain_graph=True)
    print(A, log_prob.grad.item())   # A=+1: 0.0；A=-1: -1.649
```

$\hat{A}_t > 0$ 时梯度为零，好动作不会被继续加强；$\hat{A}_t < 0$ 时梯度照常存在，把被错误放大的坏动作拉回来。

## 完整目标

在 Actor-Critic 框架下，PPO 的完整损失还包括 Critic 的价值损失和一个熵奖励：

$$
\mathcal{L}(\theta, \phi)
=
-L^{\text{CLIP}}(\theta)
+
c_1 \, \mathbb{E}_t\left[ \left( V_\phi(s_t) - \hat{R}_t \right)^2 \right]
-
c_2 \, \mathbb{E}_t\left[ \mathcal{H}\left( \pi_\theta(\cdot \mid s_t) \right) \right],
$$

其中：

* 第一项是裁剪策略损失，取负号是因为我们要最大化 $L^{\text{CLIP}}$；
* 第二项是价值损失，$\hat{R}_t = \hat{A}_t + V(s_t)$ 是 GAE 给出的回报估计，$c_1$ 通常取 0.5；
* 第三项是策略的熵 $\mathcal{H}$，鼓励策略保持一定的随机性，避免过早收敛到确定性策略而停止探索，$c_2$ 通常取 0.01 或更小。

当 Actor 与 Critic 共享部分参数时，三项必须合在一起优化；若二者是独立的网络，这个加权和等价于分别优化。

## 训练流程

PPO 的一次迭代可以分为三步：

1. **采样**：用当前策略 $\pi_{\theta_{\text{old}}}$ 与环境交互 $N$ 步，记录状态、动作、$\log \pi_{\theta_{\text{old}}}(a_t \mid s_t)$、$V(s_t)$ 和奖励；
2. **估计优势**：用 GAE 计算每一步的 $\hat{A}_t$ 与 $\hat{R}_t$；
3. **优化**：在这批数据上做 $K$ 个 epoch，每个 epoch 打乱后切成若干 minibatch，对每个 minibatch 最小化上面的完整损失。

其中 $\log \pi_{\theta_{\text{old}}}$ 在采样时就被记录下来，在整个优化阶段保持不变；而 $\log \pi_\theta$ 每次都用最新的参数重新计算。第一个 epoch 的第一个 minibatch 上 $\rho_t = 1$，此后随着参数更新，$\rho_t$ 逐渐偏离 1，裁剪开始生效。正是裁剪机制，让这 $K$ 轮重复利用旧数据的优化不会走得太远。

## 实现细节

PPO 的论文只给出了核心算法，而实际效果在很大程度上取决于一系列实现细节，[The 37 Implementation Details of PPO](https://iclr-blog-track.github.io/2022/03/25/ppo-implementation-details/) 对此有系统的梳理。其中最常见、对小规模实验也影响显著的几项：

1. **优势归一化**：在每个 minibatch 内把 $\hat{A}_t$ 标准化为零均值、单位方差，使策略损失的尺度不随奖励尺度变化；
2. **正交初始化**：隐藏层用增益 $\sqrt{2}$ 的正交初始化，策略输出层用 0.01 的小增益，使初始策略接近均匀分布；价值输出层增益为 1；
3. **学习率退火**：学习率随训练进度线性衰减到 0；
4. **梯度裁剪**：将全局梯度范数裁剪到 0.5；
5. **监控 KL 与裁剪比例**：记录 $\rho_t$ 被裁剪的比例（clip fraction）和新旧策略之间的近似 KL。若二者持续偏大，说明每轮更新走得太远，应减小学习率或 epoch 数。

近似 KL 通常用 $\mathbb{E}\left[ (\rho_t - 1) - \log \rho_t \right]$ 估计，它恒为非负，且是 $D_{\text{KL}}(\pi_{\theta_{\text{old}}} \| \pi_\theta)$ 的无偏估计，参见 [Approximating KL Divergence](http://joschu.net/blog/kl-approx.html)。

## 代码示例

Actor 与 Critic 使用独立的两层 MLP，并按上面的方式初始化：

```python
def layer_init(layer: nn.Linear, std: float = math.sqrt(2)) -> nn.Linear:
    nn.init.orthogonal_(layer.weight, std)
    nn.init.zeros_(layer.bias)
    return layer


class ActorCritic(nn.Module):
    def __init__(self, obs_dim: int, n_actions: int, hidden: int = 64) -> None:
        super().__init__()
        self.actor = nn.Sequential(
            layer_init(nn.Linear(obs_dim, hidden)), nn.Tanh(),
            layer_init(nn.Linear(hidden, hidden)), nn.Tanh(),
            layer_init(nn.Linear(hidden, n_actions), std=0.01),
        )
        self.critic = nn.Sequential(
            layer_init(nn.Linear(obs_dim, hidden)), nn.Tanh(),
            layer_init(nn.Linear(hidden, hidden)), nn.Tanh(),
            layer_init(nn.Linear(hidden, 1), std=1.0),
        )

    def forward(self, obs: torch.Tensor) -> tuple[Categorical, torch.Tensor]:
        # obs: [B, obs_dim] -> logits [B, n_actions]，values [B]
        return Categorical(logits=self.actor(obs)), self.critic(obs).squeeze(-1)
```

完整损失对应前文的公式，同时返回裁剪比例与近似 KL 用于监控：

```python
def ppo_loss(
    model: ActorCritic,
    obs: torch.Tensor,         # [B, obs_dim]
    actions: torch.Tensor,     # [B]
    old_log_probs: torch.Tensor,  # [B]
    advantages: torch.Tensor,  # [B]
    returns: torch.Tensor,     # [B]
    clip_eps: float = 0.2,
    vf_coef: float = 0.5,
    ent_coef: float = 0.01,
) -> tuple[torch.Tensor, dict[str, float]]:
    dist, values = model(obs)            # values: [B]
    log_probs = dist.log_prob(actions)   # [B]
    ratio = torch.exp(log_probs - old_log_probs)  # [B]

    advantages = (advantages - advantages.mean()) / (advantages.std() + 1e-8)
    surr1 = ratio * advantages           # [B]
    surr2 = torch.clamp(ratio, 1 - clip_eps, 1 + clip_eps) * advantages   # [B]
    policy_loss = -torch.min(surr1, surr2).mean()

    value_loss = F.mse_loss(values, returns)
    entropy = dist.entropy().mean()
    loss = policy_loss + vf_coef * value_loss - ent_coef * entropy

    with torch.no_grad():
        clip_frac = ((ratio - 1).abs() > clip_eps).float().mean().item()
        approx_kl = ((ratio - 1) - torch.log(ratio)).mean().item()
    return loss, {"clip_frac": clip_frac, "approx_kl": approx_kl}
```

概率比用 `exp(log_probs - old_log_probs)` 计算，而不是直接相除两个概率，这样在概率很小时数值更稳定。

最后把采样、GAE、多轮 minibatch 更新串起来：

```python
def ppo(
    env: CartPole,
    total_steps: int = 100_000,
    rollout_steps: int = 2048,
    epochs: int = 10,
    minibatch_size: int = 64,
    gamma: float = 0.99,
    lam: float = 0.95,
    lr: float = 3e-4,
    max_grad_norm: float = 0.5,
    device: str = "cpu",
) -> list[tuple[int, float]]:
    model = ActorCritic(env.obs_dim, env.n_actions).to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr, eps=1e-5)
    num_updates = total_steps // rollout_steps

    s, ep_return, history, step = env.reset(), 0.0, [], 0
    for update in range(num_updates):
        optimizer.param_groups[0]["lr"] = lr * (1 - update / num_updates)

        # 1. 用当前策略采样 rollout_steps 步
        buf = {k: [] for k in ("obs", "actions", "log_probs", "values", "rewards", "dones")}
        for _ in range(rollout_steps):
            obs = torch.tensor(s, device=device)   # [obs_dim]
            with torch.no_grad():
                dist, v = model(obs)
                a = dist.sample()
                log_prob = dist.log_prob(a)
            s, r, terminated, truncated = env.step(a.item())
            done = terminated or truncated
            for k, x in zip(buf, (obs, a, log_prob, v, r, float(done))):
                buf[k].append(x)
            ep_return += r
            step += 1
            if done:
                history.append((step, ep_return))
                s, ep_return = env.reset(), 0.0

        obs = torch.stack(buf["obs"])                            # [T, obs_dim]
        actions = torch.stack(buf["actions"])                    # [T]
        old_log_probs = torch.stack(buf["log_probs"])            # [T]
        values = torch.stack(buf["values"])                      # [T]
        rewards = torch.tensor(buf["rewards"], device=device)    # [T]
        dones = torch.tensor(buf["dones"], device=device)        # [T]

        # 2. 计算 GAE
        with torch.no_grad():
            last_value = model(torch.tensor(s, device=device))[1]  # 标量
        advantages, returns = compute_gae(rewards, values, dones, last_value, gamma, lam)  # [T], [T]

        # 3. 同一批数据上做多轮 minibatch 更新
        for _ in range(epochs):
            perm = torch.randperm(rollout_steps, device=device)   # [T]
            for start in range(0, rollout_steps, minibatch_size):
                idx = perm[start:start + minibatch_size]          # [B]
                loss, _ = ppo_loss(
                    model, obs[idx], actions[idx], old_log_probs[idx],
                    advantages[idx], returns[idx],
                )
                optimizer.zero_grad()
                loss.backward()
                nn.utils.clip_grad_norm_(model.parameters(), max_grad_norm)
                optimizer.step()
    return history
```

注意采样阶段与优化阶段是严格分开的：采样时模型处于 `no_grad` 下，记录下的 `old_log_probs` 与 `values` 都是常数；优化时才重新前向计算 `log_probs` 与 `values` 并反向传播。另外，采样跨越了多个回合，`dones` 负责在 GAE 中切断回合边界，而最后一个未结束回合的剩余价值由 `last_value` 补上。

把 PPO 与前面的两个 REINFORCE 放在一起，以环境交互步数为横轴比较（3 个随机种子取平均）：

![learning-curves](/img/posts/llm-ppo/learning-curves.svg)

PPO 在 3.4 万到 5.7 万步之间，10 个回合的平均回报就首次达到 475，而带基线的 REINFORCE 要到 15 万步左右才接近 500，之后还有明显波动。二者的差距主要来自两点：GAE 提供了方差更低的优势估计，而裁剪目标让每批数据可以被安全地重复使用 10 个 epoch。

# PPO 与 RLHF

理解了经典 PPO，再来看它如何用在 LLM 上。以 [InstructGPT](https://arxiv.org/abs/2203.02155) 为代表的 RLHF 流程通常分为三个阶段：

1. **SFT**：在人工撰写的示范数据上做监督微调，得到初始策略 $\pi^{\text{SFT}}$；
2. **训练奖励模型**：让人类对同一 prompt 的多个回答进行排序，训练一个奖励模型 $r_\psi$ 来拟合人类偏好；
3. **PPO 优化**：以 $r_\psi$ 为奖励，用 PPO 优化策略，同时约束它不要偏离 $\pi^{\text{SFT}}$ 太远。

这一流程最早在 [Fine-Tuning Language Models from Human Preferences](https://arxiv.org/abs/1909.08593) 与 [Learning to Summarize from Human Feedback](https://arxiv.org/abs/2009.01325) 中被系统地提出，InstructGPT 将其扩展到了通用指令跟随任务。

## 语言模型的 MDP

要把 PPO 用到语言模型上，首先要把文本生成写成一个 MDP。给定 prompt $x$，模型逐个生成回答 $y = (y_1, y_2, \dots, y_T)$：

* **状态** $s_t = (x, y_{<t})$：prompt 加上已经生成的前缀；
* **动作** $a_t = y_t$：下一个 token，动作空间就是整个词表；
* **策略** $\pi_\theta(y_t \mid x, y_{<t})$：语言模型本身；
* **状态转移**：确定性的，就是把新 token 拼接到前缀末尾；
* **回合结束**：生成 EOS 或达到最大长度。

也就是说，**每个 token 就是一个动作**，语言模型的一次生成就是一个回合。这个视角下，前面的所有概念都可以直接对应过来：$\log \pi_\theta(a_t \mid s_t)$ 就是模型在第 $t$ 个位置对采样 token 的 log prob，价值函数 $V(s_t)$ 则估计“从当前前缀继续生成，最终能得到多少奖励”。

与 CartPole 不同的是奖励的结构：奖励模型只对**完整回答**打分，中间的 token 都没有直接的奖励。这是一个典型的稀疏、延迟奖励问题，正是信用分配最困难的情形，Critic 与 GAE 在这里承担了把序列级奖励分配到每个 token 上的任务。另外，由于回答长度有限，RLHF 中通常直接取 $\gamma = 1$。

## 奖励模型

奖励模型 $r_\psi(x, y)$ 通常由 SFT 模型初始化，把最后的 LM Head 换成一个输出标量的线性层，取最后一个 token 位置的输出作为整个回答的分数。

训练数据是人类的偏好比较：对于同一个 prompt $x$，人类认为回答 $y_w$ 好于 $y_l$。奖励模型采用 [Bradley-Terry 模型](https://en.wikipedia.org/wiki/Bradley%E2%80%93Terry_model)来描述偏好的概率：

$$
P(y_w \succ y_l \mid x)
=
\sigma\left( r_\psi(x, y_w) - r_\psi(x, y_l) \right),
$$

其中 $\sigma$ 是 sigmoid 函数。训练目标是最大化人类偏好的似然：

$$
\mathcal{L}_{\text{RM}}(\psi)
=
-\mathbb{E}_{(x, y_w, y_l)}
\left[
\log \sigma\left( r_\psi(x, y_w) - r_\psi(x, y_l) \right)
\right].
$$

注意这个损失只依赖两个分数的**差**，因此奖励模型输出的绝对数值没有意义，只有相对大小有意义。这也是为什么 PPO 中的优势归一化在 RLHF 里尤为重要。

## KL 惩罚

如果只最大化奖励模型的分数，会出现一个严重的问题：奖励模型只是人类偏好的一个不完美的近似，策略会想方设法找到奖励模型的漏洞，生成分数很高、但实际上毫无意义的文本，这称为**奖励欺骗**（reward hacking）。

因此，RLHF 在奖励中加入一个 KL 惩罚项，约束策略不要偏离参考模型 $\pi^{\text{ref}}$（通常就是 $\pi^{\text{SFT}}$）太远：

$$
R(x, y)
=
r_\psi(x, y)
-
\beta \log \frac{\pi_\theta(y \mid x)}{\pi^{\text{ref}}(y \mid x)},
$$

其中 $\beta$ 控制惩罚的强度。由于 $\log \pi(y \mid x) = \sum_t \log \pi(y_t \mid x, y_{<t})$，这一项可以拆到每个 token 上。实践中通常把 KL 惩罚作为每个 token 的即时奖励，而奖励模型的分数只加在最后一个 token 上：

$$
r_t
=
-\beta \log \frac{\pi_\theta(y_t \mid x, y_{<t})}{\pi^{\text{ref}}(y_t \mid x, y_{<t})}
+
\mathbb{I}(t = T) \, r_\psi(x, y).
$$

这样，稀疏的序列级奖励就被转化成了逐 token 的奖励序列，可以直接交给 GAE 处理。

值得注意的是，这里的 KL 与 PPO 的裁剪约束的是**不同的东西**：裁剪约束的是每轮更新前后的新旧策略 $\pi_\theta$ 与 $\pi_{\theta_{\text{old}}}$，保证单次优化的稳定；KL 惩罚约束的是当前策略与固定的参考模型 $\pi^{\text{ref}}$，保证整个训练过程不偏离初始模型太远。

KL 惩罚还有一个很有用的理论性质：对于上面的目标，最优策略有闭式解 $\pi^*(y \mid x) \propto \pi^{\text{ref}}(y \mid x) \exp\left( r_\psi(x, y) / \beta \right)$。也就是说，$\beta$ 越小，最优策略越偏向高奖励的回答；$\beta$ 越大，越接近参考模型。下面的代码示例会直接验证这一点。

## 四个模型

综合以上内容，基于 PPO 的 RLHF 训练过程中需要同时维护四个模型：

| 模型 | 作用 | 是否训练 | 典型初始化 |
| --- | --- | --- | --- |
| Actor | 策略 $\pi_\theta$，生成回答 | 训练 | SFT 模型 |
| Critic | 价值函数 $V_\phi$，估计每个 token 位置的价值 | 训练 | 奖励模型 |
| Reward Model | 奖励模型 $r_\psi$，对完整回答打分 | 冻结 | 在偏好数据上训练 |
| Reference | 参考模型 $\pi^{\text{ref}}$，计算 KL 惩罚 | 冻结 | SFT 模型 |

它们在一次 PPO 迭代中的关系如下：

![rlhf-ppo](/img/posts/llm-ppo/rlhf-ppo.svg)

具体来说，Actor 对一批 prompt 生成回答；Reference 计算每个 token 的 log prob，用于 KL 惩罚；Reward Model 对完整回答打分；Critic 给出每个 token 位置的价值；之后按前文的方式计算逐 token 奖励与 GAE，并对 Actor 和 Critic 做多轮 PPO 更新。

这四个模型通常都与策略模型同等规模，因此 RLHF 的显存与计算开销远大于 SFT：两个需要训练的模型要保存梯度与优化器状态，生成阶段还是逐 token 的自回归解码。这也是 PPO-based RLHF 工程上最主要的难点，关于实际训练中的稳定性问题，可以参考 [Secrets of RLHF in Large Language Models Part I: PPO](https://arxiv.org/abs/2307.04964)。此外，InstructGPT 还在 PPO 损失中混入了一部分预训练数据的语言模型损失（PPO-ptx），以减轻对齐带来的通用能力下降。

## 代码示例

我们用一个玩具例子把上面的流程完整跑一遍。策略是一个小型的 GRU 语言模型，词表大小为 8，每次从 BOS 开始生成长度为 8 的序列；Actor 与 Critic 共享主干，分别用一个 LM Head 和一个 Value Head 输出：

```python
class TinyLM(nn.Module):
    def __init__(self, vocab_size: int, hidden: int = 64) -> None:
        super().__init__()
        self.bos = vocab_size
        self.embed = nn.Embedding(vocab_size + 1, hidden)
        self.rnn = nn.GRU(hidden, hidden, batch_first=True)
        self.lm_head = nn.Linear(hidden, vocab_size)
        self.value_head = nn.Linear(hidden, 1)

    def forward(self, tokens: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        # tokens: [B, L]，预测第 t 个 token 时只看得到 BOS 与前 t-1 个 token
        bos = torch.full_like(tokens[:, :1], self.bos)          # [B, 1]
        h, _ = self.rnn(self.embed(torch.cat([bos, tokens[:, :-1]], dim=1)))  # [B, L, hidden]
        return self.lm_head(h), self.value_head(h).squeeze(-1)  # [B, L, V], [B, L]

    @torch.no_grad()
    def generate(self, batch_size: int, length: int) -> torch.Tensor:
        device = self.lm_head.weight.device
        x = torch.full((batch_size, 1), self.bos, device=device)  # [B, 1]
        h, tokens = None, []
        for _ in range(length):
            out, h = self.rnn(self.embed(x), h)                # [B, 1, hidden]
            x = Categorical(logits=self.lm_head(out[:, -1])).sample().unsqueeze(1)  # [B, 1]
            tokens.append(x)
        return torch.cat(tokens, dim=1)  # [B, L]


def token_log_probs(logits: torch.Tensor, tokens: torch.Tensor) -> torch.Tensor:
    # logits: [B, L, V]，tokens: [B, L]
    return torch.log_softmax(logits, dim=-1).gather(-1, tokens.unsqueeze(-1)).squeeze(-1)  # [B, L]
```

`forward` 采用 teacher forcing：输入是右移一位的序列 `[BOS, y_1, ..., y_{L-1}]`，第 $t$ 个位置的输出对应状态 $s_t = y_{<t}$，因此 logits 可以直接与 `tokens` 对齐计算每个 token 的 log prob，value 也恰好是每个状态的价值。这与真实 LLM 中常见的 off-by-one 陷阱是同一个问题：logits 的第 $t$ 个位置预测的是第 $t+1$ 个输入 token，对齐错一位，所有 log prob 就全错了。

为了聚焦 PPO 本身，我们用一个规则代替奖励模型：回答中 token `3` 的占比越高，分数越高。参考模型是初始策略的一份冻结拷贝：

```python
def reward_fn(tokens: torch.Tensor, target: int = 3) -> torch.Tensor:
    return (tokens == target).float().mean(dim=-1)  # [B]，代替奖励模型的序列级打分


def rlhf_ppo(
    vocab_size: int = 8,
    length: int = 8,
    batch_size: int = 256,
    iterations: int = 150,
    beta: float = 0.1,
    gamma: float = 1.0,
    lam: float = 0.95,
    epochs: int = 4,
    clip_eps: float = 0.2,
    lr: float = 1e-3,
    device: str = "cpu",
) -> list[tuple[float, float]]:
    policy = TinyLM(vocab_size).to(device)
    ref = copy.deepcopy(policy).eval().requires_grad_(False)
    optimizer = torch.optim.Adam(policy.parameters(), lr=lr)

    history = []
    for _ in range(iterations):
        # 1. rollout：采样回答，记录旧策略、参考模型的 log prob 与 critic 的价值
        tokens = policy.generate(batch_size, length)                    # [B, L]
        with torch.no_grad():
            logits, values = policy(tokens)                             # [B, L, V], [B, L]
            old_log_probs = token_log_probs(logits, tokens)             # [B, L]
            ref_log_probs = token_log_probs(ref(tokens)[0], tokens)     # [B, L]
        score = reward_fn(tokens)                                       # [B]

        # 2. 奖励塑形：每个 token 都扣 KL，序列级分数只加在最后一个 token 上
        kl = old_log_probs - ref_log_probs                              # [B, L]
        rewards = -beta * kl                                            # [B, L]
        rewards[:, -1] += score

        # 3. 逐条序列做 GAE，最后一个 token 之后回合结束
        dones = torch.zeros(length, device=device)                      # [L]
        dones[-1] = 1.0
        adv, ret = zip(*(
            compute_gae(rewards[i], values[i], dones, values.new_zeros(()), gamma, lam)
            for i in range(batch_size)
        ))
        advantages, returns = torch.stack(adv), torch.stack(ret)       # [B, L]
        advantages = (advantages - advantages.mean()) / (advantages.std() + 1e-8)

        # 4. PPO 更新：token 就是动作
        for _ in range(epochs):
            logits, new_values = policy(tokens)                         # [B, L, V], [B, L]
            ratio = torch.exp(token_log_probs(logits, tokens) - old_log_probs)  # [B, L]
            surr = torch.min(                                           # [B, L]
                ratio * advantages,
                torch.clamp(ratio, 1 - clip_eps, 1 + clip_eps) * advantages,
            )
            loss = -surr.mean() + 0.5 * F.mse_loss(new_values, returns)
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()

        history.append((score.mean().item(), kl.sum(dim=-1).mean().item()))
    return history
```

这段代码与前文的 CartPole 版本结构完全一致，区别只在于数据的来源：动作是 token，一个回合是一条序列，奖励由“逐 token 的 KL 惩罚 + 最后一个 token 的序列级分数”组成，`compute_gae` 被原样复用。这里为了简洁，每个 epoch 直接在整个 batch 上更新，没有再切分 minibatch。

分别取 $\beta = 0$ 与 $\beta = 0.1$ 训练 150 轮，观察最后 10 轮的平均分数与每条序列的 KL（逐 token KL 之和）：

```python
rlhf_ppo(beta=0.0)   # 分数 0.14 → 1.00，KL 0 → 16.75
rlhf_ppo(beta=0.1)   # 分数 0.14 → 0.33，KL 0 → 1.13 ~ 1.17
```

没有 KL 惩罚时，策略很快坍缩为“全部输出 token 3”：分数达到满分 1.0，而 KL 接近理论上限 $8 \log 8 \approx 16.6$：确定性地输出 token `3` 相对于近似均匀的参考分布，每个 token 的 KL 为 $\log 8$，8 个 token 累加即得。模型完全抛弃了参考分布。这正是奖励欺骗的缩影：如果奖励模型有漏洞，策略就会毫无顾忌地钻进去。

加入 $\beta = 0.1$ 的 KL 惩罚后，结果与前文的闭式解吻合得很好。初始策略近似均匀分布，每个 token `3` 带来 $1/L = 0.125$ 的奖励，因此最优策略在每个位置选择 token `3` 的概率为：

$$
\pi^*(3)
=
\frac{e^{0.125 / 0.1}}{7 + e^{0.125 / 0.1}}
\approx
0.333,
$$

对应的 KL 约为 1.16，与训练得到的结果基本一致。这说明 PPO 确实在优化“奖励减去 KL 惩罚”这一目标，而 $\beta$ 直接决定了策略在奖励与参考模型之间停在哪里。

# 结语

PPO 的目标函数只有一行，但它背后是一条完整的推导链：

1. **MDP** 把决策问题形式化，目标是最大化期望回报；
2. **价值函数**评价状态与动作的好坏，**优势函数**衡量一个动作比平均水平好多少；
3. **策略梯度**直接优化参数化的策略，梯度中不含环境模型，而基线在不引入偏差的前提下降低方差；
4. **Actor-Critic** 用 Critic 参与估计回报，**GAE** 通过 $\lambda$ 在偏差与方差之间灵活权衡；
5. **重要性采样**让旧数据可以用于评估新策略，**信任域**则要求新旧策略不能相差太远；
6. **PPO** 用裁剪代替 TRPO 的 KL 约束，只需一阶优化即可在同一批数据上多轮更新。

放到 LLM 上，这条链几乎不需要改动：token 是动作，前缀是状态，奖励模型给出序列级分数，参考模型的 KL 惩罚防止奖励欺骗，Critic 与 GAE 负责把稀疏的奖励分配到每个 token 上。理解了这些，再去看 RLHF 框架中复杂的训练代码，就能看清每一部分对应的是哪个概念。

# 参考资料

- [small-language-model](https://github.com/Momoyeyu/small-language-model)
- [Reinforcement Learning: An Introduction](http://incompleteideas.net/book/the-book-2nd.html)
- [OpenAI Spinning Up in Deep RL](https://spinningup.openai.com/)
- [Simple Statistical Gradient-Following Algorithms for Connectionist Reinforcement Learning](https://link.springer.com/article/10.1007/BF00992696)
- [High-Dimensional Continuous Control Using Generalized Advantage Estimation](https://arxiv.org/abs/1506.02438)
- [Trust Region Policy Optimization](https://arxiv.org/abs/1502.05477)
- [Proximal Policy Optimization Algorithms](https://arxiv.org/abs/1707.06347)
- [The 37 Implementation Details of Proximal Policy Optimization](https://iclr-blog-track.github.io/2022/03/25/ppo-implementation-details/)
- [Approximating KL Divergence](http://joschu.net/blog/kl-approx.html)
- [Fine-Tuning Language Models from Human Preferences](https://arxiv.org/abs/1909.08593)
- [Learning to Summarize from Human Feedback](https://arxiv.org/abs/2009.01325)
- [Training Language Models to Follow Instructions with Human Feedback](https://arxiv.org/abs/2203.02155)
- [Secrets of RLHF in Large Language Models Part I: PPO](https://arxiv.org/abs/2307.04964)
