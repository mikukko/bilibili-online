# AGENTS Guide
本文件用于指导在本仓库执行任务的 agent（含 AI coding agents）。
目标：快速、安全、可重复地修改代码，并保持与现有实现一致。

## 1. 仓库结构
- `apps/web/`：前端展示页 + Banner 抓取脚本（Node.js + Puppeteer）
- `apps/worker/`：在线人数采集服务（Python + httpx）
- `apps/data/`：运行时数据目录（示例数据）
- `docker-compose.yml`：一键启动 web/grabber/worker
- `Dockerfile`：统一镜像构建（包含 Node 与 Python 环境）

## 2. 规则文件检查（Cursor/Copilot）
- 未发现 `.cursorrules`
- 未发现 `.cursor/rules/`
- 未发现 `.github/copilot-instructions.md`
- 结论：当前仓库没有额外规则文件，本 `AGENTS.md` 为主规范

## 3. 运行时与包管理
- Web 包管理器：`pnpm`（`apps/web/package.json` 声明 `pnpm@10.28.2`）
- Web 脚本也支持 `npm run`（README 与 compose 使用该方式）
- Worker：Python 3（建议 3.10+）
- Python 依赖：`httpx>=0.27.0`

## 4. 本地开发命令

### 4.1 安装依赖
Web:
```bash
cd apps/web
pnpm install
```
Worker:
```bash
cd apps/worker
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 4.2 启动命令
Web 开发服务:
```bash
cd apps/web
npm run dev
```
Banner 单次抓取:
```bash
cd apps/web
npm run grab
```
Banner 定时抓取:
```bash
cd apps/web
npm run grab:schedule
```
Worker 启动:
```bash
cd apps/worker
python worker.py
```

## 5. Build / Lint / Test 说明（重点）

### 5.1 当前已存在能力
- Build：未配置前端打包命令（无 `build` script）
- Lint：未配置（无 ESLint / Ruff / Flake8 / Prettier）
- Test：未配置测试框架与测试目录

### 5.2 当前可执行检查（替代）
Web 语法检查:
```bash
node --check apps/web/src/index.js
node --check apps/web/src/grab.js
```
Python 语法检查:
```bash
python -m py_compile apps/worker/worker.py
```
Worker 最小烟测（手动中断）:
```bash
cd apps/worker
UPDATE_INTERVAL_SEC=5 MAX_ITEMS=5 python worker.py
```

### 5.3 单测（single test）约定
- 当前仓库无测试框架，因此没有真正的“单测命令”
- 如后续引入 `pytest`：
  - 单文件：`pytest tests/test_xxx.py`
  - 单用例：`pytest tests/test_xxx.py::test_case_name`
- 如后续引入 `vitest`：
  - 单文件：`vitest run path/to/file.test.js`
  - 单用例：`vitest run path/to/file.test.js -t "case name"`

## 6. Docker 命令
启动:
```bash
docker-compose up -d
```
日志:
```bash
docker-compose logs -f
docker-compose logs -f worker
docker-compose logs -f grabber
```
停止:
```bash
docker-compose down
```

### 6.1 镜像 Tag 约定
- `mikukko/bilibili-online:latest`：多架构镜像（`linux/amd64` + `linux/arm64`）
- `mikukko/bilibili-online:arm64`：ARM64 单独标签（用于显式锁定 ARM）
- 验证命令：`docker buildx imagetools inspect mikukko/bilibili-online:latest`

## 7. 通用改动原则
- 优先小而清晰的改动，避免无关重构
- 保持与现有代码风格一致，不引入新工具链
- 运行时配置走环境变量，不硬编码敏感信息
- 行为变化需同步更新 `README.md` 或本文件

## 8. JavaScript（apps/web）风格
- 模块系统：ESM（`type: module`）
- 缩进：2 空格
- 字符串/分号：沿用所在文件风格
- 导入顺序：内建模块 → 第三方依赖 → 本地模块
- 命名：变量/函数 `camelCase`，类 `PascalCase`，常量 `UPPER_SNAKE_CASE`
- DOM 操作前先判空（如 `if (!el) return`）
- 异步优先 `async/await`，避免多余 Promise 链
- 日志分级：`console.log` / `console.warn` / `console.error`

## 9. Python（apps/worker）风格
- 遵循 PEP 8（不强制引入格式化工具）
- 缩进：4 空格
- 新增函数尽量补全类型标注
- 注解优先现代写法：`dict[str, Any]`、`list[T]`
- 导入顺序：标准库 → 第三方 → 本地
- 命名：函数/变量 `snake_case`，类 `PascalCase`，常量 `UPPER_SNAKE_CASE`
- 并发 I/O：`asyncio` + `httpx.AsyncClient` + `Semaphore`
- 单条失败应记录并继续，不阻断全量处理
- 写文件保持原子写入（`.tmp` + `os.replace`）

## 10. 错误处理与健壮性
- 外部请求应具备：超时、重试、退避
- 外部 API 返回先校验类型，再读取字段
- 错误日志应包含上下文（接口、参数、重试次数）
- 可恢复错误：记录后继续；不可恢复错误：显式抛出

## 11. 数据契约
- Worker 输出 JSON 顶层字段保持：`updated_at`, `items`
- `items` 中至少包含：`bvid`, `title`, `pic`, `owner`, `online_total`, `online_count`
- 修改字段时必须同步更新 Web 渲染逻辑（依赖 `data/data.json`）

## 12. Agent 交付清单
- 修改前阅读目标文件与相邻调用点
- 修改后至少运行：
  - 改 JS：`node --check ...`
  - 改 Python：`python -m py_compile ...`
- 不提交虚拟环境、缓存、日志、凭据（如 `SESSDATA`）
- 新增脚本命令时同步更新：`apps/web/package.json`、`README.md`、`AGENTS.md`

## 13. 冲突优先级
1. 用户明确指令
2. 仓库现有实现与数据契约
3. 本 `AGENTS.md`
4. 通用最佳实践

最后更新：2026-02-26
