# 说明：本 Dockerfile 未在当前机器上验证（本机无 Docker）。
# 采用 Debian 基础镜像并安装 Chromium 与中文字体，保证容器内也能导出 PDF。
# 若不需要 PDF（只要 Word / Excel），可把基础镜像换成 node:20-alpine 并删除 apt 安装步骤，
# 镜像体积会从约 400MB 降到约 60MB。

FROM node:20-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       chromium ca-certificates fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

ENV CHROME_PATH=/usr/bin/chromium
ENV NODE_ENV=production
ENV PORT=8787
ENV HOST=0.0.0.0

WORKDIR /app

# 只复制运行所需内容，测试、文档与原型不进入镜像
COPY package.json ./
COPY config ./config
COPY prompts ./prompts
COPY public ./public
COPY src ./src
COPY data ./data

RUN mkdir -p /app/output && chown -R node:node /app

USER node

EXPOSE 8787

CMD ["node", "src/app/server.js"]
