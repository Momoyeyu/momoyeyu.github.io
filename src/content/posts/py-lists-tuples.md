---
title: Python 列表与元组
date: 2023-01-17
description: 'Python 列表与元组的创建、访问、切片、排序及常用操作方法。'
tags: [Python]
category: Python 入门
episode: 2
draft: false
lang: 'zh_CN'
---

> 参考资料：
> [【Python教程】《零基础入门学习Python》最新版（2022年12月26日更新）](https://www.bilibili.com/video/BV1c4411e77t)

# 列表

## 1. 创建列表
```python
mlist = [1, 2, 3, 4, 5, 6]
_ = []
```

## 2. 访问列表
```python
print(mlist[0], end=" ")
print(mlist[-1])
# 1 6
```

```python
for each in mlist:
	print(each, end=" ")
# 1 2 3 4 5 6
```

## 3. 修改列表

**3.1 通过下标索引修改**
```python
mlist = [1, 1, 3, 4, 5]
mlist[1] = 2
```
结果：mlist = [1, 2, 3, 4, 5]

**3.2 通过切片修改**
```python
mlist[3:] = [2, 1]
```
结果：mlist = [1, 2, 3, 2, 1]

**3.3 通过运算符修改**
```python
_1 = [1, 2]
_2 = [3, 4]
_ = _1 + _2
# _ = [1, 2, 3, 4]
```

## 4. 切片

### 4.1 切片访问列表
```python
mlist = [1, 2, 3, 4, 5, 6]
mlist[2:4]
# [3, 4]
mlist[:3]
# [1, 2, 3]
mlist[2:]
# [3, 4, 5, 6]
mlist[:]
# [1, 2, 3, 4, 5, 6]
mlist[0:6:2]
# [1, 3, 5]
mlist[::-1]
# [6, 5, 4, 3, 2, 1]
```
切片访问语法：`列表名[起始下标:停止下标:检索跨度]`

注意：切片访问返回的是一个可迭代对象，所以切片可以实现浅拷贝
```python
mlist_copy = mlist[:]
```

### 4.2 切片修改列表
```python
mlist = [1, 2, 3, 4, 5, 6]
mlist[len(mlist):] = [7]
# mlist = [1, 2, 3, 4, 5, 6, 7]
mlist[len(mlist):] = [8, 9]
# mlist = [1, 2, 3, 4, 5, 6, 7, 8, 9]
```
## 5. 函数

|                      函数                       |                          功能                           |
| :---------------------------------------------: | :-----------------------------------------------------: |
|            mlist.append(an element)             |             将`一个元素`追加到列表mlist末尾             |
|             mlist.extend(iterable)              |           将`迭代结果`逐个追加到列表mlist末尾           |
|       mlist.insert(an index, an element)        |         将该元素`插入`到列表mlist的指定下标位置         |
|            mlist.remove(an element)             | 将该元素从列表mlist中`删除`，若元素不在列表内，则会报错 |
|               mlist.pop(an index)               |             将该下标对应元素从列表中`弹出`              |
|                  mlist.clear()                  |                 将列表mlist变为`空列表`                 |
|       mlist.sort(key=None, reverse=False)       |      将列表mlist`排序`，参数reverse控制是否`倒序`       |
|                 mlist.reverse()                 |                    将列表`倒序`排列                     |
|             mlist.count(an element)             |              返回这个元素在列表中的`个数`               |
| mlist.index(an element, start index, end index) |       返回这个元素的`下标`，若有多个则返回第一个        |
|                  mlist.copy()                   |                  返回原列表的`浅拷贝`                   |
|                   len(mlist)                    |               返回值等于列表mlist的`长度`               |

## 6. 嵌套列表
初始化
```python
matrix = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
matrix = [[1, 2, 3], 
          [4, 5, 6],
          [7, 8, 9]]
A = [0] * 3
for i in range(3):
    A[i] = [0] * 3
```

`注： 不要这样声明嵌套列表：`B = [[0] \* 3] \* 3

这样声明的列表其实是对同一个[0, 0, 0]引用三次

即假设 B[0][0] = 1，则B = [[1, 0, 0], [1, 0, 0], [1, 0, 0]]
```python
B[0] is B[1]
# True
```
访问
```python
matrix[0]
# [1， 2， 3]
matrix[0][0]
# 1
for i in matrix:
    for j in i:
        print(j, end=" ")# 空格结尾
    print() # 换行
# 1 2 3
# 4 5 6
# 7 8 9
```

## 7. 列表名与列表
```python
x = [1, 2, 3]
y = x
x is y
# True 说明x与y表示同一个列表
```
注：Python中，变量名并不是一个盒子，数据并非储存在变量中，而是变量名与数据挂钩，列表名能够引用其指向的数据

## 8. 列表拷贝
在Python中，拷贝可以分为浅拷贝和深拷贝

在嵌套结构中，对其中所嵌套元素，浅拷贝仅拷贝其引用，而深拷贝会将嵌套元素也拷贝
```python
mlist = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
import copy # 深拷贝所在库
mlist_copy1 = mlist # 引用赋值（非拷贝，mlist_copy1 与 mlist 指向同一对象）
mlist_copy2 = copy.copy(mlist) # 浅拷贝
mlist_copy3 = copy.deepcopy(mlist) # 深拷贝
```

## 9. 列表推导式
语法：

基本形式：_ = [expression for target in iterable]

筛选形式：_ = [expression for target in iterable if condition]

完整形式：
```
_ = [expression for target1 in iterable1 if condition1  
                for target2 in iterable2 if condition2  
                                 ...  
                for target3 in iterable3 if condition3]
```

等价于：
```
_ = []
for target1 in iterable1:
    if condition1:
        for target2 in iterable2:
            if condition2:
                ...
                    _ = expression
```

**示例**
1. 
```python
mlist = [1, 2, 3, 4, 5]
mlist = [i * 2 for i in mlist]
# mlist = [2, 4, 6, 8, 10]
```
2. 
```python
mlist = [char * 2 for char in "Momoyeyu"]
# mlist = ['MM', 'oo', 'mm', 'oo', 'yy', 'ee', 'yy', 'uu']
```
3. 
```python
matrix = [[1, 2, 3], 
          [4, 5, 6],
          [7, 8, 9]]
diag = [matrix[i][i] for i in range(len(matrix))]
# diag = [1, 5, 9]
```
4. 
```python
matrix = [[1, 2, 3], 
          [4, 5, 6],
          [7, 8, 9]]
flatten = [col for row in matrix for col in row]
# flatten = [1, 2, 3, 4, 5, 6, 7, 8, 9]
```
等价于：
```python
flatten = []
for row in matrix:
    for col in row:
        flatten.append(col)
```
5. 
```python
_ = [[x, y] for x in range(10) if x % 2 == 0 for y in range(10) if y % 3 == 0]
# _ = [[0, 0], [0, 3], [0, 6], [0, 9], [2, 0], [2, 3], [2, 6], [2, 9], [4, 0], [4, 3], [4, 6], [4, 9], [6, 0], [6, 3], [6, 6], [6, 9], [8, 0], [8, 3], [8, 6], [8, 9]]
```
等价于：
```python
_ = []
for x in range(10):
    if x % 2 == 0:
        for y in range(10):
            if y % 3 == 0:
                _.append([x, y])
```

# 元组

许多部分与列表相似，因此不多赘述，没有提到的部分基本都可以参考列表进行操作

## 1. 创建与访问元组
创建：
```python
_1 = (1, 2, 3, 4, 5)
_2 = 1, 2, 3, 4, 5
_1 == _2 # True
_1 is _2 # False
```

注：建立元组可以省略小括号，但一定需要加逗号
```python
x = 1
type(x) # <class 'int'>
y = 1,
type(y) # <class 'tuple'>
```

访问：与访问列表基本一致

## 2. 元组的修改

**`元组不可修改，指的是元组中每个元素的指向永远不变，但元素指向的数据可以发生改变`**

```python
_ = (1, 2, 3 , 4, 5)
_[0] = 0
# Traceback (most recent call last):
#   File "<pyshell#9>", line 1, in <module>
#     _[0] = 0
# TypeError: 'tuple' object does not support item assignment
```
```python
_ = (1, 2, 3, 4, [1, 2, 3])
_[4].append(4)
# _ = (1, 2, 3, 4, [1, 2, 3, 4])
```

## 3. 解包操作

列表，元组，字符串都可以使用解包操作

```python
t = (1, 2, 3)
x, y, z = t
# x = 1; y = 2; z = 3
```
```python
x, y, z = "Momoyeyu"
# Error 左侧变量名和右侧元素数量不等
x, y, *z = "Momoyeyu"
# x = M; y = o; z = "moyeyu"
```

Python的`多重赋值`本质就是先将值包装为元组，再解包与各个变量名挂钩
```python
x, y = 1, 2
```
等价于：
```python
_ = (1, 2)
x, y = _
```
