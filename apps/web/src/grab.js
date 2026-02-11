/*
 * @Author: ShawnPhang
 * @Description: 网页抓取 - 支持单次运行和定时调度模式
 *
 * 用法:
 *   node src/grab.js              # 单次运行，使用日期作为名称
 *   node src/grab.js myname       # 单次运行，使用 myname 作为名称
 *   node src/grab.js --schedule   # 定时模式，每天自动抓取一次
 */
import { launch } from "puppeteer";
import { existsSync, readdirSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join, resolve as _resolve, dirname } from "path";
import { createHash } from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 解析命令行参数
const args = process.argv.slice(2);
const isScheduleMode = args.includes('--schedule');

// 每天抓取的时间（小时），默认早上 6 点
const GRAB_HOUR = parseInt(process.env.GRAB_HOUR || '6', 10);

// 获取今天的日期字符串
function getDateString() {
  const today = new Date();
  const year = today.getFullYear();
  const month = ("0" + (today.getMonth() + 1)).slice(-2);
  const day = ("0" + today.getDate()).slice(-2);
  return year + "-" + month + "-" + day;
}

const assetsPath = _resolve(__dirname, "../assets");

// 生成文件 hash
function generateHash(data) {
  return createHash('md5').update(data).digest('hex');
}

// 加载已有的 manifest 文件用于对比
function loadExistingManifests() {
  const manifests = [];
  if (!existsSync(assetsPath)) return manifests;

  const folders = readdirSync(assetsPath, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const folder of folders) {
    const manifestPath = join(assetsPath, folder, 'manifest.json');
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        manifests.push(manifest);
      } catch (e) {
        // 忽略无效的 manifest
      }
    }
  }
  return manifests;
}

// 检查是否与已有数据重复
function isDuplicate(newHashes, existingManifests) {
  for (const manifest of existingManifests) {
    if (!manifest.hashes || manifest.hashes.length !== newHashes.length) continue;

    // 比较所有 hash 是否相同
    const existingSet = new Set(manifest.hashes);
    const allMatch = newHashes.every(h => existingSet.has(h));
    if (allMatch) {
      return manifest;
    }
  }
  return null;
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
  const fileHashes = [];

  const existingManifests = loadExistingManifests();
  console.log(`已加载 ${existingManifests.length} 个已有 banner manifest`);

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
    const hash = generateHash(fileData);
    fileHashes.push(hash);

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

    // 检查是否与已有 banner 重复（在写入磁盘前检查）
    const duplicateManifest = isDuplicate(fileHashes, existingManifests);
    if (duplicateManifest) {
      console.log(`⚠️  检测到重复 banner! 与 ${duplicateManifest.date} (${duplicateManifest.name}) 相同`);
      await browser.close();
      console.log('✅ 跳过重复 banner，未写入任何文件');
      return true; // 重复不算失败
    }

    console.log('✅ 检测通过，banner 不重复');

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

    // 确认不重复后，创建文件夹并写入磁盘
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

    // 写入 manifest.json (包含 hash 信息)
    const manifest = {
      name: bannerName,
      date: date,
      createdAt: new Date().toISOString(),
      fileCount: data.length,
      hashes: fileHashes
    };
    writeFileSync(join(folderPath, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log('✅ manifest.json 已生成');

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
  console.log(`[scheduler] 定时模式启动，每天 ${GRAB_HOUR}:00 抓取 banner`);

  // 启动时先执行一次
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
