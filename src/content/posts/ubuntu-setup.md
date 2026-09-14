---
title: Ubuntu 装机与环境配置
date: 2025-05-14
description: 'Ubuntu Server 装机全流程：系统安装、网络配置、Docker、NVIDIA 驱动与 CUDA 环境。'
tags: [Linux, Docker, CUDA]
category: 环境搭建
episode: 1
draft: false
lang: 'zh_CN'
---

这篇记录在一台带 GPU 的物理机上从头装 Ubuntu Server 20.04 + 配齐后端开发和深度学习环境的完整流程。起因是某次重装实验室服务器，本来以为一下午能搞完，结果忘了 BIOS 按键、显卡接显示器没信号、网口物理坏掉这一连串问题，拖了整整两天。下面这些都是过程里踩到坑之后留下的笔记。

涉及：U 盘启动盘制作、系统安装、网络配置、Docker / Docker Compose、NVIDIA 驱动 + CUDA、Miniconda 环境管理。

这套流程主要针对 Ubuntu Server 20.04，但 18.04 到 24.04 多数操作通用，Desktop 版以及虚拟机部署也基本能套用。虚拟机用户可以跳过制作 U 盘那步，直接用 Hypervisor 自带的安装工具。

## 1. 制作 U 盘启动盘

准备一个 4GB 以上的 U 盘，建议 16GB。

> [!CAUTION]
> 制作过程会清空 U 盘，重要文件先备份。

下载 Ubuntu 20.04 Server ISO，二选一：

- [Ubuntu 官方](https://www.releases.ubuntu.com/focal/)：最稳，速度也快（部分地区需要代理）。
- [清华源](https://mirrors.tuna.tsinghua.edu.cn/ubuntu-releases/)：国内备选。

写盘工具按系统选：

- **Windows**：[Rufus](https://rufus.ie/en/)，详细步骤参考 [这篇](https://blog.csdn.net/qq_21386397/article/details/129894803)，注意配置时选对 Ubuntu 版本。
- **macOS**：[balenaEtcher](https://www.balena.io/etcher/)，界面引导基本不会出错。

写完拔下来就可以了。

## 2. 从 U 盘安装 Ubuntu

1. 插 U 盘，最好插主板原生接口而不是机箱前面板。
2. 开机猛按 **F12**（或 F2 / ESC，看主板），进入 BIOS。这玩意儿没有统一按键，看开机画面提示，实在不行三个都试一遍。
3. 在 BIOS 里把 U 盘设为优先启动项，或者直接选 U 盘启动。
4. 保存退出，进入 Ubuntu 安装界面。

### 2.1 安装时的注意点

可视化步骤参考 [这个视频](https://www.bilibili.com/video/BV19u411K7Ts/)。磁盘分区按自己硬件来。

两件事重点强调：

- **内网部署**：如果要用静态 IP，提前问运维要好 IP、子网掩码、网关。
- **APT 源**：**安装过程中不要改 APT 源，也不要做系统更新**。保持默认源、跳过更新。网络不稳的情况下改源或更新容易把安装搞挂，搞挂就得重装。

## 3. 配置系统网络

物理服务器的网络是后面所有远程操作的前提；虚拟机网络一般靠 Hypervisor 管理工具更省事，但概念也建议过一遍，后面装包配镜像都用得上。

> [!TIP]
> 在排查软件层的网络问题之前，先确认物理层——网线是不是好的、网口是不是亮的。一个坏网口能伪装成无数种"系统配置不对"的症状，能让人花大半天时间在错误的方向上排查。

### 3.1 配置网关

用 `netplan`，Ubuntu Server 默认就带。配置文件一般在：

```bash
sudo vim /etc/netplan/00-installer-config.yaml
```

这里改的是持久化配置，重启后仍然生效。临时加路由用：

```bash
sudo route add -net <target_network> netmask <subnet_mask> gw <gateway_IP>
```

配置语法可能因为 netplan 版本略有差异。下面是一个常见写法：

```yaml
network:
  version: 2
  renderer: networkd
  ethernets:
    eth0:
      dhcp4: no
      addresses: [192.168.1.100/24]
      routes:
        - to: default
          via: 192.168.1.1
        - to: 10.0.0.0/8
          via: 192.168.1.2
      nameservers:
        addresses: [8.8.8.8, 8.8.4.4]
```

应用配置：

```bash
sudo netplan try     # 试探性应用，不确认就自动回滚
# 或者直接应用
sudo netplan apply
```

验证路由：

```bash
ip route show
```

> [!WARNING]
> 远程 SSH 配网络一定要用 `sudo netplan try`，不要直接 `apply`。`try` 会等你确认，没确认就回滚，避免一条错配把自己锁在门外。

## 4. 装基本工具

网络通了之后，从本地机器 SSH 上服务器：

```bash
ssh <username>@<hostname_or_IP>
```

### 4.1 APT 源

国内用户建议换国内镜像：

```bash
sudo vim /etc/apt/sources.list
```

用阿里源举例：

```
deb http://mirrors.aliyun.com/ubuntu/ focal main restricted universe multiverse
deb http://mirrors.aliyun.com/ubuntu/ focal-security main restricted universe multiverse
deb http://mirrors.aliyun.com/ubuntu/ focal-updates main restricted universe multiverse
deb http://mirrors.aliyun.com/ubuntu/ focal-backports main restricted universe multiverse
deb http://mirrors.aliyun.com/ubuntu/ focal-proposed main restricted universe multiverse
deb [arch=amd64] http://mirrors.aliyun.com/docker-ce/linux/ubuntu focal stable
```

保存之后更新：

```bash
sudo apt update && sudo apt upgrade
```

会跑一段时间。完事之后装基础工具：

```bash
sudo apt install build-essential
sudo apt install docker docker-compose
```

### 4.2 Docker

Docker 在现代后端环境里基本是必装。下面单独走一遍标准流程。

> 参考 [这篇](https://blog.csdn.net/justlpf/article/details/132982953)，覆盖了 Docker + Compose 比较全的安装说明。

#### 4.2.1 Docker Engine

直接 `apt` 装 Docker 也可以，但镜像配置会比较麻烦，所以走下面的官方方式。

装依赖：

```bash
sudo apt-get install ca-certificates curl gnupg lsb-release
```

加 GPG key：

```bash
curl -fsSL http://mirrors.aliyun.com/docker-ce/linux/ubuntu/gpg | sudo apt-key add -
```

加 Docker 仓库（阿里源）：

```bash
sudo add-apt-repository "deb [arch=amd64] http://mirrors.aliyun.com/docker-ce/linux/ubuntu $(lsb_release -cs) stable"
```

装 Docker CE：

```bash
sudo apt-get install docker-ce docker-ce-cli containerd.io
```

把当前用户加进 docker 组，免去每次 `sudo`：

```bash
sudo usermod -aG docker $USER
```

退出重登一次让组生效。验证：

```bash
sudo systemctl start docker
sudo systemctl status docker
sudo docker run hello-world
```

网络通的话应该能拉下来 `hello-world` 镜像并跑起来。开机自启：

```bash
sudo systemctl enable docker
```

可选补几个包：

```bash
sudo apt-get -y install apt-transport-https ca-certificates curl software-properties-common
```

装新东西或者改了 Docker 配置之后：

```bash
sudo systemctl restart docker
```

改 daemon 配置（如镜像）编辑 `/etc/docker/daemon.json`，改完：

```bash
sudo systemctl reload docker
sudo systemctl restart docker
```

#### 4.2.2 Docker Compose

下载装包：

```bash
# GitHub: https://github.com/docker/compose/releases/tag/v2.20.2
# 国内镜像: https://gitee.com/smilezgy/compose/releases/tag/v2.20.2
sudo curl -SL \
  https://github.com/docker/compose/releases/download/v2.20.2/docker-compose-linux-x86_64 \
  -o /usr/local/bin/docker-compose

# 或者本地下好上传到服务器：
sudo cp docker-compose-linux-x86_64 /usr/local/bin/docker-compose

sudo chmod +x /usr/local/bin/docker-compose
```

验证：

```bash
docker-compose --version
```

拉镜像超时的话，在 `/etc/docker/daemon.json` 配镜像加速：

```json
{
    "registry-mirrors": [
        "https://registry.docker-cn.com",
        "https://mirror.ccs.tencentyun.com",
        "https://docker.mirrors.ustc.edu.cn",
        "https://docker.m.daocloud.io",
        "https://docker.imgdb.de",
        "https://docker-0.unsee.tech",
        "https://docker.hlmirror.com",
        "https://docker.1ms.run",
        "https://func.ink",
        "https://lispy.org",
        "https://docker.xiaogenban1993.com"
    ]
}
```

镜像质量不一，建议一个一个测试，只留下能稳定连上的。

## 5. NVIDIA 驱动和 CUDA

### 5.1 驱动

以 GTX 1080 Ti 为例，其他卡流程一样。

1. 去 [NVIDIA 驱动下载](https://www.nvidia.com/Download/index.aspx)。
2. 选好型号、操作系统、平台，查最新驱动。
3. 下 `.run` 文件。
4. 加执行权限并跑：

```bash
chmod +x NVIDIA-Linux-x86_64-*.run
sudo ./NVIDIA-Linux-x86_64-*.run
```

装完通常要重启。**重启之前先确认 `netplan` 配置是对的，否则可能直接失联。**

验证：

```bash
nvidia-smi
```

> 顺手提一下，跑深度学习时实时看显卡状态：
> ```bash
> watch -n 1 nvidia-smi
> ```
> 每秒刷新一次，能直观看到核心和显存的使用情况。

### 5.2 CUDA Toolkit

以 CUDA 12.8 为例。注意 NVIDIA 已经宣布 CUDA 12.9 之后会停止支持部分老架构卡（含 GTX 和 TITAN 系列），**装之前先确认你的卡的兼容范围**。

1. 搜版本，比如 "cuda 12.8"，进入 [CUDA Toolkit Archive](https://developer.nvidia.com/cuda-12-8-1-download-archive)。
2. 选系统、架构、发行版、版本、安装方式（推荐 `deb (local)`）。
3. 按 NVIDIA 给出的命令走。Ubuntu 20.04 上的 CUDA 12.8：

```bash
wget https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2004/x86_64/cuda-ubuntu2004.pin
sudo mv cuda-ubuntu2004.pin /etc/apt/preferences.d/cuda-repository-pin-600
wget https://developer.download.nvidia.com/compute/cuda/12.8.1/local_installers/cuda-repo-ubuntu2004-12-8-local_12.8.1-570.124.06-1_amd64.deb
sudo dpkg -i cuda-repo-ubuntu2004-12-8-local_12.8.1-570.124.06-1_amd64.deb
sudo cp /var/cuda-repo-ubuntu2004-12-8-local/cuda-*-keyring.gpg /usr/share/keyrings/
sudo apt-get update
sudo apt-get -y install cuda-toolkit-12-8
```

这一步耗时挺长，等就行。

### 5.3 让 Docker 容器用上 GPU

如果想在 Docker 里调用宿主机 GPU，需要装 [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)。装完在 `docker-compose.yml` 这样写：

```yaml
services:
  container-name:
    deploy:
      resources:
        reservations:
          devices:
            - driver: "nvidia"
              count: "all"
              capabilities: ["gpu"]
```

## 6. 深度学习环境

### 6.1 Miniconda

按 [官方安装页](https://www.anaconda.com/docs/getting-started/miniconda/install#linux) 走。Linux x86_64 上（2025 年 5 月的命令）：

```bash
mkdir -p ~/miniconda3
wget https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh -O ~/miniconda3/miniconda.sh
bash ~/miniconda3/miniconda.sh -b -u -p ~/miniconda3
rm ~/miniconda3/miniconda.sh
```

最新命令以官网为准。装到一半问要不要 init conda，选 yes，省得后面手动改 `~/.bashrc`。

装完终端提示符应该有 `(base)`：

```bash
(base) user@hostname:~$
```

pip 配国内源（阿里）：

```bash
mkdir ~/.pip
cd ~/.pip
vim pip.conf
```

写入：

```text
[global]
index-url = https://mirrors.aliyun.com/pypi/simple/

[install]
trusted-host = mirrors.aliyun.com
```

建一个 PyTorch 环境：

```bash
conda create -n torch python=3.9 -y
```

进入环境装包：

```bash
conda activate torch
pip install --upgrade pip
pip install torch torchvision torchaudio jupyter
```

验证 PyTorch 能不能用上 CUDA：

```bash
(torch) user@hostname:~$ python
Python 3.9.21 ...
>>> import torch
>>> torch.cuda.is_available()
True
```

输出 `True` 就 OK。

## 写在最后

从 U 盘启动盘、系统安装、网络配置，到 Docker、NVIDIA 驱动、CUDA、Python 环境，每一步都是这台机器能跑深度学习任务的基础。流程虽然长，但思路转到其他 Ubuntu 版本、虚拟机、Desktop 版基本都通。

最后一点经验：装系统这种事，技术含量并不一定有多高，但需要点耐心和方法。出问题的时候先别急着复杂调试——先检查物理连接、网络可达性、BIOS 配置这些最基本的东西。简单的疏漏往往最难发现。
