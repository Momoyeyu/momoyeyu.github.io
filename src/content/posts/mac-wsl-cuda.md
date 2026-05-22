---
title: Mac 远程连接 WSL 使用 CUDA
published: 2026-05-22
description: 'Mac SSH 连 Windows WSL2：OpenSSH 配置、防火墙、WSL 环境搭建与 PyTorch GPU 验证。'
tags: [macOS, WSL, CUDA]
category: 环境搭建
draft: false
lang: 'zh_CN'
---

这篇记录用 Mac 通过 SSH 连到 Windows 上的 WSL2，直接在 Linux 环境里调 GPU 跑深度学习的完整配置过程。
起因是换了 MacBook Air 之后，日常写代码全在 Mac 上，但家里那台 Windows 台式机插着一张显卡，平时当游戏机闲着挺浪费。
想着能不能 SSH 上去，进 WSL 就是一个带 GPU 的 Linux，写代码和跑训练都在一套流程里搞定。

折腾下来发现这条路走得通，但坑不少——Windows 的 OpenSSH 配置跟 Linux 差别很大、防火墙规则容易开太宽、WSL 的 DNS 会莫名失效。 下面按顺序记一遍，踩过的坑都标出来了。

涉及：Windows OpenSSH Server、防火墙规则、WSL2 安装与 GPU 直通、zsh / oh-my-zsh、uv 环境管理、PyTorch CUDA 验证、Mac SSH 配置。

> [!NOTE]
> **前提条件**
>
> - Windows 11
> - NVIDIA GPU + 已装 [GeForce / Studio 驱动](https://www.nvidia.com/Download/index.aspx)（2020 年后的版本均支持 WSL2 CUDA 直通）
> - Windows 已启用虚拟化（BIOS 中 VT-x / AMD-V + Hyper-V）
> - Mac 与 Windows 在同一局域网（校园网、家庭网都行）
> - Mac 已生成 SSH 密钥（没有的话：`ssh-keygen -t ed25519`）

## 1. Windows 端：安装 OpenSSH Server

第一步是让 Windows 能接受 SSH 连接。Windows 10 1809 以后自带 OpenSSH Server，但默认没装。

### 1.1 安装

PowerShell（管理员）：

```powershell
# 看看有没有
Get-WindowsCapability -Online | Where-Object Name -like 'OpenSSH*'

# 装
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
```

### 1.2 启动并设置开机自启

```powershell
Start-Service sshd
Set-Service -Name sshd -StartupType Automatic
```

### 1.3 确认 sshd 在监听

```powershell
netstat -ano | findstr :22
```

期望输出里看到 `0.0.0.0:22`。如果显示 `127.0.0.1:22`，编辑 `C:\ProgramData\ssh\sshd_config`，注释或修改 `ListenAddress`，然后 `Restart-Service sshd`。

## 2. Windows 端：网络与防火墙

### 2.1 确认网络位置

```powershell
Get-NetConnectionProfile
```

校园网 / 公共网建议保持 `NetworkCategory = Public`（入站默认拒绝更严格），仅对 SSH 单独开放。

### 2.2 确认局域网网段

在 Mac 或 WSL 里看一下自己的 IP，推断网段。常见的：

- `10.0.0.0/8`（大学网最多）
- `172.16.0.0/12`
- `192.168.0.0/16`

### 2.3 添加仅限局域网的防火墙规则

PowerShell（管理员）：

```powershell
New-NetFirewallRule -Name sshd-public-lan `
  -DisplayName 'OpenSSH Server (LAN only, Public)' `
  -Enabled True -Direction Inbound -Protocol TCP -Action Allow `
  -LocalPort 22 -Profile Public `
  -RemoteAddress 10.0.0.0/8
```

**`-RemoteAddress` 不可省略**，否则等于对整个 Public 网络开放 22 端口——在校园网上这约等于裸奔。网段替换为实际值。

验证：

```powershell
Get-NetFirewallRule -Name sshd-public-lan | Get-NetFirewallAddressFilter
```

`RemoteAddress` 应该显示你设定的网段（CIDR 或等价子网掩码形式），不能是 `Any`。

### 2.4 配置密钥认证

在 Mac 上：

```bash
cat ~/.ssh/id_ed25519.pub
```

把输出内容追加到 Windows 的 `C:\Users\<用户>\.ssh\authorized_keys`（文件夹或文件不存在就手动建）。

> 注意：如果你的 Windows 账户是管理员，`authorized_keys` 的路径不一样，是 `C:\ProgramData\ssh\administrators_authorized_keys`，而且需要单独设权限：
>
> ```powershell
> icacls.exe "C:\ProgramData\ssh\administrators_authorized_keys" /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F"
> ```
>
> 这个坑不看日志根本猜不到——密钥明明放对了，但 sshd 就是不认，因为它去另一个路径找了。

### 2.5 加固 SSH 配置

编辑 `C:\ProgramData\ssh\sshd_config`：

```
PasswordAuthentication no
PubkeyAuthentication yes
```

**先确认从 Mac 用密钥能登录成功**，再禁用密码登录，否则可能把自己锁在门外。

```powershell
Restart-Service sshd
```

### 2.6 Mac 上验证连接

```bash
nc -vz <windows-ip> 22        # 先测端口通不通
ssh <user>@<windows-ip>        # 再测登录
```

到这里 Mac 应该能 SSH 进 Windows 了。但进来是 PowerShell，不是我们要的 Linux 环境。

## 3. Windows 端：安装 WSL2 + Ubuntu

### 3.1 安装

PowerShell（管理员）：

```powershell
wsl --install -d Ubuntu-20.04
```

装完会提示重启 Windows。重启后首次进入 WSL，设置 Linux 用户名和密码。

### 3.2 确认版本

```powershell
wsl -l -v
```

`VERSION` 列应该是 2。如果是 1：

```powershell
wsl --set-version Ubuntu-20.04 2
```

### 3.3 验证 GPU 直通

进 WSL 执行：

```bash
nvidia-smi
```

应该能看到 GPU 信息。如果看不到，先检查 Windows 驱动版本是否支持 WSL。

> WSL2 的 GPU 直通不需要在 WSL 内装 NVIDIA 驱动——驱动由 Windows 宿主机提供，WSL 只是透传。这跟在物理 Linux 上装 CUDA 不一样，别搞混了。

## 4. Windows 端：让 SSH 直接进入 WSL

现在 SSH 连入 Windows 还是 PowerShell 环境，我们希望连上就直接进 WSL 的 Linux shell。

### 4.1 创建跳板脚本

PowerShell（管理员）：

```powershell
$bat = @'
@echo off
C:\Windows\System32\wsl.exe -d Ubuntu-20.04 --cd ~ -- zsh
'@
New-Item -Path "C:\scripts" -ItemType Directory -Force | Out-Null
Set-Content -Path "C:\scripts\ssh-shell.bat" -Value $bat -Encoding ASCII
```

### 4.2 设为 SSH 默认 Shell

```powershell
Set-ItemProperty -Path "HKLM:\SOFTWARE\OpenSSH" -Name DefaultShell `
  -Value "C:\scripts\ssh-shell.bat"

Remove-ItemProperty -Path "HKLM:\SOFTWARE\OpenSSH" -Name DefaultShellCommandOption -ErrorAction SilentlyContinue
```

下次 SSH 连接即刻生效，不需要重启服务。

> 这里写的是 `zsh`，但现在 WSL 里还没装 zsh，直接连会报错。可以先把脚本里的 `zsh` 改成 `bash`，等下面装好 zsh 再改回来。

## 5. WSL 内：修复 DNS

部分 WSL 安装后 `/etc/resolv.conf` 缺失或者 DNS 不可用，网都连不上，后面什么都装不了。先修这个。

### 5.1 关闭 WSL 自动生成 resolv.conf

```bash
sudo bash -c 'cat > /etc/wsl.conf <<EOF
[network]
generateResolvConf = false
EOF'
```

### 5.2 手动写入 DNS

```bash
sudo bash -c 'cat > /etc/resolv.conf <<EOF
nameserver 223.5.5.5
nameserver 119.29.29.29
EOF'
```

### 5.3 验证

```bash
ping -c 2 223.5.5.5
ping -c 2 mirrors.tuna.tsinghua.edu.cn
```

两个都通就 OK。不通的话重启一次 WSL（在 PowerShell 里 `wsl --shutdown` 再重新进）。

## 6. WSL 内：换源 + 装 zsh

### 6.1 替换 APT 源

```bash
sudo cp /etc/apt/sources.list /etc/apt/sources.list.bak
sudo sed -i 's|http://archive.ubuntu.com|https://mirrors.tuna.tsinghua.edu.cn|g; s|http://security.ubuntu.com|https://mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list
sudo apt update
```

### 6.2 安装 zsh 和基础工具

```bash
sudo apt install -y zsh build-essential git curl wget htop tmux unzip ca-certificates
zsh --version
```

装完之后，前面第 4 节的跳板脚本里 `zsh` 就能正常工作了。

## 7. WSL 内：清理旧的 conda（如有）

如果之前装过 Miniconda 或 Anaconda，建议清掉，避免和后面用的 uv 打架。

```bash
# 清理 shell rc 中的 conda init 代码块
conda init --reverse --all

# 删安装目录和配置残留
rm -rf ~/miniconda3 ~/anaconda3
rm -rf ~/.conda ~/.condarc ~/.continuum ~/.anaconda
```

退出 SSH 重连后验证：

```bash
which conda                                    # 应该为空
env | grep -i conda                            # 无 CONDA_* 变量
echo $PATH | tr ':' '\n' | grep -i conda       # 可能残留 /mnt/.. 的 Windows 路径，无害
```

## 8. WSL 内：装 oh-my-zsh

```bash
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
```

提示切换默认 shell 选 Y。

### 8.1 装两个常用插件

```bash
git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions
git clone https://github.com/zsh-users/zsh-syntax-highlighting ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting
```

编辑 `~/.zshrc`，找到 `plugins=(git)` 改成：

```bash
plugins=(git zsh-autosuggestions zsh-syntax-highlighting)
```

`source ~/.zshrc` 生效。

## 9. WSL 内：安装 uv

这篇用 [uv](https://docs.astral.sh/uv/) 管理 Python 环境，跟 macOS 那篇保持一致。底层 Rust 实现，比 pip/conda 快一个数量级。

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
exec zsh
uv --version
```

顺手装一个 GPU 监控工具：

```bash
uv tool install nvitop
```

> `nvitop` 比 `nvidia-smi` 好用不少，能看到每个进程的显存占用，界面也更直观。跑训练的时候开一个 tmux 窗口挂着很方便。

## 10. 验证 CUDA + PyTorch

到这一步，整条链路应该通了。验证一下：

```bash
mkdir ~/test-cuda && cd ~/test-cuda
uv venv --python 3.12
source .venv/bin/activate
uv pip install torch --index-url https://download.pytorch.org/whl/cu121
python -c "import torch; print(torch.__version__); print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0))"
```

期望输出：

```
2.x.x+cu121
True
NVIDIA GeForce RTX xxxx
```

输出 `True` 就 OK。

## 11. Mac 端：SSH 配置

编辑 `~/.ssh/config`：

```
Host gpu
    HostName <windows-ip>
    Port 22
    User <windows-user>
    IdentityFile ~/.ssh/id_ed25519
    ServerAliveInterval 60
    ServerAliveCountMax 10
```

之后 `ssh gpu` 一条命令就能连进 WSL。VS Code 的 Remote-SSH 扩展也认这个 Host 名，装好之后左下角点一下就能远程开发。

> `ServerAliveInterval 60` 加上 `ServerAliveCountMax 10` 意味着 10 分钟没响应才断开。校园网环境下这个值基本够用，不至于一走神就掉线。

## 避坑要点

走完上面的流程，有几条经验值得单独拎出来。

1. **防火墙规则必须带 `-RemoteAddress`**。省略这个参数等于对整个 Public 网络开放端口，在校园网上就是在邀请别人扫你。
2. **密钥认证先通再禁密码**。管理员账户的 `authorized_keys` 路径和普通用户不一样，不看文档很难猜到。
3. **WSL 内不要装 NVIDIA 驱动**。CUDA 通过 Windows 驱动直通，只需要在 WSL 里装 PyTorch wheel 就行。如果需要 `nvcc` 编译自定义 CUDA kernel，装 CUDA Toolkit 即可，不碰驱动。
4. **PyTorch 自带 CUDA runtime**。`nvidia-smi` 显示的 CUDA 版本是驱动支持的上限，跟 PyTorch wheel 自带的版本不需要完全一致。
5. **WSL2 显存与 Windows 共享**。训练前关掉 Windows 上吃显存的程序（浏览器、游戏），否则 OOM 了半天找不到原因。
6. **项目和数据放 `~/`，别放 `/mnt/c/`**。跨文件系统 I/O 慢 10 倍以上，训练数据放 `/mnt/c/` 下面会明显拖慢 dataloader。
7. **长时间训练用 tmux**。`tmux new -s train` → 开始训练 → `Ctrl+B D` 脱离 → 关掉 SSH 也不影响 → `tmux attach -t train` 重连。
8. **每个项目一个 uv venv**。用 `uv init` + `uv add` 管理依赖，不搞全局环境。
9. **WSL 的 IP 漂移不影响连接**。本方案中 SSH 是连到 Windows 的 22 端口，`wsl.exe` 作为 shell 启动器，不涉及 WSL 内部的端口转发，WSL IP 变了也没事。
10. **网络位置保持 Public**。不要为了让 SSH 通就把网络降级为 Private，仅对单端口加局域网例外就够了。

## 写在最后

Mac 写代码、Windows 跑 GPU，中间一条 SSH 串起来——这套方案不算复杂，但每一步都有自己的坑：Windows 的 OpenSSH 跟 Linux 的行为不一样、管理员账户的密钥路径藏在另一个地方、WSL 的 DNS 莫名其妙就挂。好在踩完一遍之后就稳了，日常用起来跟 SSH 连一台 Linux 服务器没什么区别。

如果你也是 Mac + Windows 双机的配置，这条路值得试试。两台机器各做各擅长的事，比勉强在一台机器上塞所有东西舒服得多。
