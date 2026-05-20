---
title: Python ML 入门
published: 2023-07-03
description: '面向机器学习的 Python 快速入门：基础语法、数据结构、NumPy 与文件读写。'
tags: [Python, 深度学习]
category: Python 入门
episode: 6
draft: false
lang: 'zh_CN'
---

# Python for Machine Learning

## 前言

我当时在做一个和机器学习（Machine Learning，ML）、深度学习（Deep Learning，DL）、Cybersecurity 有关的项目，但自己对 Python 工程经验、ML 和 DL 都不够熟悉，直接看课程和书会比较吃力。因此这篇文章整理的是一份快速补齐 Python 基础的路线，目标不是把 Python 学到很深，而是尽快能读懂 ML/DL/强化学习（Reinforcement Learning，RL）相关代码，并能开始做实验。

如果后续要系统做 ML 或 DL，Python 基础越扎实越好；但入门阶段不必追求一次性学完所有语法。先掌握最常用的语言结构、数据处理、文件读写、包管理和调试方法，就足够支撑后续继续学习。

## 1. 基础语法

需要先熟悉变量、数据类型、条件分支、循环、函数和类。写代码时尽量保持命名清晰、结构简单，后续读 ML 代码会轻松很多。

```python
# Variables and basic data types
name = "John"
age = 25
is_student = True
height = 1.75

# Control flow statements - if-else
if age >= 18:
    print("You are an adult.")
else:
    print("You are a minor.")

# Loops - for loop
for i in range(1, 6):
    print(i)

# Functions
def greet(name):
    print("Hello, " + name + "!")

greet("Alice")

# Classes and objects
class Person:
    def __init__(self, name, age):
        self.name = name
        self.age = age

    def introduce(self):
        print("My name is", self.name, "and I am", self.age, "years old.")

person1 = Person("Alice", 25)
person1.introduce()

person2 = Person("Bob", 30)
person2.introduce()
```

这里最容易困惑的是 `__init__` 和 `self`。`__init__` 是类的构造方法，创建对象时会自动调用；`self` 表示当前对象本身，用来访问对象自己的属性和方法。比如 `self.name = name` 就是把传入的 `name` 保存到这个对象上。

## 2. 数据结构

Python 内置的 `list`、`tuple`、`dict` 和 `set` 非常常用。ML 代码里经常需要组织样本、标签、配置和中间结果，所以至少要掌握索引、切片、遍历、增删改查这些操作。

```python
# Lists
fruits = ['apple', 'banana', 'orange']
print(fruits)

print(fruits[0])
print(fruits[-1])

fruits[1] = 'grape'
fruits.append('mango')
removed_fruit = fruits.pop(1)
print(removed_fruit)
print(fruits)

# Tuples
person = ('John', 25, 'USA')
name, age, country = person
print(name, age, country)

# Dictionaries
student = {'name': 'Alice', 'age': 20, 'major': 'Computer Science'}
print(student['name'])
print(student.get('age'))

student['age'] = 21
student['university'] = 'ABC University'
removed_major = student.pop('major')
print(removed_major)
print(student)
```

`dict` 在实验代码里尤其常见，常被用来保存超参数、指标、配置项和数据字段。相比用多个列表硬凑，字典能直接表达“键 -> 值”的映射关系。

## 3. 常用库和模块

进入 ML 前，至少要知道怎么导入库，以及几个基础库各自做什么。

```python
import math
import random

print(math.sqrt(25))
print(math.pi)
print(random.randint(1, 10))
print(random.choice(['apple', 'banana', 'orange']))

from datetime import date
from random import shuffle

today = date.today()
print(today)

my_list = [1, 2, 3, 4, 5]
shuffle(my_list)
print(my_list)

import numpy as np
import pandas as pd

array = np.array([1, 2, 3, 4, 5])
print(array)

data_frame = pd.DataFrame({'Name': ['Alice', 'Bob', 'Charlie'], 'Age': [25, 30, 35]})
print(data_frame)
```

常用库可以先按用途记：

- `NumPy`：数值计算和数组操作，是很多科学计算库的基础。
- `Pandas`：表格数据处理，常用于读 CSV、清洗数据、做统计分析。
- `Matplotlib`：画图和可视化，适合看数据分布和模型结果。
- `scikit-learn`：传统 ML 常用库，包含分类、回归、聚类、降维、评估等工具。
- `TensorFlow` / `PyTorch`：DL 框架，用来搭建和训练神经网络。

一个很简化的 scikit-learn 示例：

```python
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score

# Load the dataset
data = pd.read_csv('data.csv')

# Split the dataset into features and labels
X = data.drop('label', axis=1)
y = data['label']

# Split the data into training and testing sets
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42
)

# Train a logistic regression model
model = LogisticRegression()
model.fit(X_train, y_train)

# Evaluate the model
y_pred = model.predict(X_test)
accuracy = accuracy_score(y_test, y_pred)
print('Accuracy:', accuracy)
```

## 4. 文件读写

做 ML 时经常要读数据集、保存处理结果、写日志或者保存配置。最基本的是理解 `with open(...)` 的写法，它能保证文件用完后正确关闭。

```python
def write_to_file(filename, content):
    with open(filename, 'w') as file:
        file.write(content)


def read_from_file(filename):
    with open(filename, 'r') as file:
        return file.read()


filename = "example.txt"
content_to_write = "Hello, World!"

write_to_file(filename, content_to_write)
content_read = read_from_file(filename)
print(content_read)
```

如果不想覆盖已有文件，可以先检查文件是否存在：

```python
import os


def write_to_file(filename, content):
    if os.path.isfile(filename):
        print(f"File '{filename}' already exists.")
    else:
        with open(filename, 'w') as file:
            file.write(content)
        print(f"Content '{content}' written to '{filename}'.")
```

更完整一点的版本可以加异常处理和追加写入：

```python
def write_to_file(filename, content):
    try:
        with open(filename, 'w') as file:
            file.write(content)
        print(f"Content written to '{filename}' successfully.")
    except IOError as e:
        print(f"Error writing to '{filename}': {e}")


def read_from_file(filename):
    try:
        with open(filename, 'r') as file:
            return file.read()
    except FileNotFoundError:
        print(f"File '{filename}' not found.")
    except IOError as e:
        print(f"Error reading from '{filename}': {e}")


def append_to_file(filename, content):
    try:
        with open(filename, 'a') as file:
            file.write(content)
        print(f"Content appended to '{filename}' successfully.")
    except IOError as e:
        print(f"Error appending to '{filename}': {e}")


filename = "example.txt"
write_to_file(filename, "Hello, World!")
append_to_file(filename, "\nAppending some more content!")
print(read_from_file(filename))
```

## 5. ML/DL 相关函数和库

不需要一开始就掌握所有框架，但要知道基本分工。

- `NumPy`：负责矩阵、向量、随机数、线性代数等基础数值计算。
- `Pandas`：负责结构化数据的读取、筛选、合并、清洗和统计。
- `scikit-learn`：适合传统 ML，比如线性回归、逻辑回归、SVM、随机森林、KMeans 等。
- `TensorFlow`：Google 推出的 DL 框架，配合 Keras 可以快速搭模型。
- `PyTorch`：动态图机制更直观，科研和原型验证里非常常见。
- `Matplotlib`：画 loss 曲线、散点图、直方图、预测结果等。

```python
import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression
import matplotlib.pyplot as plt

# Generate sample data
X = np.random.rand(100, 1)
y = 2 * X + np.random.randn(100, 1)

# Create a Pandas DataFrame
df = pd.DataFrame({'X': X.flatten(), 'y': y.flatten()})

# Fit a linear regression model
model = LinearRegression()
model.fit(X, y)

# Predict the output
X_new = np.array([[0.2], [0.4], [0.6]])
y_pred = model.predict(X_new)

# Plot the data and regression line
plt.scatter(X, y, color='blue', label='Data')
plt.plot(X_new, y_pred, color='red', linewidth=2, label='Regression Line')
plt.xlabel('X')
plt.ylabel('y')
plt.legend()
plt.show()
```

这段代码包含了一个典型的最小流程：生成数据、组织数据、训练模型、预测、可视化。后续复杂模型基本也是在这个流程上扩展。

## 6. 异常处理和调试

写 ML 代码时，错误不一定来自算法，也可能来自数据维度、文件路径、包版本、数据类型。先掌握基础调试方法很重要。

常见错误大致可以分为：

- 语法错误：代码本身不符合 Python 语法。
- 运行时错误：比如文件不存在、数组越界、类型不匹配。
- 逻辑错误：代码能跑，但结果不对，这类最难查。

异常处理的基本写法如下：

```python
try:
    # Code that might raise an exception
    result = 10 / 0
except ZeroDivisionError:
    print("Cannot divide by zero")
except Exception as e:
    print("Unexpected error:", e)
```

也可以用 `logging` 代替大量 `print`，尤其是训练过程比较长的时候：

```python
import logging

logging.basicConfig(level=logging.DEBUG)

logging.debug('This is a debug message')
logging.info('This is an info message')
logging.warning('This is a warning message')
logging.error('This is an error message')
```

调试时建议先读报错信息和 stack trace，定位出错行；如果问题不明显，就逐步缩小代码范围，检查关键变量的 shape、dtype 和取值。

## 7. 包管理

ML/DL 项目依赖通常比较多，环境管理不清楚很容易出现“在我机器上能跑”的问题。

1. `pip`：Python 默认包管理器，例如 `pip install numpy`。
2. `venv`：Python 内置虚拟环境工具，可以为每个项目创建独立环境。
3. `conda`：常用于数据科学项目，适合管理 Python 版本、CUDA 相关依赖和科学计算库。
4. `requirements.txt`：记录项目依赖，常用 `pip freeze > requirements.txt` 生成，用 `pip install -r requirements.txt` 安装。
5. 版本约束：例如 `numpy==1.26.4` 表示固定版本，`torch>=2.0.0` 表示最低版本。

一个简单流程：

```bash
python -m venv .venv
source .venv/bin/activate
pip install numpy pandas scikit-learn matplotlib
pip freeze > requirements.txt
```

后续如果换机器或给别人复现，可以直接：

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 小结

这篇文章的重点是：为了学习 ML/DL，不需要先把 Python 所有细节都学完，但要先掌握能支撑实验代码的核心能力，包括基础语法、常见数据结构、常用库、文件读写、异常处理、调试和包管理。

接下来比较适合的路线是：先用 `NumPy` 和 `Pandas` 做数据处理，再用 `scikit-learn` 跑几个传统 ML 模型，最后进入 `PyTorch` 或 `TensorFlow`。边学边写小实验，比单纯看教程有效很多。
