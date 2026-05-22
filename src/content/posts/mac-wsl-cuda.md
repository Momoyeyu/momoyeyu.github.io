---
title: Mac 连接 WSL 使用 CUDA
published: 2026-05-22
updated: 2026-05-22
description: 'Mac SSH 直连 WSL2：mirrored 网络、sshd 配置、防火墙与 PyTorch GPU 验证。'
tags: [macOS, WSL, CUDA]
category: 环境搭建
draft: false
lang: 'zh_CN'
---

这篇记录用 Mac 通过 SSH 直连 Windows 上的 WSL2，在原生 Linux 环境里调 GPU 跑深度学习的完整配置过程。

方案的核心思路：**在 WSL2 内部装 sshd，配合 mirrored 网络模式，让 WSL 直接共享 Windows 的网络栈**。Mac 连 `<windows-ip>:22` 就是在连 WSL 里的 Linux，不需要经过 Windows OpenSSH，不需要 `.bat` 跳板脚本，不需要端口转发。SSH 和 SFTP 走的都是同一个原生 Linux sshd，PyCharm、VS Code Remote-SSH 直接就能用。

> [!NOTE]
> **前提条件**
>
> - Windows 11
> - NVIDIA GPU + 已装 [GeForce / Studio 驱动](https://www.nvidia.com/Download/index.aspx)（2020 年后的版本均支持 WSL2 CUDA 直通）
> - Windows 已启用虚拟化（BIOS 中 VT-x / AMD-V + Hyper-V）
> - Mac 与 Windows 在同一局域网（校园网、家庭网都行）
> - Mac 已生成 SSH 密钥（没有的话：`ssh-keygen -t ed25519`）

## 1. 安装 WSL2 + Ubuntu

PowerShell（管理员）：

```powershell
wsl --install -d Ubuntu-24.04
```

装完重启 Windows，首次进入 WSL 设置 Linux 用户名和密码。

确认版本：

```powershell
wsl -l -v
```

`VERSION` 列应该是 2。如果是 1：

```powershell
wsl --set-version Ubuntu-24.04 2
```

> [!TIP]
> 推荐 Ubuntu 24.04 而不是 20.04——20.04 已经接近 EOL，而且 24.04 对 systemd 的支持更好，后面配 sshd 自启更省事。

## 2. 启用 mirrored 网络模式

这是整个方案的关键。默认情况下 WSL2 用 NAT 网络，有自己的虚拟 IP，外部访问需要端口转发。**mirrored 模式让 WSL 直接共享 Windows 的网络栈**，WSL 里 `0.0.0.0:22` 监听的端口，从局域网 `<windows-ip>:22` 就能直接访问。

在 Windows 上创建或编辑 `C:\Users\<用户>\.wslconfig`：

```ini
[wsl2]
networkingMode=mirrored
```

然后在 PowerShell 中重启 WSL：

```powershell
wsl --shutdown
```

再次进入 WSL，验证网络模式：

```bash
hostname -I
```

> [!IMPORTANT]
> mirrored 模式下，`hostname -I` 显示的 IP 和 Windows 的局域网 IP 相同——这是正常的，说明网络栈已经共享。不需要做任何端口转发。
>
> 如果启用 mirrored 后遇到 `0x8007054f` 之类的错误，说明 WSL 版本太旧不支持。可以用 `wsl --update` 升级，或者回退到 NAT + `netsh portproxy` 方案（见文末附录）。

## 3. 修复 DNS

部分 WSL 安装后 `/etc/resolv.conf` 缺失或 DNS 不可用，网都连不上，后面什么都装不了。先修这个。

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

验证：

```bash
ping -c 2 223.5.5.5
ping -c 2 mirrors.tuna.tsinghua.edu.cn
```

两个都通就 OK。不通的话在 PowerShell 里 `wsl --shutdown` 再重新进。

## 4. 换清华源

国内用户建议换源，后面装包快很多。

```bash
sudo cp /etc/apt/sources.list /etc/apt/sources.list.bak
sudo sed -i 's|http://archive.ubuntu.com|https://mirrors.tuna.tsinghua.edu.cn|g; s|http://security.ubuntu.com|https://mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list
sudo apt update
```

## 5. 在 WSL 内安装 sshd

这里直接在 WSL 的 Linux 里装 openssh-server，而不是用 Windows 的 OpenSSH。这样 SSH 和 SFTP 走的都是同一个原生 Linux sshd，IDE 的远程开发功能才能正常工作。

```bash
sudo apt install -y openssh-server
```

写一份自定义配置：

```bash
sudo bash -c 'cat > /etc/ssh/sshd_config.d/custom.conf <<EOF
Port 22
PasswordAuthentication no
PubkeyAuthentication yes
EOF'
```

## 6. 配置密钥认证

Mac 上查看公钥：

```bash
cat ~/.ssh/id_ed25519.pub
```

在 WSL 里把公钥加到 `authorized_keys`：

```bash
mkdir -p ~/.ssh
chmod 700 ~/.ssh
# 把 Mac 上的公钥内容粘贴进去
vim ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

> [!CAUTION]
> 权限必须严格：`~/.ssh` 是 700，`authorized_keys` 是 600。sshd 对权限很挑剔，多一个 bit 都会拒绝认证，而且不给明显报错。

## 7. 启动 sshd 并验证

```bash
sudo service ssh start
sudo ss -tlnp | grep :22
```

应该看到 sshd 在 `0.0.0.0:22` 监听。

## 8. 禁用 Windows OpenSSH

WSL 的 sshd 已经占了 22 端口，Windows 自带的 OpenSSH Server 如果也在跑会冲突。而且我们不需要它了——直接关掉。

PowerShell（管理员）：

```powershell
Stop-Service sshd -ErrorAction SilentlyContinue
Set-Service -Name sshd -StartupType Disabled -ErrorAction SilentlyContinue
```

> [!WARNING]
> **千万不要在 mirrored 模式下用 `netsh portproxy` 把 22 端口转发到 Windows 自己的 IP**。这会造成自环——端口 22 的流量转发到自己的端口 22，系统会在几秒内产生数千个 ESTABLISHED 连接，直到资源耗尽，只能重启才能恢复。

## 9. 配置 Windows 防火墙

让局域网能访问 WSL 的 22 端口。

PowerShell（管理员）：

```powershell
New-NetFirewallRule -Name sshd-public-lan `
  -DisplayName 'SSH (LAN only)' `
  -Enabled True -Direction Inbound -Protocol TCP -Action Allow `
  -LocalPort 22 -Profile Public `
  -RemoteAddress 10.0.0.0/8
```

**`-RemoteAddress` 不可省略**，否则等于对整个 Public 网络开放 22 端口——在校园网上这约等于裸奔。网段替换为实际值。

验证：

```powershell
Get-NetFirewallRule -Name sshd-public-lan | Get-NetFirewallAddressFilter
```

`RemoteAddress` 应该显示你设定的网段，不能是 `Any`。

## 10. 设置 sshd 开机自启

WSL 默认没有 systemd（Ubuntu 24.04 可以手动开启），sshd 不会随 Windows 开机自动启动。用 Windows 计划任务解决：

PowerShell（管理员）：

```powershell
$action = New-ScheduledTaskAction -Execute "wsl.exe" `
  -Argument "-d Ubuntu-24.04 -u root -- service ssh start"
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERNAME" -RunLevel Highest
Register-ScheduledTask -TaskName "Start WSL SSHD" `
  -Action $action -Trigger $trigger -Principal $principal -Force
```

这样每次 Windows 登录后，WSL 的 sshd 就会自动拉起。

> [!TIP]
> 如果你用的是 Ubuntu 24.04，可以在 `/etc/wsl.conf` 里加 `[boot]` + `systemd=true`，然后 `sudo systemctl enable ssh` 就行，不需要计划任务。但这个选项在 20.04 上不可用。

## 11. Mac 端 SSH 配置

编辑 `~/.ssh/config`：

```
Host gpu
    HostName <windows-ip>
    Port 22
    User <wsl-user>
    IdentityFile ~/.ssh/id_ed25519
    UseKeychain yes
    AddKeysToAgent yes
    ServerAliveInterval 60
    ServerAliveCountMax 10
```

之后 `ssh gpu` 一条命令就能连进 WSL。

## 12. 验证 SSH 和 SFTP

SSH 能通不等于 IDE 能用。**一定要同时验证 SFTP**，否则 PyCharm 和 VS Code 的远程文件同步会挂。

```bash
# 验证 SSH
ssh gpu "pwd && hostname && uname -a"
# 期望：/home/<user>、WSL 主机名、Linux ... GNU/Linux

# 验证 SFTP
sftp gpu
sftp> pwd
# 期望：Remote working directory: /home/<user>
# 如果显示的是 C:\Users\... 说明连到了 Windows OpenSSH，检查是不是没禁用
```

两个都返回 Linux 路径就 OK。VS Code Remote-SSH 和 PyCharm Professional 的远程开发功能可以直接用 `gpu` 这个 Host 名。

## 13. 验证 CUDA + PyTorch

GPU 直通是 WSL2 自带的，不需要在 WSL 内装 NVIDIA 驱动。先确认直通正常：

```bash
nvidia-smi
```

看到 GPU 信息就行。然后装 [uv](https://docs.astral.sh/uv/) 管理 Python 环境：

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
```

创建一个测试项目验证 PyTorch CUDA：

```bash
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

输出 `True` 就 OK。

## 14. Shell 美化（可选）

如果习惯 zsh：

```bash
sudo apt install -y zsh
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions
git clone https://github.com/zsh-users/zsh-syntax-highlighting ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting
```

编辑 `~/.zshrc`，把 `plugins=(git)` 改成 `plugins=(git zsh-autosuggestions zsh-syntax-highlighting)`，`source ~/.zshrc` 生效。

## 避坑要点

1. **mirrored 模式下 `hostname -I` 等于 Windows IP**——这不是 bug，是 feature。说明网络栈已共享，不需要端口转发。
2. **不要用 `netsh portproxy` 转发到 Windows 自身 IP**。mirrored 模式下这会造成 22→22 自环，系统在几秒内产生数千个连接，只能重启恢复。
3. **验证 SFTP，不只是 SSH**。`ssh gpu "pwd"` 能通不代表 IDE 能用——一定要测 `sftp gpu` 看路径是不是 Linux 的 `/home/...`。如果是 `C:\Users\...`，说明连到了 Windows OpenSSH，没禁干净。
4. **WSL 的 sshd 不会自动启动**。Ubuntu 20.04 没有 systemd，必须用 Windows 计划任务拉起。24.04 可以开启 systemd 后用 `systemctl enable`。
5. **防火墙规则必须带 `-RemoteAddress`**。不带等于对整个 Public 网络开放端口。
6. **用 ed25519 密钥，不要 RSA**。更短、更快、更安全。
7. **WSL 内不要装 NVIDIA 驱动**。CUDA 通过 Windows 驱动直通，WSL 只需要装 PyTorch wheel。需要 `nvcc` 编译的话装 CUDA Toolkit 即可。
8. **PyTorch 自带 CUDA runtime**。`nvidia-smi` 显示的 CUDA 版本是驱动支持的上限，跟 PyTorch wheel 自带的版本不需要完全一致。
9. **项目和数据放 `~/`，别放 `/mnt/c/`**。跨文件系统 I/O 慢 10 倍以上。
10. **长时间训练用 tmux**。`tmux new -s train` → 开始训练 → `Ctrl+B D` 脱离 → 关掉 SSH 也不影响 → `tmux attach -t train` 重连。

## 附录：mirrored 模式不可用时的备选方案

如果你的 WSL 版本太旧不支持 mirrored 网络模式，可以用 NAT + `netsh portproxy` 作为替代：

```powershell
# 获取 WSL 的 NAT IP
wsl -d Ubuntu-24.04 -- hostname -I

# 添加端口转发（WSL IP 每次重启可能变）
netsh interface portproxy add v4tov4 listenport=22 listenaddress=0.0.0.0 connectport=22 connectaddress=<wsl-ip>
```

注意 NAT 模式下 WSL 的 IP 每次重启可能变，需要写脚本自动更新 portproxy 规则。这比 mirrored 模式麻烦得多，建议优先升级 WSL 版本。

## 写在最后

这套方案的本质很简单：WSL2 mirrored 网络让 Linux sshd 直接暴露在局域网上，Mac 连过去就是一个标准的 Linux 远程开发环境，SSH 和 SFTP 都走原生 Linux，IDE 远程开发开箱即用。

之前走 Windows OpenSSH + `.bat` 跳板的弯路，根源在于没意识到 mirrored 模式能让 WSL 直接上网。绕了一圈发现，最简单的架构往往也是最可靠的。
