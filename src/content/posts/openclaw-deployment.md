---
title: OpenClaw Deployment
date: 2026-03-03
description: '从零部署 OpenClaw AI Agent 并接入飞书机器人的完整流程与踩坑记录。'
tags: [Agent, Linux, 开源]
category: 项目
episode: 0
draft: false
image: '/img/posts/openclaw-deployment/cover.webp'
lang: 'zh_CN'
---

[OpenClaw](https://molt.bot) 是一个 AI Agent 框架，它的核心想法是让模型通过自然语言直接调本机的工具链——Docker、apt、systemctl 这些都能一句话搞定。最近想把它接到飞书上做团队内部助手，从零部署了一遍。这篇记录全流程，外加几个差点把我卡住的坑。

> 视频参考：[B 站 BV1DGAYzPELm](https://www.bilibili.com/video/BV1DGAYzPELm)
> 上游文档：[OpenClaw 飞书部署指南](https://acnh7t5exjqh.feishu.cn/wiki/UEY4wLoswiFQT4kwjIYcecqonih)

## 装 OpenClaw 本体

主程序的安装非常直接，官方给了个 one-liner：

```bash
curl -fsSL https://molt.bot/install.sh | bash
```

脚本会自动下二进制、配 PATH，跑完之后会以交互方式让你填 API 密钥、选模型，一路按提示走完就行。

到这一步 `openclaw` 命令应该已经能在终端跑起来了。但它本质上只是个跑完就退出的 CLI，要让它持续接外部消息（比如飞书机器人转过来的请求），还得再搭一个常驻进程。

## 装 Gateway 守护进程

OpenClaw 自己是"消息进 → 处理 → 退出"的一次性 CLI，没法直接做"消息进来 → 模型处理 → 回结果"这种持续循环。所以官方提供了一个叫 gateway 的常驻服务，专门负责对外通信：

```bash
openclaw gateway install
systemctl --user start openclaw-gateway.service
```

第一行把 gateway 装成 systemd 用户级 service，第二行启动它。装好之后整条链路就清晰了——飞书消息打过来，gateway 接收，转给 openclaw 主程序处理，再把结果送回飞书。

## sudoers 白名单放行

OpenClaw 干活的时候经常需要执行 `docker`、`apt`、`systemctl` 这种需要 root 的命令。Agent 没法做交互式 sudo（输不了密码），所以得给它跑的那个用户开 NOPASSWD——但不能直接 `NOPASSWD: ALL`，那等于把整台机器交出去了。比较稳妥的写法是"白名单 + 绝对路径"，列出它可以免密执行的具体命令：

```bash
sudo bash -c 'cat > /etc/sudoers.d/jacky-dev << '\''EOF'\''
jacky ALL=(ALL) NOPASSWD: \
    /usr/bin/docker, \
    /usr/bin/docker-compose, \
    /usr/local/bin/docker-compose, \
    /usr/bin/apt, \
    /usr/bin/apt-get, \
    /usr/bin/dpkg, \
    /usr/sbin/usermod, \
    /usr/sbin/groupadd, \
    /usr/sbin/useradd, \
    /bin/systemctl, \
    /usr/bin/systemctl, \
    /usr/sbin/service, \
    /usr/bin/snap, \
    /usr/bin/chmod, \
    /usr/bin/chown, \
    /bin/mkdir, \
    /bin/rm, \
    /bin/cp, \
    /bin/mv, \
    /usr/sbin/nginx, \
    /usr/bin/nginx, \
    /usr/sbin/ufw
EOF
sudo chmod 440 /etc/sudoers.d/jacky-dev && sudo visudo -c -f /etc/sudoers.d/jacky-dev && echo "✅ 配置成功"'
```

记得把脚本里的 `jacky` 改成你的实际用户名，文件名 `jacky-dev` 也跟着调一下。

这样配的好处是：哪天 OpenClaw 想跑列表之外的命令——不管是无意还是恶意——sudoers 这一层会直接挡回来，再要 root 必须人工输密码。

## 创建飞书应用

接入飞书走的是开放平台的"企业自建应用"路径。先把"壳子"搭出来：

1. 打开 [open.feishu.cn](https://open.feishu.cn) → 开发者后台 → **创建企业自建应用**。
2. 填应用名称，创建。
3. 左侧菜单 **添加应用能力** → 选 **机器人** → 添加。
4. 左侧 **凭证与基础信息** → 复制 **App ID** 和 **App Secret**，待会儿这两串要喂给 OpenClaw。

到这里应用本身有了，但默认没有任何 API 权限——要给它装"手"才能干活。

## 批量导入机器人权限

OpenClaw 几乎要用全套飞书 API：base（多维表）、bitable、docs、drive、im（消息）、sheets、wiki、space 都要碰。开放平台后台支持一个个手动勾权限点，但量级是百级别的，手点会折腾死。

更省事的办法是用 JSON 批量导入——在开放平台的 **权限管理 → 批量配置** 里粘下面这段，一次性应用：

```json
{
  "scopes": {
    "tenant": [
      "base:app:copy",
      "base:app:create",
      "base:app:read",
      "base:app:update",
      "base:collaborator:create",
      "base:collaborator:delete",
      "base:collaborator:read",
      "base:dashboard:copy",
      "base:dashboard:read",
      "base:field:create",
      "base:field:delete",
      "base:field:read",
      "base:field:update",
      "base:form:read",
      "base:form:update",
      "base:record:create",
      "base:record:delete",
      "base:record:read",
      "base:record:retrieve",
      "base:record:update",
      "base:role:create",
      "base:role:delete",
      "base:role:read",
      "base:role:update",
      "base:table:create",
      "base:table:delete",
      "base:table:read",
      "base:table:update",
      "base:view:read",
      "base:view:write_only",
      "bitable:app",
      "bitable:app:readonly",
      "board:whiteboard:node:create",
      "board:whiteboard:node:delete",
      "board:whiteboard:node:read",
      "board:whiteboard:node:update",
      "contact:contact.base:readonly",
      "contact:user.base:readonly",
      "contact:user.employee_id:readonly",
      "contact:user.employee_number:read",
      "contact:user.id:readonly",
      "docs:doc",
      "docs:doc:readonly",
      "docs:document.comment:create",
      "docs:document.comment:read",
      "docs:document.comment:update",
      "docs:document.comment:write_only",
      "docs:document.content:read",
      "docs:document.media:download",
      "docs:document.media:upload",
      "docs:document.subscription",
      "docs:document.subscription:read",
      "docs:document:copy",
      "docs:document:export",
      "docs:document:import",
      "docs:event.document_deleted:read",
      "docs:event.document_edited:read",
      "docs:event.document_opened:read",
      "docs:event:subscribe",
      "docs:permission.member",
      "docs:permission.member:auth",
      "docs:permission.member:create",
      "docs:permission.member:delete",
      "docs:permission.member:readonly",
      "docs:permission.member:retrieve",
      "docs:permission.member:transfer",
      "docs:permission.member:update",
      "docs:permission.setting",
      "docs:permission.setting:read",
      "docs:permission.setting:readonly",
      "docs:permission.setting:write_only",
      "docx:document",
      "docx:document.block:convert",
      "docx:document:create",
      "docx:document:readonly",
      "drive:drive",
      "drive:drive.metadata:readonly",
      "drive:drive.search:readonly",
      "drive:drive:readonly",
      "drive:drive:version",
      "drive:drive:version:readonly",
      "drive:export:readonly",
      "drive:file",
      "drive:file.like:readonly",
      "drive:file.meta.sec_label.read_only",
      "drive:file:download",
      "drive:file:readonly",
      "drive:file:upload",
      "drive:file:view_record:readonly",
      "event:ip_list",
      "im:app_feed_card:write",
      "im:biz_entity_tag_relation:read",
      "im:biz_entity_tag_relation:write",
      "im:chat",
      "im:chat.access_event.bot_p2p_chat:read",
      "im:chat.announcement:read",
      "im:chat.announcement:write_only",
      "im:chat.chat_pins:read",
      "im:chat.chat_pins:write_only",
      "im:chat.collab_plugins:read",
      "im:chat.collab_plugins:write_only",
      "im:chat.managers:write_only",
      "im:chat.members:bot_access",
      "im:chat.members:read",
      "im:chat.members:write_only",
      "im:chat.menu_tree:read",
      "im:chat.menu_tree:write_only",
      "im:chat.moderation:read",
      "im:chat.tabs:read",
      "im:chat.tabs:write_only",
      "im:chat.top_notice:write_only",
      "im:chat.widgets:read",
      "im:chat.widgets:write_only",
      "im:chat:create",
      "im:chat:delete",
      "im:chat:moderation:write_only",
      "im:chat:operate_as_owner",
      "im:chat:read",
      "im:chat:readonly",
      "im:chat:update",
      "im:datasync.feed_card.time_sensitive:write",
      "im:message",
      "im:message.group_at_msg:readonly",
      "im:message.group_msg",
      "im:message.p2p_msg:readonly",
      "im:message.pins:read",
      "im:message.pins:write_only",
      "im:message.reactions:read",
      "im:message.reactions:write_only",
      "im:message.urgent",
      "im:message.urgent.status:write",
      "im:message.urgent:phone",
      "im:message.urgent:sms",
      "im:message:readonly",
      "im:message:recall",
      "im:message:send_as_bot",
      "im:message:send_multi_depts",
      "im:message:send_multi_users",
      "im:message:send_sys_msg",
      "im:message:update",
      "im:resource",
      "im:tag:read",
      "im:tag:write",
      "im:url_preview.update",
      "im:user_agent:read",
      "sheets:spreadsheet",
      "sheets:spreadsheet.meta:read",
      "sheets:spreadsheet.meta:write_only",
      "sheets:spreadsheet:create",
      "sheets:spreadsheet:read",
      "sheets:spreadsheet:readonly",
      "sheets:spreadsheet:write_only",
      "space:document.event:read",
      "space:document:delete",
      "space:document:move",
      "space:document:retrieve",
      "space:document:shortcut",
      "space:folder:create",
      "wiki:member:create",
      "wiki:member:retrieve",
      "wiki:member:update",
      "wiki:node:copy",
      "wiki:node:create",
      "wiki:node:move",
      "wiki:node:read",
      "wiki:node:retrieve",
      "wiki:node:update",
      "wiki:setting:read",
      "wiki:setting:write_only",
      "wiki:space:read",
      "wiki:space:retrieve",
      "wiki:space:write_only",
      "wiki:wiki",
      "wiki:wiki:readonly"
    ]
  }
}
```

提交之后所有权限会一次性配齐，比手点省一个数量级的时间。

## 验证遇到的问题

发布应用进入审核阶段时遇到过验证失败，常见原因不外乎几个：

1. **gateway 没在跑**。先 `systemctl --user status openclaw-gateway` 确认服务状态。
2. **回调地址外部不可达**。机器在内网或者端口没开都会让飞书拨号失败。直接从外部网络 `curl` 一下回调 URL，能通才算数。
3. **后台配置对不上**。飞书"事件订阅"里填的地址要和实际 gateway 监听的 host:port 完全对齐，包括协议（http/https）和路径。

按这个清单倒查一遍基本能定位到问题。原始踩坑笔记里这段引用了一篇外部解决方案，但链接已失效——后面再遇到具体场景会单独写。

## 跑起来之后

到这里整个链路就通了：飞书消息 → gateway → openclaw → 模型 → 工具调用 → 回结果给飞书。剩下的真正的活儿是 prompt 设计和工具集编排——让 OpenClaw 知道哪些命令在哪些场景该用、什么时候该问人。这部分话题更大，单独再开一篇。
