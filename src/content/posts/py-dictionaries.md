---
title: Python 字典
date: 2023-01-22
description: 'Python 字典的声明方式、增删改查操作，以及映射关系在实际问题中的应用。'
tags: [Python]
category: Python 入门
episode: 5
draft: false
lang: 'zh_CN'
---


# 字典

字典是Python中唯一实现`映射关系`的内置类型

## 1. 解决单表代换密码问题

### 1.1 模拟字典方法

> `以下不是真正的字典，但可以实现类似的功能`

> 1. 通过两个列表对照实现
```python
c_table = ["cipher1", "cipher2"...] # 密文表
d_table = ["plain1", "plain2"...] # 明文表
cipher = input("input your cipher") # 输入密文
split_cipher = cipher.split(" ") # 密文拆分
result = [d_table[c_table.index(each)] for each in split_cipher] # 通过查找密文下标找到对应下标明文来解密
print(result) # 打印结果
```
> 2. 通过一个列表实现
```python
table = ["cipher1", "plain1", "cipher2", "plain2" ...]
cipher = input(...) # 输入密文
split_cipher = cipher.split(" ") # 密文拆分
result = [table[table.index(each) + 1] for each in split_cipher] # 通过查找密文下标，得到其下一位，即对应的明文
print(result) # 打印结果
```

> 这两种方法在处理小量数据的时候和字典效率相差不大，但由于其数据结构本身不是映射关系，实际在处理大量数据时效率远不及字典

### 1.2 字典方法
```python
table = {"cipher1":"plain1", "cipher2":"plain2", "cipher3":"plain3"...}
cipher = input("input your cipher")
split_cipher = cipher.split(" ")
result = [table[each] for each in split_cipher]
print(result)
```

## 2. 字典基础用法

Python中，字典内一对数据叫做一个`键值对`：dic = {"键":"值"}，一个键对应一个值

### 2.1 字典的6种一般声明方法
```python
a = {"alpha":"a", "bravo":"b"...}
b = dict(alpha="a", bravo="b"...)
c = dict([("alpha", "a"), ("bravo", "b")...])
d = dict({"alpha":"a", "bravo":"b"...})
e = dict({"alpha":"a", "bravo":"b"...}, charlie="c"...)
f = dict(zip(["alpha", "bravo", "charlie"...], ["a", "b", "c"...]))
a == b == c == d == e == f # True # <class 'dict'>
```

### 2.2 fromkeys声明

> fromkeys(iterable, value) 其中value是可选参数，默认为None
```python
dic = dict.fromkeys("Momoyeyu", 0) # 键被看作集合，重复的o和y只会存一个
print(dic)
```
> Output
> {'M': 0, 'o': 0, 'm': 0, 'y': 0, 'e': 0, 'u': 0}

### 2.3 修改字典

```python
dic = dict.fromkeys("Momoyeyu", 0)
print(dic)
dic["M"] = 1 # 改
dic["New"] = 2 # 增
dic.pop("o") # 删 （pop的返回值是删除的值）
print(dic)
```
> Output:  
> {'M': 0, 'o': 0, 'm': 0, 'y': 0, 'e': 0, 'u': 0}  
> {'M': 1, 'm': 0, 'y': 0, 'e': 0, 'u': 0, 'New': 2}  


> [!IMPORTANT]
> 键被当作下标使用，这也解释了为什么键要被视为集合储存：`具有无序性和唯一性`  
> 一个字典中没有两个相等的键，但不同的键可以关联同一个值，`键重复了就用新的值覆盖旧的值`  

**2.3.1 关于删除**

> 1. dic.pop(key, default)  
> 若pop的键key不存在dic中，pop会报错，但也可以通过可选参数default来设置报错内容  
>
> 2. dic.popitem()  
> 在 Python 3.7 以后的版本，字典的键值对才有储存顺序，popitem 会弹出最后一个加入字典 dic 的键值对  
> 但在 Python 3.7 以前的版本，popitem 会随机弹出一个键值对  
>
> 3. del关键词  
> 通过 del dic['键'] 也可以删除一个键值对，也可以 del dic 直接删除字典，注意和 dic.clear() 区分  
>
> 4. clear()  
> 通过 dic.clear() 可以得到空字典，注意和 del dic 区分  

## 3. 其他字典函数

函数|功能
:-:|:-:
dic.get(key, default=None)|查找key对应的value，不存在则返回None
dic.setdefault(key, value)|查找key的值，若key存在，返回key原本的value；若key不存在，则把键值对key:value添加到dic中
dic.keys()|返回dic的`键的视图对象`
dic.values()|返回dic的`值的视图对象`
dic.items()|返回dic的`字典视图对象`

### 3.1 关于视图对象

视图对象是字典的`动态`视图，字典改变的时候，其视图对象会随之改变

```python
dic = dict.fromkeys("Momoyeyu", 0)
keys = dic.keys()
values = dic.values()
items = dic.items()
print(keys)
print(values)
print(items)
dic.pop('M')
print(items)
```
> Output:  
> dict_keys(['M', 'o', 'm', 'y', 'e', 'u'])  
> dict_values([0, 0, 0, 0, 0, 0])  
> dict_items([('M', 0), ('o', 0), ('m', 0), ('y', 0), ('e', 0), ('u', 0)])  
> dict_items([('o', 0), ('m', 0), ('y', 0), ('e', 0), ('u', 0)])  


## 4. 嵌套字典
```python
a = {"Momoyeyu":{"Chinese":60, "Math":50, "English":40}}
b = {"Momoyeyu":[60, 50, 40]}
print(a["Momoyeyu"]["Math"], end=" ")
print(b["Momoyeyu"][1])
```
> Output:  
> 50 50