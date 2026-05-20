---
title: Python 序列
published: 2023-01-20
description: 'Python 序列的通用运算、is 与 == 的区别、id() 函数与迭代器基础。'
tags: [Python]
category: Python 入门
episode: 4
draft: false
lang: 'zh_CN'
---

> 参考资料：
> [【Python教程】《零基础入门学习Python》最新版（2022年12月26日更新）](https://www.bilibili.com/video/BV1c4411e77t)

# 序列

Python中，列表、元组和字符串都属于序列

## 1. 序列的基本运算

> 加法 \+  
> 乘法 \*  

```python
a = [1, 2, 3]
b = [4, 5, 6]
c = a + b
d = a * 2
print(c)
print(d)
```
```text
[1, 2, 3, 4, 5, 6]
[1, 2, 3, 1, 2, 3]
```

## 2. 序列的判定函数

### 2.1 关键词'is' & 'is not'
```python
a = [1, 2, 3]
b = [1, 2, 3]
print("a == b?")
print("True") if a == b else print("False")
print("a is b?")
print("True") if a is b else print("False")
```
```text
a == b?
True
a is b?
False
```
第一次判定的是'a'与'b'的元素值是否相等，而第二次判定的是'a'与'b'是否与同一组数据挂钩  
放在C语言中，就好比'=='判断变量储存的数值是否相等，而'is'判断他们是否指向同一个内存地址  
但是在Python中，我们一般认为变量名并不是储存了数据，而是与数据挂钩，同时一般Python也不常用指针的概念  
这是因为Python对指针做了良好封装，一切都是“对象”，一切对象都有一个“变量”指向它。这个“变量”就是“指针”  

> 而'is'和'is not'就是用来判断'a'和'b'是否指向了同一个`对象`，其本质和比较指针是一样的

### 2.2 id()
> Return the identity of an object.
```python
a = (1, 2, 3)
b = 1, 2, 3
print("True") if id(a) == id(b) else print("False")
c = [1, 2, 3]
d = [1, 2, 3]
print("True") if id(c) == id(d) else print("False")
```
```text
True
False
```
> id()相当于C语言中取地址符，它得到的相当于与变量名挂钩的数据的"身份证"，只要数据存在于内存中，这个值就唯一

### 2.3 关键词'in' & 'not in'
```python
a = (1, 2, 3)
b = 1, 2, 3
print("1 in a?")
print("True") if 1 in a else print("False")
print("a not in b?")
print("True") if a not in b else print("False")
```
```text
1 in a?
True
a not in b?
True
```

## 3. 关键词'del'

作用：删除
```python
x = [1, 2, 3, 4, 5]
print(x)
del x[0]
print(x)
del x[:2]
print(x)
del x[:]
print(x)
del x
print(x)
```
```text
[1, 2, 3, 4, 5]
[2, 3, 4, 5]
[4, 5]
[]
Traceback (most recent call last):
  File "D:\PycharmProjects\test\main.py", line 10, in <module>
    print(x)
NameError: name 'x' is not defined
```

## 4. 序列基本函数

### 4.1 list() & tuple() & str()

> list(iterable)  
> tuple(iterable)  
> str(object) # str(object='') \-> str  

```python
print(list("Momoyeyu"))
print(tuple("Momoyeyu"))
print(str("Momoyeyu"))
print(str(list("Momoyeyu")))
```
```text
['M', 'o', 'm', 'o', 'y', 'e', 'y', 'u']
('M', 'o', 'm', 'o', 'y', 'e', 'y', 'u')
Momoyeyu
['M', 'o', 'm', 'o', 'y', 'e', 'y', 'u']
```

### 4.2 max() & min()

> max(iterable, \*[, default=obj, key=func])
> min(iterable, \*[, default=obj, key=func]) 
> 注：可选参数default默认是报错，可以设置内容  

```python
print(max([1, 2, 3, 4, 5]))
print(min("Momoyeyu"))
print(min([], default = "Empty!"))
```
```text
5
M
Empty!
```
### 4.3 len() & sum()

> len(obj) 
> sum(iterable, /, start=0)
> 注：可选参数start默认是0，可以设置起始值

```python
print(len(range(2 ** 10)))
print(sum([1, 2, 3, 4, 5], start=10))
```
```text
1024
25
```

### 4.4 sorted() & reversed()

> sorted(iterable, /, \*, key=None, reverse=False)  
> reversed(sequence) # Return a reverse iterator over the values of the given sequence.  

```python
print(sorted([3, 1, 4, 2]))
print(sorted(["Momoyeyu", "Gger", "Guitar"], key=len, reverse=True))
print(reversed([1, 0, 0, 8, 6]))
print(list(reversed([1, 0, 0, 8, 6])))
```
```text
[1, 2, 3, 4]
['Momoyeyu', 'Guitar', 'Gger']
<list_reverseiterator object at 0x000002891CDAFE20>
[6, 8, 0, 0, 1]
```
由输出第3行我们注意到，reversed()返回的不是一个列表，根据Python官方文档说明，reversed()返回的是一个`迭代器`

### 4.5 all() & any()

> all(iterable)
> any(iterable)

```python
print(all([1, 1, 0]))
print(any([0, 0, 1]))
```
```text
False
True
```

## 5. 关于迭代器\-iterator

### 5.1 enumerate()

> enumerate(iterable, start=0) # 返回一个枚举对象  
> 注：可选参数start可以设置起始序号  

```python
Kisetsu = ["Haru", "Natsu", "Aki", "Huyu"]
print(enumerate(Kisetsu))
print(list(enumerate(Kisetsu)))
print(list(enumerate(Kisetsu, 10)))
```
```text
<enumerate object at 0x0000014117E308C0>
[(0, 'Haru'), (1, 'Natsu'), (2, 'Aki'), (3, 'Huyu')]
[(10, 'Haru'), (11, 'Natsu'), (12, 'Aki'), (13, 'Huyu')]
```

### 5.2 zip()

> zip(\*iterables, strict=False) # Return an iterator  

```python
x, y = [1, 2, 3], [4, 5, 6]
z = zip(x, y)
print(z)
print(list(z))
```
```text
<zip object at 0x0000022F43B43040>
[(1, 4), (2, 5), (3, 6)]
```

### 5.3 itertools.zip_longest()
```python
print(list(zip([1, 2, 3], "Momoyeyu")))
import itertools
print(list(itertools.zip_longest([1, 2, 3], "Momoyeyu")))
```
```text
[(1, 'M'), (2, 'o'), (3, 'm')]
[(1, 'M'), (2, 'o'), (3, 'm'), (None, 'o'), (None, 'y'), (None, 'e'), (None, 'y'), (None, 'u')]
```
zip()默认进行的是截短运算，但可以从itertools中引用itertools.zip_longest()来进行保长运算

### 5.4 map() & filter()

> map(func, \*iterables)  
> 注：func指的是一套运算规则，map()会将\*iterables中的对象都按照func进行计算然后返回其结果组成的iterator

```python
print(list(map(ord, "Momoyeyu")))
print(list(map(pow, [2, 2, 2], [8, 9, 10, 11])))
```
```text
[77, 111, 109, 111, 121, 101, 121, 117]
[256, 512, 1024]
```
由输出第二行可以看出，对于数据长度不同时，map()与zip()相同，选择了截短运算

> filter(function or None, iterable)
> 注：和map()类似，但只将结果为True的元素返回到iterator

```python
print(list(filter(str.islower, "G-ger")))
```
```text
['g', 'e', 'r']
```

## 6. 迭代器和可迭代对象\-iterator & iterable

> iterator是一次性的，而iterable可以重复使用

> 可参考[迭代器和可迭代对象](https://blog.csdn.net/pythonandaiot/article/details/122312616)

### 6.1 iterator

```python
x = [1, 2, 3, 4, 5]
y = iter(x)
print(type(x))
print(type(y))
i = 0
while i < len(x):
    i+=1
    print(next(y, "Empty"), end=" ")
print(next(y, "Empty"))
```
```text
<class 'list'>
<class 'list_iterator'>
1 2 3 4 5 Empty
```
next()函数可以让iterator进行一次迭代，迭代到尽头之后就会报错，可以设置报错内容

### 6.2 iterable

可迭代对象可以理解为可以重复使用的迭代器  
iterable可以进行迭代，迭代完成后，它又可以被引用，从头进行迭代，因为它的数据还被完整保留着  
而iterator迭代完成之后，迭代器里的数据就被释放完了，不可再次使用  

一个迭代器`肯定`是一个可迭代对象

### 6.3 iterator与iterable比较

> 根据应用场景不同，他们有各自的优劣： 
> iterator: 不会占用太多资源储存数据，他只会由现在的数据迭代计算下一个数据，但这个过程往往是不可逆的，迭代后上一个数据就抛弃了
> iterable: 可以重复使用，迭代后之前的数据也得到保存，但比较占用资源