# 剧场排练走位工具 —— 生产镜像
# 零第三方运行时依赖（仅使用 Node.js 内置模块）。
FROM node:20-alpine

WORKDIR /app

# 仅拷贝服务端与静态资源，.dockerignore 已排除无关文件（test/、README 等）
COPY package.json ./
COPY server.js ./
COPY public ./public

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

EXPOSE 3000

# 容器启动即完成全部初始化：无外部数据库、无需迁移脚本；
# 走位与报告快照均保存在用户浏览器 localStorage 中，容器无状态、可随时重建。
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "server.js"]
