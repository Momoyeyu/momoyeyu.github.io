---
title: 通过 WSL 使用 CUDA
date: 2026-05-22
updated: 2026-09-29
description: 'SSH 直连 WSL2：AI 一键配置，或手动配置 portproxy、sshd 与防火墙，验证 CUDA。'
tags: [WSL, CUDA]
category: 环境搭建
episode: 2
draft: false
lang: 'zh_CN'
---
这篇记录如何通过 SSH 直连 Windows 上的 WSL2，在原生 Linux 环境里调 GPU 进行 CUDA 开发。客户端可以是任何能跑 ssh 的机器（本文以 Mac 为例），Windows 当作服务器。

方案的核心思路：**在 WSL2 内部装 sshd，再用 `netsh portproxy` 把 Windows 的一个端口（本文用 2222）转发到 WSL 的 22**。客户端连 `<windows-ip>:2222` 就是在连 WSL 里的 Linux——SSH 和 SFTP 走同一个原生 Linux sshd，VS Code Remote-SSH、PyCharm 远程开发直接可用。选 2222 而不是 22，是为了不碰 Windows 自带的 OpenSSH Server，两边互不干扰。

![topology](/img/posts/wsl-cuda/topology.svg)

配置有两条路线：

- **AI 快速配置**：装好 WSL 后跑两个脚本把 shell 环境和 [dsh](https://www.npmjs.com/package/@deepseek-ai/dsh)（DeepSeek 的终端 agent）准备好，服务端配置交给 dsh 执行，客户端配置交给本地 AI。适合有 DeepSeek API key 的读者。
- **手动配置**：逐步执行等价命令，不需要任何 API，也能看清每一步在做什么。

两条路线殊途同归，最后都在「验证」一节会合。

> [!NOTE]
> **前提条件**
>
> - Windows 11
> - NVIDIA GPU + 已装 [GeForce / Studio 驱动](https://www.nvidia.com/Download/index.aspx)（2020 年后的版本均支持 WSL2 CUDA 直通）
> - Windows 已启用虚拟化（BIOS 中 VT-x / AMD-V + Hyper-V）
> - 客户端（Mac / Linux / 另一台 Windows 均可）与 Windows 在同一局域网
> - 客户端已生成 SSH 密钥（没有的话：`ssh-keygen -t ed25519`）
> - AI 路线额外需要 [DeepSeek API key](https://platform.deepseek.com/)

## AI 快速配置

整条路线里手动操作只有三件事：Windows 上装 WSL、在 WSL 里跑两个脚本、把 dsh 输出的管理员命令在 PowerShell 里跑掉。其余全部交给 agent。

### 1. 安装 WSL

PowerShell（管理员）：

```powershell
wsl --install -d Ubuntu-24.04
```

装完重启 Windows，首次进入 WSL 设置 Linux 用户名和密码。确认版本：

```powershell
wsl -l -v
```

`VERSION` 列应该是 2。如果是 1：

```powershell
wsl --set-version Ubuntu-24.04 2
```

### 2. 配置 shell

```bash
curl -fsSL https://momoyeyu.github.io/resource/script/setup.sh | bash
```

这是我公开的初始化脚本（源码见[资源页](https://momoyeyu.github.io/resource/script/)），一次完成：zsh + oh-my-zsh + fast-syntax-highlighting + zsh-autosuggestions、git 身份与别名、PROMPT，并把默认登录 shell 切成 zsh。

值得说的不是装了什么，而是它怎么对付国内网络：所有下载都带多源回退链（GitHub 直连 → jsdelivr → ghfast.top → gitee），每个源限时等待，不会再出现 curl 卡住把整个脚本挂死的情况。另外它会在 `~/.cache/fsh/` 预置 fast-syntax-highlighting 的主题缓存——没有这个文件时，该插件**每次**启动 zsh 都要去 `raw.githubusercontent.com` 拉主题，在不可达的网络里每个新终端都卡到超时。预置之后实测 `zsh -i -c exit` 约 0.3s。

中途会问 git 的 `user.name` 和 `user.email`（提交作者信息，回车用现有值）。跑完开一个新终端或 `exec zsh -l` 生效。

### 3. 安装 dsh

```bash
curl -fsSL https://momoyeyu.github.io/resource/script/dsh.sh | bash
```

同样来自[资源页](https://momoyeyu.github.io/resource/script/)。它装 nvm → Node 22 → pnpm → `@deepseek-ai/dsh` 和 `dsh-tui`，中途会提示输入 `DEEPSEEK_API_KEY`（写入 `~/.dsh/.env`）。下载链同样带 npmmirror 等回退源。

跑完 `dsh` 和 `dsh-tui` 可用；新装的 PATH 写在 `~/.zshrc`，如果当前 shell 找不到命令，开新终端即可。

### 4. 配置服务端

在 WSL 里启动 `dsh`，把任务一次性交代给它，例如：

> 帮我在这台 WSL 上配置 SSH 服务：安装 openssh-server 并用 systemd 设为开机自启；只保留公钥认证、禁用密码登录；我把客户端的公钥贴给你（`cat ~/.ssh/id_ed25519.pub` 的输出），写进 `~/.ssh/authorized_keys` 并设好权限；用 portproxy 把 Windows 的 2222 端口映射到 WSL 的 22；最后告诉我局域网内用什么 IP 和端口连接，以及还有哪些命令需要我在 Windows 的管理员 PowerShell 里执行（比如防火墙放行）。

dsh 会直接执行它够得着的部分：装包、写 sshd 配置、`systemctl enable --now ssh`、部署公钥、配置端口映射。够不着的部分——Windows 防火墙规则这类需要管理员权限的 PowerShell 命令——它会逐条生成给你，复制到管理员 PowerShell 里跑完即可。

全部完成后问它一句「现在怎么从局域网连进来」，它会给出 IP、端口、用户名。记下来给下一步用。

### 5. 配置客户端

客户端同样不必手写：把上一步拿到的连接信息贴给任意 coding agent，让它写 `~/.ssh/config` 并确认公钥已部署。写出来的配置长这样：

```
Host laptop
    HostName <windows-ip>
    Port 2222
    User <wsl-user>
    IdentityFile ~/.ssh/id_ed25519
    ServerAliveInterval 60
    ServerAliveCountMax 10
```

之后 `ssh laptop` 一条命令直连 WSL。AI 路线的读者可以直接跳到「验证」；下面是不可替代场景下的手动全流程。

## 手动配置

以下每一步都等价于 dsh 自动做的事，逐条执行即可。

### 1. 端口映射

这是整个方案的关键。默认的 WSL2 用 NAT 网络：WSL 有自己的虚拟 IP（172.x 段），局域网里的机器看不到它，只能从 Windows 本机访问。所以要让 sshd 对外可达，就得在 Windows 上把某个端口转发进 WSL——这就是 `netsh portproxy` 干的事。

先拿 WSL 的 NAT IP，在 WSL 里：

```bash
hostname -I
```

记下输出的第一个地址（形如 `172.x.x.x`）。然后在 PowerShell（管理员）里加转发规则，把 Windows 的 2222 转到这个 IP 的 22：

```powershell
netsh interface portproxy add v4tov4 listenport=2222 listenaddress=0.0.0.0 connectport=22 connectaddress=<wsl-ip>
```

验证规则已生效：

```powershell
netsh interface portproxy show v4tov4
```

> [!IMPORTANT]
> WSL 的 NAT IP 在重启后可能变化，变了就要删掉旧规则重建（`netsh interface portproxy delete v4tov4 listenport=2222 listenaddress=0.0.0.0` 再 `add`）。如果嫌麻烦，新版本 WSL 支持 mirrored 网络模式——在 `C:\Users\<用户>\.wslconfig` 写 `[wsl2]` + `networkingMode=mirrored` 让 WSL 共享 Windows 网络栈，ssh 直接打 22 端口，不需要 portproxy。本文走 portproxy 路线是因为它对所有 WSL 版本都适用，而且 2222 端口天然避开 Windows OpenSSH 占用的 22。

### 2. 网络准备

部分 WSL 装好后 `/etc/resolv.conf` 缺失或 DNS 不可用，先把网修通，再换国内源加速装包。

关闭 WSL 自动生成 resolv.conf：

```bash
sudo bash -c 'cat > /etc/wsl.conf <<EOF
[network]
generateResolvConf = false
EOF'
```

手动写入 DNS：

```bash
sudo bash -c 'cat > /etc/resolv.conf <<EOF
nameserver 223.5.5.5
nameserver 119.29.29.29
EOF'
```

换清华源。Ubuntu 24.04 的源已改为 deb822 格式，存放在 `/etc/apt/sources.list.d/ubuntu.sources`（旧的 `sources.list` 只剩注释）：

```bash
sudo cp /etc/apt/sources.list.d/ubuntu.sources /etc/apt/sources.list.d/ubuntu.sources.bak
sudo sed -i 's|http://archive.ubuntu.com|https://mirrors.tuna.tsinghua.edu.cn|g; s|http://security.ubuntu.com|https://mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/ubuntu.sources
sudo apt update
```

> [!NOTE]
> 旧版本 Ubuntu（20.04 及更早）的源在 `/etc/apt/sources.list`，对那个文件做同样的域名替换即可。

验证连通性：

```bash
ping -c 2 223.5.5.5
ping -c 2 mirrors.tuna.tsinghua.edu.cn
```

两个都通就继续，不通在 PowerShell 里 `wsl --shutdown` 重进。

### 3. SSH 服务

```bash
sudo apt install -y openssh-server
```

写一份自定义配置，只留公钥认证：

```bash
sudo bash -c 'cat > /etc/ssh/sshd_config.d/custom.conf <<EOF
Port 22
PasswordAuthentication no
PubkeyAuthentication yes
EOF'
```

### 4. 密钥认证

客户端上查看公钥：

```bash
cat ~/.ssh/id_ed25519.pub
```

在 WSL 里写入 `authorized_keys`：

```bash
mkdir -p ~/.ssh
chmod 700 ~/.ssh
# 把客户端的公钥内容粘贴进去
vim ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

> [!CAUTION]
> 权限必须严格：`~/.ssh` 是 700，`authorized_keys` 是 600。sshd 对权限很挑剔，多一个 bit 都拒绝认证，而且不给明显报错。

### 5. 防火墙

让局域网能访问 Windows 的 2222 端口（即 portproxy 的监听口）。PowerShell（管理员）：

```powershell
New-NetFirewallRule -Name sshd-public-lan `
  -DisplayName 'SSH (LAN only)' `
  -Enabled True -Direction Inbound -Protocol TCP -Action Allow `
  -LocalPort 2222 -Profile Public `
  -RemoteAddress 10.0.0.0/8
```

**`-RemoteAddress` 不可省略**，否则等于对整个 Public 网络开放 22 端口——在校园网上约等于裸奔。网段替换为实际值。

验证：

```powershell
Get-NetFirewallRule -Name sshd-public-lan | Get-NetFirewallAddressFilter
```

`RemoteAddress` 应显示设定的网段，不能是 `Any`。

### 6. 开机自启

Ubuntu 24.04 可以直接启用 systemd——WSL 里最干净的自启方式。在 WSL 内：

```bash
sudo bash -c 'cat >> /etc/wsl.conf <<EOF

[boot]
systemd=true
EOF'
```

PowerShell 里 `wsl --shutdown` 后重新进入，然后：

```bash
sudo systemctl enable --now ssh
ss -tln | grep ':22 '
```

看到 `0.0.0.0:22` 监听即可。以后每次 Windows 启动 WSL，sshd 都由 systemd 拉起。

> [!TIP]
> 没有 systemd 的旧版本（如 Ubuntu 20.04）用 Windows 计划任务兜底：`wsl.exe -d <发行版> -u root -- service ssh start` 挂在 AtLogOn 触发器上。

portproxy 监听的是 2222，Windows 自带 OpenSSH Server 就算在跑也只占 22，两者互不冲突，不需要动它。

### 7. 客户端

在客户端机器上编辑 `~/.ssh/config`：

```
Host laptop
    HostName <windows-ip>
    Port 2222
    User <wsl-user>
    IdentityFile ~/.ssh/id_ed25519
    ServerAliveInterval 60
    ServerAliveCountMax 10
```

之后 `ssh laptop` 直连。公钥还没部署的话可以 `ssh-copy-id laptop`（需要临时允许密码登录一次，或沿用第 4 步的手动粘贴）。

## 验证

### SSH 与 SFTP

SSH 能通不等于 IDE 能用——**一定要同时验证 SFTP**，否则远程文件同步会挂：

```bash
ssh laptop "pwd && hostname && uname -a"
# 期望：/home/<user>、WSL 主机名、Linux ... GNU/Linux

sftp laptop
sftp> pwd
# 期望：Remote working directory: /home/<user>
```

两个都返回 Linux 路径，VS Code Remote-SSH 和 PyCharm 就能直接用 `laptop` 这个 Host。2222 端口只通向 WSL，不存在误连 Windows OpenSSH 的可能——这正是选 2222 的好处。

### CUDA 与 PyTorch

GPU 直通是 WSL 自带的，WSL 内不需要装 NVIDIA 驱动：

```bash
nvidia-smi
```

> [!NOTE]
> `nvidia-smi` 不在 PATH 的话，它在 `/usr/lib/wsl/lib/nvidia-smi`——WSL 把 Windows 驱动注入到这个目录。把 `/usr/lib/wsl/lib` 加进 `~/.zshrc` 的 PATH 即可。

看到 GPU 信息后，用 [uv](https://docs.astral.sh/uv/) 建环境验证 PyTorch：

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"

mkdir ~/projects/test-cuda && cd ~/projects/test-cuda
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

### Shell 启动

如果装了 setup.sh，顺便确认启动没有被插件拖慢：

```bash
time zsh -i -c exit
```

0.3s 量级为正常；如果慢到数秒，多半是某个插件在启动时联网拉资源被卡住，检查它是否走了回退源或本地缓存。

## 避坑要点

1. **portproxy 的 `connectaddress` 填 WSL 的 NAT IP**（`hostname -I` 拿到的 172.x），重启后可能变，变了就删规则重建。
2. **如果哪天改用 mirrored 模式，一定删掉 portproxy 规则**——mirrored 下把 22 转发到 Windows 自身 IP 会造成 22→22 自环，系统几秒内产生数千个 ESTABLISHED 连接直到资源耗尽，只能重启恢复。
3. **验证 SFTP，不只是 SSH**。`sftp laptop` 应返回 `/home/<user>` 这样的 Linux 路径。
4. **`~/.ssh` 权限是 700，`authorized_keys` 是 600**——多一个 bit 都拒绝认证。
5. **防火墙规则必带 `-RemoteAddress`**，不带等于对整个 Public 网络开放端口。
6. **WSL 内不要装 NVIDIA 驱动**。CUDA 由 Windows 驱动直通，`nvidia-smi` 显示的版本是驱动上限，与 PyTorch wheel 自带的 runtime 不需要一致。
7. **项目和数据放 `~/`，别放 `/mnt/c/`**——跨文件系统 I/O 慢一个数量级。
8. **长时间训练用 tmux**：`tmux new -s train` → `Ctrl+B D` 脱离 → `tmux attach -t train` 重连，关 SSH 不影响任务。

## 结语

这套方案的本质很简单：portproxy 把 WSL 里的 Linux sshd 映射到局域网，客户端连过去就是一台标准的 Linux 服务器。这次重配的变化是把环境初始化固化成了两个公开脚本（[setup.sh](https://momoyeyu.github.io/resource/script/setup.sh) / [dsh.sh](https://momoyeyu.github.io/resource/script/dsh.sh)，全部见[资源页](https://momoyeyu.github.io/resource/script/)），再让 agent 接手剩下的配置——说清楚要什么，比记住每一步怎么做重要。

## 参考资料

- <https://momoyeyu.github.io/resource/script/>
- <https://learn.microsoft.com/windows/wsl/wsl-config>
- <https://learn.microsoft.com/windows/wsl/networking>
- <https://platform.deepseek.com/>
- <https://docs.astral.sh/uv/>
- <https://pytorch.org/get-started/locally/>
- <https://mirrors.tuna.tsinghua.edu.cn/help/ubuntu/>
