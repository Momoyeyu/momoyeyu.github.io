# 日常指令一览：直接运行 `make`
.DEFAULT_GOAL := help
SHELL := /bin/bash

ASTRO  := ./node_modules/.bin/astro
VITEST := ./node_modules/.bin/vitest
NODE   := node

.PHONY: help new dev check deploy status

help:
	@echo "make new      新建文章（交互式向导：标题 / 分类 / 文件名 / 简介 / 标签 / EP）"
	@echo "make dev      本地预览 http://localhost:4321"
	@echo "make check    类型检查 + 单元测试（与 CI 门禁一致）"
	@echo "make deploy   检查 → 提交暂存区（消息为当前时间）→ 推送到 master，触发发布"
	@echo "make status   当前分支、暂存区改动、还没发布的草稿"

new:
	@$(NODE) scripts/new-post.js

dev:
	@$(ASTRO) dev

check:
	@$(ASTRO) check
	@$(VITEST) run

status:
	@echo "分支：$$(git rev-parse --abbrev-ref HEAD)"
	@echo ""
	@echo "暂存区改动（make deploy 会提交这些）："
	@if git diff --cached --quiet; then echo "  （空）"; else git diff --cached --stat; fi
	@echo ""
	@echo "未提交的改动："
	@if git diff --quiet && [ -z "$$(git ls-files --others --exclude-standard)" ]; then \
		echo "  （无）"; \
	else \
		git status --short; \
	fi
	@echo ""
	@echo "草稿 draft: true（不会发布）："
	@files=$$(grep -rl "^draft: true" src/content/posts 2>/dev/null | sed 's|src/content/posts/||'); \
	if [ -z "$$files" ]; then echo "  （无）"; else echo "$$files" | sed 's/^/  /'; fi

# 只在部署时刻提交：commit message 记录的是网站更新时间，所以它必须和 push 同一时刻产生。
# 不碰暂存区——请自己 git add 要发布的文件；暂存区为空时只做推送。
deploy: check
	@branch=$$(git rev-parse --abbrev-ref HEAD); \
	if [ "$$branch" != "master" ]; then \
		echo "当前分支是 $$branch；GitHub Pages 只从 master 发布，已停止。"; \
		exit 1; \
	fi; \
	if git diff --cached --quiet; then \
		echo "暂存区为空：跳过提交，只推送已有提交。"; \
	else \
		msg="Site updated: $$(date '+%Y-%m-%d %H:%M:%S')"; \
		git commit -m "$$msg" && echo "已提交：$$msg"; \
	fi; \
	git push origin master && echo "已推送到 origin/master，GitHub Actions 将自动构建并发布。"
