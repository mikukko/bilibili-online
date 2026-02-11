# bilibili-online

B站热门视频在线人数实时监控与 Banner 抓取展示。

## 功能

- **Web 展示**: 展示实时在线人数排名和动态 Banner。
- **数据采集 (Worker)**: 定时抓取 B站热门视频的在线人数。
- **Banner 抓取 (Grabber)**: 每日定时抓取 B站首页动态 Banner。

## Docker 部署 (推荐)

本项目支持 Docker 部署，且支持 ARM (Apple Silicon) 和 x86 架构。

### 前置要求

- [Docker](https://www.docker.com/)
- [Docker Compose](https://docs.docker.com/compose/)

### 快速启动

1. 构建并启动服务：
   ```bash
   docker-compose up --build -d
   ```

2. 访问页面：
   打开浏览器访问 [http://localhost:3000](http://localhost:3000)

3. 查看日志：
   ```bash
   # 查看所有服务日志
   docker-compose logs -f

   # 查看特定服务日志
   docker-compose logs -f worker
   docker-compose logs -f grabber
   ```

### 服务说明

- **web**: 前端页面服务，运行在 3000 端口。
- **grabber**: 每天早上 6:00 (可配置) 自动抓取 B站 Banner。
- **worker**: 每 5 分钟 (可配置) 更新一次视频在线人数数据。

### 配置

你可以复制 `.env.example` 为 `.env` 来修改配置，或者直接修改 `docker-compose.yml` 中的环境变量：

- `GRAB_HOUR`: Banner 抓取时间 (小时，0-23)。
- `UPDATE_INTERVAL_SEC`: Worker 更新间隔 (秒)。
- `MAX_CONCURRENCY`: Worker 并发请求数。
- `TZ`: 时区 (默认为 Asia/Shanghai)。

## 本地开发

### 安装依赖

**Web & Grabber**:
```bash
cd apps/web
npm install
```

**Worker**:
```bash
cd apps/worker
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 运行

**Web**:
```bash
cd apps/web
npm run dev
```

**Grabber**:
```bash
cd apps/web
node src/grab.js           # 单次运行
node src/grab.js --schedule # 定时模式
```

**Worker**:
```bash
cd apps/worker
python worker.py
```