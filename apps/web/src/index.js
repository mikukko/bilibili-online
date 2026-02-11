// Banner 动画和视频列表

// ========== Banner 逻辑 ==========
let allImagesData = [];
let layers = [];

// 动态加载最新的 banner 数据
async function loadLatestBanner() {
  try {
    // 获取 assets 目录列表
    const response = await fetch('./assets/');
    let html = await response.text();

    // serve 会将 / 编码为 &#47;，先解码 HTML 实体
    html = html.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code));

    // 解析目录中的文件夹名（日期格式：YYYY-MM-DD）
    const folderPattern = /href="[^"]*\/([0-9]{4}-[0-9]{2}-[0-9]{2})\/"/g;
    const folders = [];
    let match;
    while ((match = folderPattern.exec(html)) !== null) {
      folders.push(match[1]);
    }

    if (folders.length === 0) {
      console.warn('没有找到 banner 文件夹');
      return null;
    }

    // 按日期排序，取最新的
    folders.sort((a, b) => b.localeCompare(a));
    const latestFolder = folders[0];

    // 加载最新 banner 的 data.json
    const dataResponse = await fetch(`./assets/${latestFolder}/data.json`);
    if (!dataResponse.ok) throw new Error('无法加载 banner 数据');

    const bannerData = await dataResponse.json();
    console.log(`已加载最新 banner: ${latestFolder}`);
    return bannerData;
  } catch (error) {
    console.error('加载 banner 失败:', error);
    return null;
  }
}

async function initBanner() {
  const bannerData = await loadLatestBanner();
  if (!bannerData || bannerData.length === 0) {
    console.warn('没有可用的 banner 数据');
    return;
  }

  allImagesData = bannerData;
  initBannerItems();
  bindBannerEvents();
}

function initBannerItems() {
  const app = document.querySelector("#app");
  if (!app) return;

  // 保留 logo 等固定元素，只移除 .layer 元素
  const existingLayers = app.querySelectorAll('.layer');
  existingLayers.forEach(layer => layer.remove());

  allImagesData.forEach((item, index) => {
    const layer = document.createElement("div");
    layer.classList.add("layer");

    const isVideo = item.tagName === 'video';

    // transform 数组格式: [scaleX, skewX, skewY, scaleY, translateX, translateY]
    const transform = item.transform || [1, 0, 0, 1, 0, 0];
    const scaleX = transform[0] || 1;
    const skewX = transform[1] || 0;
    const skewY = transform[2] || 0;
    const scaleY = transform[3] || 1;
    const translateX = transform[4] || 0;
    const translateY = transform[5] || 0;

    if (isVideo) {
      const video = document.createElement("video");
      video.src = item.src;
      video.autoplay = true;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.style.width = item.width + "px";
      video.style.height = item.height + "px";
      layer.appendChild(video);
    } else {
      const img = document.createElement("img");
      img.src = item.src;
      img.style.width = item.width + "px";
      img.style.height = item.height + "px";
      layer.appendChild(img);
    }

    layer.style.transform = `matrix(${scaleX}, ${skewX}, ${skewY}, ${scaleY}, ${translateX}, ${translateY})`;
    layer.style.opacity = Array.isArray(item.opacity) ? item.opacity[0] : (item.opacity || 1);
    layer.style.zIndex = index;

    // 存储原始值和视差系数
    layer.dataset.scaleX = scaleX;
    layer.dataset.skewX = skewX;
    layer.dataset.skewY = skewY;
    layer.dataset.scaleY = scaleY;
    layer.dataset.translateX = translateX;
    layer.dataset.translateY = translateY;
    layer.dataset.a = item.a || 0; // 视差系数

    app.appendChild(layer);
  });

  layers = document.querySelectorAll(".layer");
}

function bindBannerEvents() {
  const app = document.querySelector("#app");
  if (!app) return;

  app.addEventListener("mousemove", (e) => {
    const rect = app.getBoundingClientRect();
    const centerX = rect.width / 2;
    const mouseX = e.clientX - rect.left;
    const offsetX = (mouseX - centerX);

    // 动态查询 layers，避免初始化时机问题
    const currentLayers = document.querySelectorAll("#app .layer");

    currentLayers.forEach((layer) => {
      const scaleX = parseFloat(layer.dataset.scaleX) || 1;
      const skewX = parseFloat(layer.dataset.skewX) || 0;
      const skewY = parseFloat(layer.dataset.skewY) || 0;
      const scaleY = parseFloat(layer.dataset.scaleY) || 1;
      const baseX = parseFloat(layer.dataset.translateX) || 0;
      const baseY = parseFloat(layer.dataset.translateY) || 0;
      const parallaxA = parseFloat(layer.dataset.a) || 0; // 视差系数

      // 使用数据中的 a 值作为视差强度
      const newX = baseX + offsetX * parallaxA;

      layer.style.transform = `matrix(${scaleX}, ${skewX}, ${skewY}, ${scaleY}, ${newX}, ${baseY})`;
    });
  });

  app.addEventListener("mouseleave", () => {
    const currentLayers = document.querySelectorAll("#app .layer");

    currentLayers.forEach((layer) => {
      const scaleX = parseFloat(layer.dataset.scaleX) || 1;
      const skewX = parseFloat(layer.dataset.skewX) || 0;
      const skewY = parseFloat(layer.dataset.skewY) || 0;
      const scaleY = parseFloat(layer.dataset.scaleY) || 1;
      const baseX = parseFloat(layer.dataset.translateX) || 0;
      const baseY = parseFloat(layer.dataset.translateY) || 0;
      layer.style.transform = `matrix(${scaleX}, ${skewX}, ${skewY}, ${scaleY}, ${baseX}, ${baseY})`;
    });
  });
}

// ========== 视频列表逻辑 ==========
let videoData = [];
let currentSort = 'count';
let searchQuery = '';
const videoContainer = document.getElementById('video-container');

async function loadVideoData() {
  try {
    const response = await fetch('data/data.json');
    if (!response.ok) throw new Error('数据加载失败');
    const data = await response.json();
    videoData = data.items || [];

    // 更新时间
    const updateTimeEl = document.getElementById('update-time');
    if (updateTimeEl && data.updated_at) {
      updateTimeEl.textContent = `数据更新时间: ${data.updated_at}`;
    }

    renderVideoGrid();
  } catch (error) {
    console.error('加载视频数据失败:', error);
    const container = document.getElementById('video-container');
    if (container) {
      container.innerHTML = '<div class="error">数据加载失败，请刷新重试</div>';
    }
  }
}

function formatNumber(num) {
  if (num >= 10000) {
    return (num / 10000).toFixed(1) + '万';
  }
  return num.toString();
}

function renderVideoGrid() {
  const container = document.getElementById('video-container');
  if (!container) return;

  // 过滤
  let filtered = videoData.filter(item => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return item.title.toLowerCase().includes(query) ||
      item.owner.name.toLowerCase().includes(query);
  });

  // 排序
  filtered.sort((a, b) => {
    switch (currentSort) {
      case 'count':
        return b.online_count - a.online_count;
      case 'view':
        return b.view - a.view;
      case 'danmu':
        return b.danmaku - a.danmaku;
      case 'title':
        return a.title.localeCompare(b.title, 'zh');
      default:
        return 0;
    }
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div class="no-results">没有找到匹配的视频</div>';
    return;
  }

  container.innerHTML = filtered.map((item, index) => {
    const rank = index + 1;
    const rankClass = rank <= 3 ? `rank-${rank}` : '';

    return `
      <div class="video-card" onclick="window.open('https://www.bilibili.com/video/${item.bvid}', '_blank')">
        <div class="video-thumbnail">
          <div class="rank-badge ${rankClass}">${rank}</div>
          <img src="${item.pic}@320w_200h_1c_!web-space-index-myvideo.avif" 
               alt="${item.title}" 
               referrerpolicy="no-referrer"
               onerror="this.src='${item.pic}'">
        </div>
        <div class="video-info">
          <a class="video-title" href="https://www.bilibili.com/video/${item.bvid}" 
             target="_blank" title="${item.title}" rel="noopener">${item.title}</a>
          <div class="video-meta">
            <span class="play"><svg class="svg-icon-next play" style="width: 16px; height: 16px; margin-right: 4px;" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 16 16" width="16" height="16"><path d="M8 3.3320333333333334C6.321186666666667 3.3320333333333334 4.855333333333333 3.4174399999999996 3.820593333333333 3.5013466666666666C3.1014733333333333 3.5596599999999996 2.5440733333333334 4.109013333333333 2.48 4.821693333333333C2.4040466666666664 5.666533333333334 2.333333333333333 6.780666666666666 2.333333333333333 7.998666666666666C2.333333333333333 9.216733333333334 2.4040466666666664 10.330866666666665 2.48 11.175699999999999C2.5440733333333334 11.888366666666666 3.1014733333333333 12.437733333333334 3.820593333333333 12.496066666666666C4.855333333333333 12.579933333333333 6.321186666666667 12.665333333333333 8 12.665333333333333C9.678999999999998 12.665333333333333 11.144933333333334 12.579933333333333 12.179733333333333 12.496033333333333C12.898733333333332 12.4377 13.456 11.888533333333331 13.520066666666667 11.176033333333333C13.595999999999998 10.331533333333333 13.666666666666666 9.217633333333332 13.666666666666666 7.998666666666666C13.666666666666666 6.779766666666667 13.595999999999998 5.665846666666667 13.520066666666667 4.821366666666666C13.456 4.108866666666666 12.898733333333332 3.55968 12.179733333333333 3.5013666666666663C11.144933333333334 3.417453333333333 9.678999999999998 3.3320333333333334 8 3.3320333333333334zM3.7397666666666667 2.50462C4.794879999999999 2.41906 6.288386666666666 2.3320333333333334 8 2.3320333333333334C9.7118 2.3320333333333334 11.2054 2.4190733333333334 12.260533333333331 2.5046399999999998C13.458733333333331 2.6018133333333333 14.407866666666665 3.5285199999999994 14.516066666666667 4.73182C14.593933333333332 5.597933333333334 14.666666666666666 6.7427 14.666666666666666 7.998666666666666C14.666666666666666 9.2547 14.593933333333332 10.399466666666665 14.516066666666667 11.2656C14.407866666666665 12.468866666666665 13.458733333333331 13.395566666666667 12.260533333333331 13.492766666666665C11.2054 13.578333333333333 9.7118 13.665333333333333 8 13.665333333333333C6.288386666666666 13.665333333333333 4.794879999999999 13.578333333333333 3.7397666666666667 13.492799999999999C2.541373333333333 13.395599999999998 1.5922066666666668 12.468633333333333 1.4840200000000001 11.265266666666665C1.4061199999999998 10.3988 1.3333333333333333 9.253866666666667 1.3333333333333333 7.998666666666666C1.3333333333333333 6.743533333333333 1.4061199999999998 5.598579999999999 1.4840200000000001 4.732153333333333C1.5922066666666668 3.5287466666666667 2.541373333333333 2.601793333333333 3.7397666666666667 2.50462z" fill="currentColor"></path><path d="M9.8092 7.3125C10.338433333333333 7.618066666666666 10.338433333333333 8.382 9.809166666666666 8.687533333333333L7.690799999999999 9.910599999999999C7.161566666666666 10.216133333333332 6.5 9.8342 6.500006666666666 9.223066666666666L6.500006666666666 6.776999999999999C6.500006666666666 6.165873333333334 7.161566666666666 5.783913333333333 7.690799999999999 6.089479999999999L9.8092 7.3125z" fill="currentColor"></path></svg><span>${formatNumber(item.view)}</span></span>
            <span class="dm"><svg class="svg-icon-next dm" style="width: 16px; height: 16px; margin-right: 4px;" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 16 16" width="16" height="16"><path d="M8 3.3320333333333334C6.321186666666667 3.3320333333333334 4.855333333333333 3.4174399999999996 3.820593333333333 3.5013466666666666C3.1014733333333333 3.5596599999999996 2.5440733333333334 4.109013333333333 2.48 4.821693333333333C2.4040466666666664 5.666533333333334 2.333333333333333 6.780666666666666 2.333333333333333 7.998666666666666C2.333333333333333 9.216733333333334 2.4040466666666664 10.330866666666665 2.48 11.175699999999999C2.5440733333333334 11.888366666666666 3.1014733333333333 12.437733333333334 3.820593333333333 12.496066666666666C4.855333333333333 12.579933333333333 6.321186666666667 12.665333333333333 8 12.665333333333333C9.678999999999998 12.665333333333333 11.144933333333334 12.579933333333333 12.179733333333333 12.496033333333333C12.898733333333332 12.4377 13.456 11.888533333333331 13.520066666666667 11.176033333333333C13.595999999999998 10.331533333333333 13.666666666666666 9.217633333333332 13.666666666666666 7.998666666666666C13.666666666666666 6.779766666666667 13.595999999999998 5.665846666666667 13.520066666666667 4.821366666666666C13.456 4.108866666666666 12.898733333333332 3.55968 12.179733333333333 3.5013666666666663C11.144933333333334 3.417453333333333 9.678999999999998 3.3320333333333334 8 3.3320333333333334zM3.7397666666666667 2.50462C4.794879999999999 2.41906 6.288386666666666 2.3320333333333334 8 2.3320333333333334C9.7118 2.3320333333333334 11.2054 2.4190733333333334 12.260533333333331 2.5046399999999998C13.458733333333331 2.6018133333333333 14.407866666666665 3.5285199999999994 14.516066666666667 4.73182C14.593933333333332 5.597933333333334 14.666666666666666 6.7427 14.666666666666666 7.998666666666666C14.666666666666666 9.2547 14.593933333333332 10.399466666666665 14.516066666666667 11.2656C14.407866666666665 12.468866666666665 13.458733333333331 13.395566666666667 12.260533333333331 13.492766666666665C11.2054 13.578333333333333 9.7118 13.665333333333333 8 13.665333333333333C6.288386666666666 13.665333333333333 4.794879999999999 13.578333333333333 3.7397666666666667 13.492799999999999C2.541373333333333 13.395599999999998 1.5922066666666668 12.468633333333333 1.4840200000000001 11.265266666666665C1.4061199999999998 10.3988 1.3333333333333333 9.253866666666667 1.3333333333333333 7.998666666666666C1.3333333333333333 6.743533333333333 1.4061199999999998 5.598579999999999 1.4840200000000001 4.732153333333333C1.5922066666666668 3.5287466666666667 2.541373333333333 2.601793333333333 3.7397666666666667 2.50462z" fill="currentColor"></path><path d="M10.583333333333332 7.166666666666666L6.583333333333333 7.166666666666666C6.307193333333332 7.166666666666666 6.083333333333333 6.942799999999999 6.083333333333333 6.666666666666666C6.083333333333333 6.390526666666666 6.307193333333332 6.166666666666666 6.583333333333333 6.166666666666666L10.583333333333332 6.166666666666666C10.859466666666666 6.166666666666666 11.083333333333332 6.390526666666666 11.083333333333332 6.666666666666666C11.083333333333332 6.942799999999999 10.859466666666666 7.166666666666666 10.583333333333332 7.166666666666666z" fill="currentColor"></path><path d="M11.583333333333332 9.833333333333332L7.583333333333333 9.833333333333332C7.3072 9.833333333333332 7.083333333333333 9.609466666666666 7.083333333333333 9.333333333333332C7.083333333333333 9.0572 7.3072 8.833333333333332 7.583333333333333 8.833333333333332L11.583333333333332 8.833333333333332C11.859466666666666 8.833333333333332 12.083333333333332 9.0572 12.083333333333332 9.333333333333332C12.083333333333332 9.609466666666666 11.859466666666666 9.833333333333332 11.583333333333332 9.833333333333332z" fill="currentColor"></path><path d="M5.25 6.666666666666666C5.25 6.942799999999999 5.02614 7.166666666666666 4.75 7.166666666666666L4.416666666666666 7.166666666666666C4.140526666666666 7.166666666666666 3.9166666666666665 6.942799999999999 3.9166666666666665 6.666666666666666C3.9166666666666665 6.390526666666666 4.140526666666666 6.166666666666666 4.416666666666666 6.166666666666666L4.75 6.166666666666666C5.02614 6.166666666666666 5.25 6.390526666666666 5.25 6.666666666666666z" fill="currentColor"></path><path d="M6.25 9.333333333333332C6.25 9.609466666666666 6.02614 9.833333333333332 5.75 9.833333333333332L5.416666666666666 9.833333333333332C5.140526666666666 9.833333333333332 4.916666666666666 9.609466666666666 4.916666666666666 9.333333333333332C4.916666666666666 9.0572 5.140526666666666 8.833333333333332 5.416666666666666 8.833333333333332L5.75 8.833333333333332C6.02614 8.833333333333332 6.25 9.0572 6.25 9.333333333333332z" fill="currentColor"></path></svg><span>${formatNumber(item.danmaku)}</span></span>
          </div>
          <a class="video-owner" href="https://space.bilibili.com/${item.owner.mid}" target="_blank" style="text-decoration: none;display: inline-block; margin-top: 6px">
                                    ${item.owner.name}
                                </a>
          <div class="online-count"><b style="font-size: 14px;p:hover {color: red}">${item.online_total}</b>人在看</div>
          
        </div>
      </div>
    `;
  }).join('');
}



function initControls() {
  // 排序按钮
  const sortBtns = document.querySelectorAll('.sort-btn');
  sortBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      sortBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentSort = btn.dataset.sort;
      renderVideoGrid();
    });
  });

  // 搜索框
  const searchBox = document.querySelector('.search-box');
  if (searchBox) {
    let debounceTimer;
    searchBox.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        searchQuery = e.target.value;
        renderVideoGrid();
      }, 300);
    });
  }
}

// ========== 初始化 ==========
function init() {
  initBanner();
  initControls();
  loadVideoData();
}

// 等待 DOM 加载完成
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}