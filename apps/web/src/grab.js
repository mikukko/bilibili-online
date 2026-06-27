/*
 * 网页抓取 - 支持单次运行和定时调度模式
 *
 * 用法:
 *   node src/grab.js              # 单次运行，使用日期作为名称
 *   node src/grab.js myname       # 单次运行，使用 myname 作为名称
 *   node src/grab.js --schedule   # 定时模式，每天自动抓取一次
 *
 * 环境变量:
 *   GRAB_HOUR        每天抓取时间（小时），默认 6
 *   RETENTION_DAYS   保留最近多少天的 banner 数据，默认 30
 *
 * 致谢：
 *  - 参考 https://github.com/palxiao/bilibili-banner
 */
import { launch } from "puppeteer";
import { existsSync, readdirSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "fs";
import { join, resolve as _resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 解析命令行参数
const args = process.argv.slice(2);
const isScheduleMode = args.includes('--schedule');

// 每天抓取的时间（小时），默认早上 6 点
const GRAB_HOUR = parseInt(process.env.GRAB_HOUR || '6', 10);

// 保留最近多少天的 banner 数据，默认 30 天
const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || '30', 10);

// 获取今天的日期字符串
function getDateString() {
  const today = new Date();
  const year = today.getFullYear();
  const month = ("0" + (today.getMonth() + 1)).slice(-2);
  const day = ("0" + today.getDate()).slice(-2);
  return year + "-" + month + "-" + day;
}

const assetsPath = _resolve(__dirname, "../assets");

function writeLatestBannerMeta(manifest) {
  const folder = manifest?.folder || manifest?.date;
  if (!folder) return;

  const latestMeta = {
    folder,
    date: manifest?.date || folder,
    name: manifest?.name || folder,
    dataFile: `./assets/${folder}/data.json`,
    manifestFile: `./assets/${folder}/manifest.json`,
    generatedAt: new Date().toISOString()
  };

  writeFileSync(join(assetsPath, 'latest.json'), JSON.stringify(latestMeta, null, 2));
  console.log(`✅ latest.json 已更新 -> ${folder}`);
}

// 清理超过保留天数的旧 banner 文件夹
function cleanupOldFolders() {
  if (!existsSync(assetsPath)) return;

  const now = new Date();
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const cutoffDate = cutoff.getFullYear() + "-" +
    String(cutoff.getMonth() + 1).padStart(2, '0') + "-" +
    String(cutoff.getDate()).padStart(2, '0');

  const folders = readdirSync(assetsPath, { withFileTypes: true })
    .filter(d => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
    .map(d => d.name);

  let cleaned = 0;
  for (const folder of folders) {
    if (folder < cutoffDate) {
      try {
        rmSync(join(assetsPath, folder), { recursive: true, force: true });
        cleaned++;
      } catch (e) {
        console.warn(`清理旧文件夹失败: ${folder}`, e.message);
      }
    }
  }

  if (cleaned > 0) {
    console.log(`🧹 已清理 ${cleaned} 个超过 ${RETENTION_DAYS} 天的旧文件夹`);

    // 检查 latest.json 是否指向已删除的文件夹，如果是则更新
    updateLatestJsonIfNeeded();
  }
}

// 更新 latest.json，确保它指向一个有效的文件夹
function updateLatestJsonIfNeeded() {
  const latestPath = join(assetsPath, 'latest.json');
  if (!existsSync(latestPath)) return;

  try {
    const latest = JSON.parse(readFileSync(latestPath, 'utf8'));
    const latestFolder = latest?.folder;

    // 如果 latest.json 指向的文件夹不存在，需要更新
    if (latestFolder && !existsSync(join(assetsPath, latestFolder))) {
      console.log(`⚠️  latest.json 指向的文件夹 ${latestFolder} 已被删除，正在更新...`);

      // 查找最新的有效文件夹
      const remainingFolders = readdirSync(assetsPath, { withFileTypes: true })
        .filter(d => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
        .map(d => d.name)
        .sort((a, b) => b.localeCompare(a)); // 按日期降序排序

      if (remainingFolders.length > 0) {
        const newestFolder = remainingFolders[0];
        const manifestPath = join(assetsPath, newestFolder, 'manifest.json');

        if (existsSync(manifestPath)) {
          const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
          writeLatestBannerMeta({ ...manifest, folder: newestFolder });
        } else {
          // 没有 manifest.json，直接写入文件夹信息
          writeLatestBannerMeta({ folder: newestFolder, date: newestFolder, name: newestFolder });
        }
      } else {
        // 没有剩余文件夹，删除 latest.json
        rmSync(latestPath, { force: true });
        console.log('⚠️  没有剩余的 banner 文件夹，已删除 latest.json');
      }
    }
  } catch (e) {
    console.warn('更新 latest.json 失败:', e.message);
  }
}

/**
 * 核心抓取逻辑
 * @param {string} bannerName - banner 名称
 * @returns {Promise<boolean>} 是否成功抓取
 */
async function grabBanner(bannerName) {
  const date = getDateString();
  const folderPath = join(assetsPath, date);
  const memoryCache = [];
  const data = [];

  const browser = await launch({
    headless: 'new',
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--window-size=1920,1080",
      "--disable-blink-features=AutomationControlled"
    ],
    defaultViewport: {
      width: 1920,
      height: 1080
    }
  });
  const page = await browser.newPage();

  // 隐藏 webdriver 标识
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined
    });
  });

  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

  // 下载到内存，不立即写入磁盘
  async function downloadToMemory(item) {
    const fileArr = item.src.split("/");
    const fileName = fileArr[fileArr.length - 1];
    const filePath = `${folderPath}/${fileName}`;

    const content = await page.evaluate(async (url) => {
      const response = await fetch(url);
      const buffer = await response.arrayBuffer();
      return { buffer: Array.from(new Uint8Array(buffer)) };
    }, item.src);

    const fileData = Buffer.from(content.buffer);

    // 存储到内存缓存，而不是立即写入磁盘
    memoryCache.push({
      fileName,
      filePath,
      fileData
    });

    data.push({ ...item, src: `./assets/${date}/${fileName}` });
  }

  try {
    console.log('正在加载 B站首页...');
    await page.goto("https://www.bilibili.com/", {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    // 额外等待网络请求完成
    await sleep(5000);
    console.log('页面已加载，等待 banner 元素...');

    // 尝试多种选择器
    const selectors = [
      ".animated-banner .layer",
      ".bili-banner .layer",
      ".header-banner .layer",
      "[class*='banner'] .layer"
    ];

    let layerElements = [];
    for (const selector of selectors) {
      try {
        await page.waitForSelector(selector, { timeout: 10000 });
        layerElements = await page.$$(selector);
        if (layerElements.length > 0) {
          console.log(`使用选择器: ${selector}`);
          break;
        }
      } catch (e) {
        console.log(`选择器 ${selector} 未找到，尝试下一个...`);
      }
    }

    console.log(`Found ${layerElements.length} layers.`);

    if (layerElements.length === 0) {
      console.error('未找到 banner layers，请检查页面结构');
      await browser.close();
      return false;
    }

    // 获取并下载数据到内存（不写入磁盘）
    for (let i = 0; i < layerElements.length; i++) {
      const layerFirstChild = await page.evaluate(async (el) => {
        const pattern = /translate\(([-.\d]+px), ([-.\d]+px)\)/;
        const { width, height, src, style, tagName } = el.firstElementChild;
        const matches = style.transform.match(pattern);
        const transform = [1, 0, 0, 1, ...matches.slice(1).map(x => +x.replace('px', ''))]
        return { tagName: tagName.toLowerCase(), opacity: [style.opacity, style.opacity], transform, width, height, src, a: 0.01 };
      }, layerElements[i]);
      await downloadToMemory(layerFirstChild);
    }

    // 完成后自动偏移 banner 计算视差系数
    let element = await page.$('.animated-banner')
    let { x, y } = await element.boundingBox()
    await page.mouse.move(x + 0, y + 50)
    await page.mouse.move(x + 1000, y, { steps: 1 })
    await sleep(1200);

    // 偏移后计算每个图层的相对位置，并得出加速度a
    layerElements = await page.$$(".animated-banner .layer");
    for (let i = 0; i < layerElements.length; i++) {
      const skew = await page.evaluate(async (el) => {
        const pattern = /translate\(([-.\d]+px), ([-.\d]+px)\)/;
        const matches = el.firstElementChild.style.transform.match(pattern);
        return matches.slice(1).map(x => +x.replace('px', ''))[0]
      }, layerElements[i]);
      data[i].a = (skew - data[i].transform[4]) / 1000
    }

    // 写入今天的文件夹
    console.log('正在写入本地文件...');

    if (!existsSync(folderPath)) {
      mkdirSync(folderPath, { recursive: true });
    }

    // 将缓存的文件写入磁盘
    for (const cached of memoryCache) {
      writeFileSync(cached.filePath, cached.fileData);
    }

    // 写入 data.json
    writeFileSync(join(folderPath, 'data.json'), JSON.stringify(data, null, 2));

    // 写入 manifest.json
    const manifest = {
      name: bannerName,
      date: date,
      createdAt: new Date().toISOString(),
      fileCount: data.length
    };
    writeFileSync(join(folderPath, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log('✅ manifest.json 已生成');
    writeLatestBannerMeta({ ...manifest, folder: date });

    // 清理超过保留天数的旧文件夹
    cleanupOldFolders();

  } catch (error) {
    console.error("Error:", error);
    await browser.close();
    return false;
  }

  await sleep(300);
  await browser.close();
  console.log(`✅ Banner "${bannerName}" 抓取完成!`);
  return true;
}

/**
 * 定时调度模式 — 每天指定时间抓取一次
 */
async function scheduleMode() {
  console.log(`[scheduler] 定时模式启动，每天 ${GRAB_HOUR}:00 抓取 banner，保留 ${RETENTION_DAYS} 天`);

  // 启动时先执行一次（如果今天还没有数据）
  const todayDate = getDateString();
  const todayFolder = join(assetsPath, todayDate);
  if (!existsSync(join(todayFolder, 'data.json'))) {
    console.log('[scheduler] 今天尚未抓取，立即执行一次...');
    await grabBanner(todayDate);
  } else {
    console.log(`[scheduler] 今天 (${todayDate}) 已有数据，跳过首次抓取`);
  }

  // 持续调度
  while (true) {
    const now = new Date();
    const next = new Date(now);
    next.setHours(GRAB_HOUR, 0, 0, 0);
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }

    const waitMs = next - now;
    const waitHours = (waitMs / 3600000).toFixed(1);
    console.log(`[scheduler] 下次抓取: ${next.toLocaleString()}, 等待 ${waitHours}h`);

    await sleep(waitMs);

    const date = getDateString();
    console.log(`[scheduler] 开始定时抓取: ${date}`);
    try {
      await grabBanner(date);
    } catch (error) {
      console.error(`[scheduler] 抓取失败: ${error.message}`);
    }
  }
}

// ========== 入口 ==========
if (isScheduleMode) {
  scheduleMode().catch(err => {
    console.error('[scheduler] 致命错误:', err);
    process.exit(1);
  });
} else {
  // 单次模式
  const bannerName = args.find(a => !a.startsWith('--')) || getDateString();
  console.log(`正在下载资源中... (名称: ${bannerName})`);
  grabBanner(bannerName).then(success => {
    if (!success) process.exit(1);
  }).catch(err => {
    console.error('抓取失败:', err);
    process.exit(1);
  });
}

function sleep(timeout) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, timeout);
  });
}
