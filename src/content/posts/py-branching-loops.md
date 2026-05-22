---
title: Python 分支与循环
published: 2023-01-20
description: 'Python 中 if/elif/else 分支结构与 while/for 循环的基本语法与用法。'
tags: [Python]
category: Python 入门
episode: 1
draft: false
lang: 'zh_CN'
---

> 参考资料：
> [【Python教程】《零基础入门学习Python》最新版（2022年12月26日更新）](https://www.bilibili.com/video/BV1c4411e77t)

# 分支结构

## 1. if结构
```python
if condition:
    statement_1(s1)
statement_2(s2)
```
## 2. if-else结构
```python
if condition:
    statement_1(s1)
else:
    statement_2(s2)
statement_3(s3)
```
## 3. if-elif-elif...(-else)结构
```python
if condition_1:
    statement_1(s1)
elif condition_2:
    statement_2(s2)
...
# else:
#     statement_n(sn)
```
## 4. oneline结构
```python
true_statement if condition else false_statement
```

# 循环结构

## 1. while循环

### 1.1 基本结构
```python
while condition:
    statement_1(s1)
statement_2(s2)
```
### 1.2 while-break结构
```python
while condition_1:
    statement_1(s1)
    if condition_2:
        break
    statement_2(s2)
statement_3(s3)
```
### 1.3 while-else结构
```python
while condition_1:
    statement_1(s1)
    if condition_2:
        break
    statement_2(s2)
else:
    statement_3(s3)
statement_4(s4)
```
> [!NOTE]
> 仅在循环由condition_1退出时才执行else，由break终止则不执行else

### 1.4 嵌套结构
```python
i = 1
while i <= 9:
    j = 1
    while j <= i:
        print(j, "*", i, "=", j*i, end=" ")
        j += 1
    print()
    i += 1
```
```text
1 * 1 = 1 
1 * 2 = 2 2 * 2 = 4 
1 * 3 = 3 2 * 3 = 6 3 * 3 = 9 
1 * 4 = 4 2 * 4 = 8 3 * 4 = 12 4 * 4 = 16 
1 * 5 = 5 2 * 5 = 10 3 * 5 = 15 4 * 5 = 20 5 * 5 = 25 
1 * 6 = 6 2 * 6 = 12 3 * 6 = 18 4 * 6 = 24 5 * 6 = 30 6 * 6 = 36 
1 * 7 = 7 2 * 7 = 14 3 * 7 = 21 4 * 7 = 28 5 * 7 = 35 6 * 7 = 42 7 * 7 = 49 
1 * 8 = 8 2 * 8 = 16 3 * 8 = 24 4 * 8 = 32 5 * 8 = 40 6 * 8 = 48 7 * 8 = 56 8 * 8 = 64 
1 * 9 = 9 2 * 9 = 18 3 * 9 = 27 4 * 9 = 36 5 * 9 = 45 6 * 9 = 54 7 * 9 = 63 8 * 9 = 72 9 * 9 = 81 
```
## 2. for循环

### 2.1 基本结构
```python
for identifier in iterable:
    statement_1(s1)
statement_2(s2)
```

```python
sum = 0
for i in range(10):
    sum += i
print(sum)
# 45
```

### 2.2 range()函数

> range(stop)  
> range(start, stop)  
> range(start, stop, step)  

```python
for n in range(2, 10):
    for m in range(2, n):
            if n % m == 0:
                print(n, "=", m, "*", n // m)
                break
    else:
        print(n, "is a prime number")
```
```text
2 is a prime number
3 is a prime number
4 = 2 * 2
5 is a prime number
6 = 2 * 3
7 is a prime number
8 = 2 * 4
9 = 3 * 3
```