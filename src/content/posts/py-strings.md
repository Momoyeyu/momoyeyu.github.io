---
title: Python 字符串
published: 2023-01-19
description: 'Python 字符串的大小写转换、查找替换、格式化输出与常用判断函数。'
tags: [Python]
category: Python 入门
episode: 3
draft: false
lang: 'zh_CN'
---

> 参考资料：
> [【Python教程】《零基础入门学习Python》最新版（2022年12月26日更新）](https://www.bilibili.com/video/BV1c4411e77t)

# 字符串

关于字符串，主要分为两大块知识：一块是各种字符串相关函数，另一块是format字符串和f-string

## 1. 字母大小写转换

|       函数       |                功能                |
| :--------------: | :--------------------------------: |
| str.capitalize() |        首字母大写，其余小写        |
|  str.casefold()  |  字母全变为小写，可以支持多种语言  |
|   str.title()    |   每个单词首字母都大写，其余小写   |
|  str.swapcase()  |      字母大小写全部和原来相反      |
|   str.upper()    | 字母全变为大写，英语之外可能不支持 |
|   str.lower()    |           字母全变为小写           |

> [!NOTE]
> 这些函数都没有直接改变str指向的字符串，而是按规则生成了一个新的字符串，即str还是与原本的字符串挂钩。
> 因此要改变str时：str = str.function()

## 2. 对齐函数
|              函数               |                                 功能                                 |
| :-----------------------------: | :------------------------------------------------------------------: |
| str.center(width, fillchar=' ') |         width设置总字符数，fillchar设置填充字符，使str`居中`         |
|  str.ljust(width, fillchar=' ')  |        width设置总字符数，fillchar设置填充字符，使str`左对齐`        |
|  str.rjust(width, fillchar=' ')  |        width设置总字符数，fillchar设置填充字符，使str`右对齐`        |
|        str.zfill(width)         | width设置总字符数，str左侧用0填充，若str是数字字符串，可以支持正负数 |

## 3. 查找函数
|            函数             |                                        功能                                         |
| :-------------------------: | :---------------------------------------------------------------------------------: |
| str.count(char, start, end) |                  返回str在所选范围char的`个数`，起止位置为可选参数                  |
| str.find(char, start, end)  | 返回str在所选范围`从左往右`第一个为char的`下标`，找不到则返回-1，起止位置为可选参数 |
| str.rfind(char, start, end) | 返回str在所选范围`从右往左`第一个为char的`下标`，找不到则返回-1，起止位置为可选参数 |
|         str.index()         |  返回str在所选范围`从左往右`第一个为char的`下标`，找不到则报错，起止位置为可选参数  |
|        str.rindex()         |  返回str在所选范围`从右往左`第一个为char的`下标`，找不到则报错，起止位置为可选参数  |

## 4. 转换函数
|                  函数                   |                                               功能                                               |
| :-------------------------------------: | :----------------------------------------------------------------------------------------------: |
|           str.expandtabs(num)           |                                  将str中所有Tab转换为num个空格                                   |
|     str.replace(old, new, count=-1)     |                将str中old转换为new，可选参数count设置转换个数，默认-1表示全部转换                |
|          str.translate(table)           |            table表示一个转换规则，可由maketrans()生成，可以实现table中对应字符的转换             |
| str.maketrans(origin, trans, ignorestr) | 生成一个转换规则，表示将origin中的对象转换为trans中对应的对象，与ignorestr相同的字符串不会被转换 |

## 5. 判断函数

> 这类函数会根据判断的结果返回bool类型数值

|                函数                |                                          功能                                          |
| :--------------------------------: | :------------------------------------------------------------------------------------: |
| str.startswith(prefix, start, end) | 判断是否以prefix开头，prefix可以为元组，元组中任意一个元素满足即可，起始位置为可选参数 |
|  str.endswith(suffix, start, end)  | 判断是否以suffix结尾，suffix可以为元组，元组中任意一个元素满足即可，起始位置为可选参数 |
|           str.isupper()            |                                    判断是否全为大写                                    |
|           str.islower()            |                                    判断是否全为小写                                    |
|           str.istitle()            |                                 判断str是否为标题格式                                  |
|           str.isalpha()            |                                    判断是否全为字母                                    |
|           str.isascii()            |                                   判断是否都为ascii                                    |
|           str.isspace()            |                       判断是否都为空白字符(空格、Tab、换行符等)                        |
|         str.isprintable()          |                                   判断是否都可以打印                                   |
|          str.isdecimal()           |                           判断是否数字的一个标准（范围最小）                           |
|           str.isdigit()            |                           判断是否数字的一个标准（范围适中）                           |
|          str.isnumeric()           |                           判断是否数字的一个标准（范围最大）                           |
|           str.isalnum()            |                                 判断是否全为字母或数字                                 |
|         str.isidentifier()         |                            判断str是否为Python的合法标识符                             |

**5.1 prefix/suffix为元组的例子**
```python
if "她爱Python".startswith(("我", "你", "她")):
    print("总有人爱Python")
# "总有人爱Python"
```
**5.2 isdecimal() & isdigit() & isnumeric() 区别**
```python
x = "123"
# All: True
x = "2²"
# x.isdecimal(): False
# x.isdigit() & x.isnumeric(): True
x = "一二三"
# x.isdecimal() & x.isdigit(): False
# x.isnumeric(): True
x = "我不是数字"
# All: False
```

## 6. 截取函数
|           函数           |                                                    功能                                                     |
| :----------------------: | :---------------------------------------------------------------------------------------------------------: |
|  str.strip(chars=None)   | 从左右两侧删除选定字符，直到遇到第一个非选定字符时停止；默认None表示空白字符，chars是字符串，`会被视为集合` |
|  str.lstrip(chars=None)  |   从左侧删除选定字符，直到遇到第一个非选定字符时停止；默认None表示空白字符，chars是字符串，`会被视为集合`   |
|  str.rstrip(chars=None)  |   从右侧删除选定字符，直到遇到第一个非选定字符时停止；默认None表示空白字符，chars是字符串，`会被视为集合`   |
| str.removeprefix(prefix) |                                               去除前缀prefix                                                |
| str.removesuffix(suffix) |                                               去除后缀suffix                                                |


## 7. 拆分与拼接
|               函数                |                                                         功能                                                         |
| :-------------------------------: | :------------------------------------------------------------------------------------------------------------------: |
|        str.partition(char)        |                            `从左往右`找到第一个为char的字符，以此为结点拆分得到一个三元组                            |
|       str.rpartition(char)        |                            `从右往左`找到第一个为char的字符，以此为结点拆分得到一个三元组                            |
| str.split(sep=None, maxsplit=-1)  | 将str拆分为多个字符串并返回其组成的列表；sep设置拆分字符，默认为空白字符；maxsplit设置最大分割数，默认-1表示全部拆分 |
| str.rsplit(sep=None, maxsplit=-1) |                                         从右往左开始拆分，功能与split()相同                                          |
|    str.splitlines(save=False)     |         以换行符为拆分字符将str拆分，可识别`不同系统的换行符`；可选参数save控制是否保留换行符到其前面的子串          |
|        str.join(iterable)         |                                  以str为结点连接iterable中各个元素，str可为空字符串                                  |


> 7.1 不同系统的换行符
> > Unix, Linux: \n
> > Max OS: \r
> > Windows: \r\n

> [!TIP]
> join() 比 + 的优势在于 join() 的`处理效率`远高于 + 

## 8. format字符串

### 8.1 基础用法
问题来源：
```python
year = 2023
month = 1
print("现在是 year 年 month 月")
# 现在是 year 年 month 月
```
类似于 C/C++ 中的转义字符，Python 的字符串也需要类似转义字符的存在
```python
year = 2023
print("现在是 {} 年 {} 月".format(year, month))
# 现在是 2023 年 1 月
```
{}中可以通过写`下标`选择format()中的数据，且可以`重复使用`
```python
print("{}爱{}".format("我", "你"))
# 我爱你
print("{1}爱{0}".format("我", "你"))
# 你爱我
print("{0}{0}{1}{2}".format("mo", "ye", "yu"))
# momoyeyu
print('{2},{1},{0}'.format(*'abc'))
# c,b,a
```
还可以使用`关键字参数`
```python
print("我是{name}，我喜欢{fav}".format(name = "墨末夜羽", fav = "吉他"))
# 我是墨末夜羽，我喜欢吉他
print("我是{fav}，我喜欢{name}".format(name = "墨末夜羽", fav = "吉他"))
# 我是吉他，我喜欢墨末夜羽
```

### 8.2 语法格式
> format_spec ::=  [[fill]align][sign][#][0][width][,][.precision][type]
> fill        ::=  <any character> `# 填充字符`
> align       ::=  "<" | ">" | "=" | "^" `# 填充位置`
> sign        ::=  "+" | "-" | " " `# 显示符号`
> width       ::=  integer `# 打印宽度`
> precision   ::=  integer `# 浮点数精度`
> type        ::=  "b" | "c" | "d" | "e" | "E" | "f" | "F" | "g" | "G" | "n" | "o" | "s" | "x" | "X" | "%" `# 数据表达方式`

8.2.1 示例
```python
"{1:^10}{0:<10}".format("123", "456")
# '   456    123       ' # 居；左对齐
"{:08}{:08}".format(1024,-1024)
# '00001024-0001024' # 填充0；0不影响符号
"{a:*>10}|{b:*<10}".format(a=120,b=110)
# '*******120|110*******' # 选择*为填充字符
"{:+,}||{:-_}".format(1234567,7654321)
# '+1,234,567||7_654_321' # 正数显示正号，每3位用（，）分开；负数显示负号（默认就显示），每3位用（_）分开
"{:.2f}||{:.3g}".format(12.3456,12.345)
# '12.35||12.3' # 小数点后保留2位数；总共保留3位数
"{:.4}".format("Momoyeyu")
# "Momo" # 保留前4个字符（对数字不可用）
"{0:d}||{0:c}||{0:b}||{0:o}||{0:x}||{0:#b}||{0:#o}||{0:#x}||{0:e}".format(127)
# '127||\x7f||1111111||177||7f||0b1111111||0o177||0x7f||1.270000e+02' # 详情看下表
```

8.2.2 关于type

|  值   |                                含义                                 |
| :---: | :-----------------------------------------------------------------: |
|   b   |                            以二进制输出                             |
|  #b   |              b的基础上，会在数前标0b，表示这是二进制数              |
|   c   |                            以Unicode输出                            |
|   d   |                            以十进制输出                             |
|   o   |                            以八进制输出                             |
|  #o   |              o的基础上，会在数前标0o，表示这是八进制数              |
|   x   |                           以十六进制输出                            |
|  #x   |             x的基础上，会在数前标0x，表示这是十六进制数             |
|   X   |                           以十六进制输出                            |
|  #X   |           X的基础上，后者会在数前标0X，表示这是十六进制数           |
|   n   |          类似于'd'，但会根据语言环境的分隔符插入到恰当位置          |
| None  |      什么都不填，则对整数默认是'd'，对小数默认精度与所给值一样      |
|   e   |                    以科学计数法输出，默认精度6位                    |
|   E   |                    以科学计数法输出，默认精度6位                    |
|   f   |  以定点表示法输出，默认精度6位（非数用'nan'标示，无穷用'inf'标示）  |
|   F   |  以定点表示法输出，默认精度6位（非数用'NAN'标示，无穷用'INF'标示）  |
|   g   |               通用格式，小数以'f'输出，大数以'e'输出                |
|   G   |               通用格式，小数以'F'输出，大数以'E'输出                |
|   %   | 以百分比形式输出，默认精度同f，可通过'.num%'设置精度（num为一个数） |

8.2.3 format字符串综合运用
```python
"{:{fill}{align}{width}.{prec}{typ}}".format(3.1415, fill='+', align='^', width=10, prec=3, typ='g')
# '+++3.14+++'
```

## 9. f-string

> 也叫f字符串，字符串前加'f'或'F'，其中{}内的变量名可以引用，算式可以计算，内容也可以格式化输出

**9.1 示例**
```python
year = 2023
f"现在是 {year} 年"
# '现在是 2023 年'
F"1+2={1+2}, 2²={2*2}"
# '1+2=3, 2²=4'
f"{-110:0=10}||{3.1415:.2f}"
# '-000000110||3.14'
```

**9.2 f-string综合运用**
```python
fill, align, width, prec, typ = '+', '^', 10, 3, 'g'
f"{3.1415:{fill}{align}{width}.{prec}{typ}}"
# '+++3.14+++'
```

> f-string的效率比format字符串效率要高，但由于其是Python3.6才产生，考虑到兼容性，format字符串使用会更多