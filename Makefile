# 日常指令一览：直接运行 `make`
.DEFAULT_GOAL := help
SHELL := /bin/bash

ASTRO  := ./node_modules/.bin/astro
VITEST := ./node_modules/.bin/vitest
NODE   := node

.PHONY: help new dev check commit push deploy status

help:
	@echo "make new      新建文章"
	@echo "make dev      本地预览"
	@echo "make check    类型检查与单测"
	@echo "make commit   提交暂存区"
	@echo "make push     推送到远端"
	@echo "make deploy   检查、提交、推送"
	@echo "make status   仓库与草稿状态"

new:
	@$(NODE) scripts/new-post.js

dev:
	@$(ASTRO) dev

check:
	@$(ASTRO) check
	@$(VITEST) run

# 提交信息记录网站更新时间，所以只在部署这一刻生成；暂存区始终由你自己管理。
commit:
	@if git diff --cached --quiet; then \
		echo "暂存区为空，先 git add 要提交的文件。"; \
		exit 1; \
	fi; \
	msg="Site updated: $$(date '+%Y-%m-%d %H:%M:%S')"; \
	git commit -m "$$msg" && echo "已提交：$$msg"

push:
	@branch=$$(git rev-parse --abbrev-ref HEAD); \
	if [ "$$branch" != "master" ]; then \
		echo "当前分支是 $$branch，只有 master 会发布，已停止。"; \
		exit 1; \
	fi; \
	git push origin master && echo "已推送 origin/master。"

deploy: check commit push

status:
	@echo "分支：$$(git rev-parse --abbrev-ref HEAD)"
	@echo ""
	@echo "暂存区改动："
	@if git diff --cached --quiet; then echo "  （空）"; else git diff --cached --stat; fi
	@echo ""
	@echo "未提交的改动："
	@if git diff --quiet && [ -z "$$(git ls-files --others --exclude-standard)" ]; then \
		echo "  （无）"; \
	else \
		git status --short; \
	fi
	@echo ""
	@echo "草稿 draft: true："
	@files=$$(grep -rl "^draft: true" src/content/posts 2>/dev/null | sed 's|src/content/posts/||'); \
	if [ -z "$$files" ]; then echo "  （无）"; else echo "$$files" | sed 's/^/  /'; fi
