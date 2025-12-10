import './style.css'
import Stats from 'three/examples/jsm/libs/stats.module.js'
import * as THREE from 'three'
import { addLight } from './addLight'
import Model from './model'
import { InteractionManager } from 'three.interactive'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import gsap from 'gsap'
import * as d3 from 'd3'

// =========================================================
// 1. 全局配置与变量
// =========================================================

const raycaster = new THREE.Raycaster()
const mouse = new THREE.Vector2()
const clock = new THREE.Clock()
const meshes = {}
const mixers = []

// 模型实例
let MABuildings = null
let activeHoverBuilding = null 

// 视角平移限制 (配合入场动画的终点)
const PAN_LIMITS = {
  minX: -2.5, 
  maxX: 2.5,  
  minZ: -1, 
  maxZ: 1   
}

// 月份 Slugs (对应 CSV 文件名)
const monthSlugs = [
    'october-2024', 'november-2024', 'december-2024',
    'january-2025', 'february-2025', 'march-2025',
    'april-2025', 'may-2025', 'june-2025',
    'july-2025', 'august-2025', 'september-2025', 'october-2025'
];

// =========================================================
// 2. 场景、相机与渲染器
// =========================================================

const scene = new THREE.Scene()
scene.background = new THREE.Color(0xffffff)

const renderer = new THREE.WebGLRenderer({ 
  antialias: true,            
  powerPreference: "high-performance" 
})
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.2

// 挂载到 DOM
const holder = document.getElementById('threeJsHolder')
if (holder) {
    holder.appendChild(renderer.domElement)
} else {
    document.body.appendChild(renderer.domElement)
}

const camera = new THREE.PerspectiveCamera(9, window.innerWidth / window.innerHeight, 0.1, 1000)

// 性能监测与 Tooltip
const stats = new Stats()
document.body.appendChild(stats.dom)

const tooltip = document.createElement('div')
tooltip.className = 'building-tooltip'
tooltip.style.position = 'fixed'
tooltip.style.pointerEvents = 'none'
tooltip.style.display = 'none'

// 【🌟 核心修复】确保 tooltip 永远在最上层
tooltip.style.zIndex = '9999' 

// 【可选】顺便加点基础样式，防止背景透明看不清
tooltip.style.backgroundColor = 'rgba(255, 255, 255, 0.95)'
tooltip.style.padding = '8px 12px'
tooltip.style.borderRadius = '8px'
tooltip.style.border = '1px solid #eee'
tooltip.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)'
tooltip.style.fontFamily = 'Inter, sans-serif'
tooltip.style.fontSize = '12px'

document.body.appendChild(tooltip)

const interactionManager = new InteractionManager(renderer, camera, renderer.domElement)

// =========================================================
// 3. 控制器 OrbitControls
// =========================================================

const controls = new OrbitControls(camera, renderer.domElement)

// 初始配置 (入场动画期间禁用)
controls.enabled = false;     
controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.enableRotate = false; 
controls.enableZoom = false;
controls.enablePan = true;

controls.mouseButtons = {
  LEFT: THREE.MOUSE.PAN,
  MIDDLE: THREE.MOUSE.PAN,
  RIGHT: THREE.MOUSE.PAN,
}

// =========================================================
// 4. UI 逻辑 (时间选择器)
// =========================================================

const timeSelect = document.getElementById('timeSelect');
const optionsList = document.getElementById('optionsList');

if (timeSelect && optionsList) {
    // 点击切换下拉菜单
    timeSelect.addEventListener('click', (e) => {
      e.stopPropagation();
      timeSelect.classList.toggle('open');
    });

    // 点击外部关闭
    document.addEventListener('click', () => {
      timeSelect.classList.remove('open');
    });

    // 初始化加载月份
    loadAvailableMonths();
}

async function loadAvailableMonths() {
    const optionsList = document.getElementById('optionsList');
    if (!optionsList) return;
    
    // 转换函数：将 october-2024 转换为 October 2024
    const formatSlug = (slug) => {
        return slug.split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    };

    // 倒序排列，让最新的月份排在前面
    const reversedSlugs = [...monthSlugs].reverse();

    reversedSlugs.forEach(slug => {
        const opt = document.createElement('div');
        opt.className = 'option';
        opt.textContent = formatSlug(slug);
        opt.dataset.value = slug; 
        optionsList.appendChild(opt);
    });

    bindOptionClicks();
}

function bindOptionClicks() {
    const timeSelect = document.getElementById('timeSelect');
    const currentValueText = timeSelect ? timeSelect.querySelector('.current-value') : null;
    const allOptions = document.querySelectorAll('.option');

    if (!currentValueText) return;

    allOptions.forEach(opt => {
        opt.addEventListener('click', () => {
            allOptions.forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
            
            // 更新 UI 显示
            currentValueText.textContent = opt.textContent;
            
            // 触发数据更新
            const selectedValue = opt.dataset.value;
            updateModelByTimeRange(selectedValue);
        });
    });
}

// =========================================================
// 5. 数据处理逻辑 (CSV/JSON)
// =========================================================

async function updateModelByTimeRange(value) {
  console.log(`正在切换时间范围: ${value}...`);

  // 更新图表标题上的文字
  const chartLabel = document.getElementById('chart-time-label');
  if (chartLabel) {
      if (value === '12') chartLabel.innerText = '(past 12 months)';
      else if (value === '6') chartLabel.innerText = '(past 6 months)';
      else if (value === '3') chartLabel.innerText = '(past 3 months)';
      else chartLabel.innerText = `(${value})`;
  }

  // 即使是 '12'，我们也去 fetch CSV，因为我们需要 Time 数据画图表
  // Summary JSON 里没有时间数据
  let targetSlugs = [];

  if (value === '12') {
    targetSlugs = monthSlugs.slice(0, 12); // 取最近12个月
  } else if (value === '3') {
    targetSlugs = monthSlugs.slice(0, 3);
  } else if (value === '6') {
    targetSlugs = monthSlugs.slice(0, 6);
  } else {
    targetSlugs = [value];
  }

  // 统一走 CSV 计算流程
  await fetchAndCalcCsvData(targetSlugs);
}

// 核心计算函数
// =========================================================
// 修改后的 fetchAndCalcCsvData：同时统计地点和时间
// =========================================================

// main.js - 替换原有的 fetchAndCalcCsvData 函数

async function fetchAndCalcCsvData(slugs) {
  // 1. 获取建筑映射表
  const mapping = await getBuildingMapping();
  if (!mapping) return;

  // 2. 初始化统计容器
  const countByGlb = {};          // 地点统计 (用于 3D 地图 和 Hotspot Chart)
  const timeBins = [0, 0, 0, 0];  // 时间统计 (用于 Time Chart)
  const countByType = {};         // 类型统计 (用于 Pie Chart 和 Top Crime Stat)

  // 3. 并行获取所有选中的 CSV 文件
  const promises = slugs.map(slug => fetch(`/crime-data/crime-log-${slug}.csv`));
  const responses = await Promise.all(promises);

  // 4. 循环处理每个文件
  for (const res of responses) {
    if (!res.ok) continue; 
    const text = await res.text();
    const rows = parseCSV(text);

    rows.forEach(row => {
      // --- A. 统计地点 ---
      const rawBuilding = row.col5; 
      const rawArea = row.col6;
      if (rawBuilding) {
        const b = rawBuilding.trim().toUpperCase();
        const a = (rawArea || '').trim().toUpperCase();
        const keyBA = `${b}||${a}`;
        
        // 尝试匹配 mapping
        let match = mapping.mappingByBA.get(keyBA);
        if (!match) match = mapping.mappingByB.get(b);
        
        // 如果匹配成功且标记为 include
        if (match && match.include?.toLowerCase() === 'yes' && match.glb_name) {
          const name = match.glb_name;
          countByGlb[name] = (countByGlb[name] || 0) + 1;
        }
      }

      // --- B. 统计时间 ---
      const rawTime = row.col2 || row.col3; 
      const binIndex = parseTimeBin(rawTime);
      if (binIndex !== -1) timeBins[binIndex]++;

      // --- C. 统计犯罪类型 (需归一化) ---
      let rawType = row.col4; 
      if (rawType) {
        const cleanType = normalizeCrimeType(rawType); // 确保你有这个函数
        if (cleanType) {
          countByType[cleanType] = (countByType[cleanType] || 0) + 1;
        }
      }
    }); 
  }

  // ============================================
  // 5. 更新 3D 模型 (MABuildings)
  // ============================================
  if (typeof MABuildings !== 'undefined' && MABuildings.resetAllCounts) {
      MABuildings.resetAllCounts();
      
      const counts = Object.values(countByGlb);
      let min = 0, max = 0;
      if (counts.length > 0) {
        min = Math.min(...counts);
        max = Math.max(...counts);
      }
      
      MABuildings.setCrimeScale({ min, max });
      
      for (const [name, count] of Object.entries(countByGlb)) {
        MABuildings.setCrimeCountByName(name, count);
      }
      MABuildings.updateAllBuildingColors();
  }

  // ============================================
  // 6. 更新 HTML 统计数字 (Stat Blocks)
  // ============================================

  // --- A. 总数 (Total Incidents) ---
  const totalCrimes = Object.values(countByGlb).reduce((a, b) => a + b, 0);
  const totalDiv = document.getElementById('stat-total-count');
  if (totalDiv) totalDiv.innerText = totalCrimes;

  // --- B. 准备地点数据 (排序: 多 -> 少) ---
  const hotspotData = Object.entries(countByGlb).map(([name, count]) => ({
    name: name,
    count: count
  }));
  hotspotData.sort((a, b) => b.count - a.count);

  // --- 更新 UI: 最高发地点 ---
  const topLocDiv = document.getElementById('stat-top-location');
  if (topLocDiv) {
    if (hotspotData.length > 0) {
      // 简单美化：把下划线换成空格，例如 "OTHMER_HALL" -> "OTHMER HALL"
      const displayName = hotspotData[0].name.replace(/_/g, ' '); 
      topLocDiv.innerText = displayName;
    } else {
      topLocDiv.innerText = "N/A";
    }
  }

  // --- C. 准备类型数据 (排序: 多 -> 少) ---
  const sortedTypes = Object.entries(countByType)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  // --- 更新 UI: 最高发犯罪类型 ---
  const topCrimeDiv = document.getElementById('stat-top-crime');
  if (topCrimeDiv) {
    if (sortedTypes.length > 0) {
      topCrimeDiv.innerText = sortedTypes[0].label;
    } else {
      topCrimeDiv.innerText = "N/A";
    }
  }

  // ============================================
  // 7. 绘制三个图表
  // ============================================

  // Chart 1: Time of Day
  if (typeof drawTimeOfDayChart === 'function') {
    drawTimeOfDayChart(timeBins);
  }

  // Chart 2: Top Locations (Hotspots)
  // 使用上面排好序的 hotspotData
  if (typeof drawTopCrimeHotspotsChart === 'function') {
    drawTopCrimeHotspotsChart(hotspotData);
  }

  // Chart 3: Crime Types Pie Chart (Top 5 + Other)
  // 取前5名
  const top5 = sortedTypes.slice(0, 5);
  // 计算剩余的 Other
  const otherCount = sortedTypes.slice(5).reduce((sum, item) => sum + item.value, 0);
  
  if (otherCount > 0) {
    top5.push({ label: 'Other', value: otherCount });
  }

  // 调用之前修改好的 D3 Pie Chart 函数
  if (typeof drawCrimeTypePieChart === 'function') {
    // 稍微加个延时，确保 React/DOM 容器已经准备好宽度 (可选，防止宽度为0的报错)
    setTimeout(() => {
        drawCrimeTypePieChart(top5);
    }, 50);
  }
}
// 辅助函数：将时间字符串解析为 0-3 的桶
function parseTimeBin(timeStr) {
  if (!timeStr) return -1;
  
  // 尝试匹配小时 (支持 14:00 或 2:00 PM 格式)
  // 简单的正则找 "数字:数字"
  const match = timeStr.match(/(\d{1,2}):(\d{2})\s?(AM|PM)?/i);
  if (!match) return -1;

  let hour = parseInt(match[1]);
  const ampm = match[3] ? match[3].toUpperCase() : null;

  // 转换为 24小时制
  if (ampm === 'PM' && hour < 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;

  // 归类
  // 0: 00:00 - 05:59 (Night)
  // 1: 06:00 - 11:59 (Morning)
  // 2: 12:00 - 17:59 (Afternoon)
  // 3: 18:00 - 23:59 (Evening)
  if (hour >= 0 && hour < 6) return 0;
  if (hour >= 6 && hour < 12) return 1;
  if (hour >= 12 && hour < 18) return 2;
  return 3; 
}
// --- 辅助工具函数 ---

function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 1) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const result = [];
  for (let i = 1; i < lines.length; i++) {
    const rowData = [];
    let current = '';
    let inQuote = false;
    for (let char of lines[i]) {
      if (char === '"') { inQuote = !inQuote; continue; }
      if (char === ',' && !inQuote) {
        rowData.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    rowData.push(current.trim());
    const obj = {};
    headers.forEach((h, index) => { obj[h] = rowData[index] || ''; });
    result.push(obj);
  }
  return result;
}

let matchMappingCache = null;
async function getBuildingMapping() {
  if (matchMappingCache) return matchMappingCache;
  try {
    const res = await fetch('/crime-data/MABuildingMatch.csv');
    const text = await res.text();
    const rows = parseCSV(text);
    const mappingByBA = new Map();
    const mappingByB = new Map();
    rows.forEach(row => {
      const b = (row.raw_building || '').trim().toUpperCase();
      const a = (row.raw_area || '').trim().toUpperCase();
      if (!b) return;
      const keyBA = `${b}||${a}`;
      mappingByBA.set(keyBA, row);
      if (!mappingByB.has(b)) mappingByB.set(b, row);
    });
    matchMappingCache = { mappingByBA, mappingByB };
    return matchMappingCache;
  } catch (err) {
    console.error('无法加载建筑匹配表:', err);
    return null;
  }
}

// =========================================================
// 6. 初始化逻辑
// =========================================================

init()

// 🌟 修改：初始化时直接加载 "12" (这会触发 fetchAndCalcCsvData)
function init() {
  scene.add(addLight())
  addGround()
  loadModel() 
  animate()
  updateModelByTimeRange('12');
  
  // 🌟 重点：初始化图表和数据
  // 延时一点点确保 mapping 表加载完
  // setTimeout(() => {
  //   updateModelByTimeRange('12');
  // }, 500);
}

function addGround() {
  const groundGeometry = new THREE.PlaneGeometry(50, 50)
  const groundMaterial = new THREE.MeshStandardMaterial({
    color: 0xe0e0e0,
    roughness: 1.0,
    metalness: 0.0,
  })
  const ground = new THREE.Mesh(groundGeometry, groundMaterial)
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.002
  ground.receiveShadow = true
  scene.add(ground)
}

function loadModel() {
  MABuildings = new Model({
    url: '/NYUBuildingMA.glb',
    name: 'MABuildings',
    scene: scene,
    meshes: meshes,
    scale: new THREE.Vector3(0.2, 0.2, 0.2),
    position: new THREE.Vector3(0, 0, 0),
    replace: true,
    enableBuildingMode: true,
    crimeScale: { min: 0, max: 100 },
    colorLow: '#EBD7FF',
    colorHigh: '#4A148C',
    callback: () => {
      console.log('模型加载完成');
      applyCrimeDataToModel(MABuildings);
      startEntranceAnimation(); 
    },
  })
  MABuildings.init()
}

// 初始加载 Summary JSON (Past 12 Months)
async function applyCrimeDataToModel(model) {
  try {
    const res = await fetch('/crime-data/crime-summary-2024-2025.json')
    if (!res.ok) return
    const summary = await res.json()
    model.setCrimeScale({ min: summary.meta.minCount, max: summary.meta.maxCount })
    for (const [glbName, count] of Object.entries(summary.buildings)) {
      model.setCrimeCountByName(glbName, count)
    }
    model.updateAllBuildingColors()
  } catch (err) {
    console.error('应用数据出错:', err)
  }
}

// 绘制函数


// =========================================================
// 📊 D3 图表绘制逻辑 (完美复刻示范图轴线版)
// =========================================================

function drawTimeOfDayChart(dataBins) {
  const container = document.getElementById('d3-chart-wrapper');
  if (!container) return;
  container.innerHTML = ''; // 清空

  const width = container.clientWidth;
  const height = container.clientHeight;

  const margin = { top: 50, right: 190, bottom: 100, left: -10 };
  const chartLeftPadding = 60;
  const innerWidth = width - chartLeftPadding - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const svg = d3.select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height);



  // 数据
  const chartData = dataBins.map((count, i) => ({ index: i, count }));

  // X：柱子与边界
  const xBand = d3.scaleBand()
    .domain(chartData.map(d => d.index)) // [0,1,2,3]
    .range([0, innerWidth])
    .paddingInner(0)
    .paddingOuter(0);

  const xBoundary = d3.scaleLinear()
    .domain([0, 4])          // 0~4 共 5 条边界线
    .range([0, innerWidth]);

  // Y：给多一点空间
  const rawMax = d3.max(chartData, d => d.count) || 10;
  let yDomainMax;
  if (rawMax <= 50) {
    yDomainMax = Math.ceil(rawMax / 10) * 10 + 10;
  } else {
    const step = 100;
    yDomainMax = Math.ceil(rawMax / step) * step + step;
  }

  const y = d3.scaleLinear()
    .domain([0, yDomainMax])
    .range([innerHeight, 0]);

  const g = svg.append('g')
    .attr('transform', `translate(${chartLeftPadding},${margin.top})`);

  // ===== 1. 背景水平网格 =====
  const yTicks = y.ticks(6);
  g.selectAll('.grid-line-horizontal')
    .data(yTicks)
    .enter()
    .append('line')
    .attr('class', 'grid-line-horizontal')
    .attr('x1', 0)
    .attr('x2', innerWidth)
    .attr('y1', d => y(d))
    .attr('y2', d => y(d))
    .attr('stroke', '#1A002E')
    .attr('stroke-width', d => d === 0 ? 0 : 1);

  // ===== 2. 柱子（放在轴线下面绘制） =====
  g.selectAll('.bar')
    .data(chartData)
    .enter()
    .append('rect')
    .attr('class', 'bar')
    .attr('x', d => xBand(d.index))
    .attr('y', innerHeight)
    .attr('width', xBand.bandwidth())
    .attr('height', 0)
    .attr('fill', '#9B00FF')
    .attr('stroke', '#000000')
    .attr('stroke-width', 1)
    .transition()
    .duration(1000)
    .ease(d3.easeCubicOut)
    .attr('y', d => y(d.count))
    .attr('height', d => innerHeight - y(d.count));

  // ===== 3. 竖直边界线 =====
  const vLines = [0, 1, 2, 3, 4];
  g.selectAll('.grid-line-vertical')
    .data(vLines)
    .enter()
    .append('line')
    .attr('class', 'grid-line-vertical')
    .attr('x1', d => xBoundary(d))
    .attr('x2', d => xBoundary(d))
    .attr('y1', 0)
    .attr('y2', innerHeight)
    .attr('stroke', '#2A0050')
    .attr('stroke-width', 1);

  // ===== 4. 轴线 & 刻度（最后画，压在最上层） =====

  // 左侧白色 Y 轴主线
  g.append('line')
    .attr('x1', 0)
    .attr('x2', 0)
    .attr('y1', 0)
    .attr('y2', innerHeight)
    .attr('stroke', '#FFFFFF')
    .attr('stroke-width', 1);

  // Y 轴短刻度（去掉 0 刻度，避免左下角“出头”）
  g.selectAll('.y-tick-line')
    .data(yTicks.filter(d => d !== 0))
    .enter()
    .append('line')
    .attr('class', 'y-tick-line')
    .attr('x1', -6)
    .attr('x2', 0)
    .attr('y1', d => y(d))
    .attr('y2', d => y(d))
    .attr('stroke', '#FFFFFF')
    .attr('stroke-width', 1);

  // Y 轴数值
  g.selectAll('.y-tick-label')
    .data(yTicks)
    .enter()
    .append('text')
    .attr('class', 'y-tick-label')
    .attr('x', -10)
    .attr('y', d => y(d) + 4)
    .attr('text-anchor', 'end')
    .attr('fill', '#FFFFFF')
    .attr('font-family', 'NYUTypeMedium')
    .attr('font-size', '14px')
    .text(d => d);

  // 底部白色 X 轴主线
  g.append('line')
    .attr('x1', 0)
    .attr('x2', innerWidth)
    .attr('y1', innerHeight)
    .attr('y2', innerHeight)
    .attr('stroke', '#FFFFFF')
    .attr('stroke-width', 1);

  // X 轴短刻度（去掉 0 的刻度，防止在左下角竖线出头）
  g.selectAll('.x-tick-line')
    .data(vLines.filter(d => d !== 0))
    .enter()
    .append('line')
    .attr('class', 'x-tick-line')
    .attr('x1', d => xBoundary(d))
    .attr('x2', d => xBoundary(d))
    .attr('y1', innerHeight)
    .attr('y2', innerHeight + 6)
    .attr('stroke', '#FFFFFF')
    .attr('stroke-width', 1);

  // ===== 5. 顶部大数字 =====
  g.selectAll('.label-num')
    .data(chartData)
    .enter()
    .append('text')
    .attr('class', 'label-num')
    .text(d => d.count)
    .attr('x', d => xBand(d.index) + xBand.bandwidth() / 2)
    .attr('y', d => y(d.count) - 15)
    .attr('text-anchor', 'middle')
    .attr('fill', '#EBCCFE')
    .attr('font-family', 'NYUTypeBold')
    .attr('font-size', '40px')
    .attr('opacity', 0)
    .transition()
    .delay(300)
    .duration(800)
    .attr('opacity', 1);

  // ===== 6. X 轴时间标签 =====
  const timeLabels = [
    { text: '0:00',  sub: 'AM', value: 0 },
    { text: '6:00',  sub: 'AM', value: 1 },
    { text: '12:00', sub: 'AM', value: 2 },
    { text: '6:00',  sub: 'PM', value: 3 },
    { text: '11:59', sub: 'PM', value: 4 }
  ];

  const labelGroup = g.selectAll('.time-label-group')
    .data(timeLabels)
    .enter()
    .append('g')
    .attr('class', 'time-label-group')
    .attr('transform', d => `translate(${xBoundary(d.value)}, ${innerHeight + 35})`);

  labelGroup.append('text')
    .text(d => d.text)
    .attr('y', 10)
    .attr('fill', '#9B00FF')
    .attr('font-family', 'NYUTypeLight')
    .attr('font-size', '32px')
    .attr('text-anchor', 'middle');

  labelGroup.append('text')
    .text(d => d.sub)
    .attr('x', 40)
    .attr('y', 0)
    .attr('fill', '#9B00FF')
    .attr('font-family', 'NYUTypeMedium')
    .attr('font-size', '14px')
    .attr('text-anchor', 'start');

  // ===== 7. 辅助文字 =====

  // Monthly crime count：向左挪一点，与左侧对齐
  g.append('text')
    .text('Total incident count')
    .attr('x', -40)                 // 关键：负一点，让文字靠到左侧
    .attr('y', -25)
    .attr('fill', '#FFFFFF')
    .attr('font-family', 'NYUTypeRegular')
    .attr('font-size', '16px')
    .attr('text-anchor', 'start');

  // Time of the day：放在 x 轴末端之后
  g.append('text')
    .text('Time of Day')
    .attr('x', innerWidth + 10)     // 关键：比轴线再往右一点
    .attr('y', innerHeight + 4)     // 基线跟轴线差不多齐
    .attr('fill', '#FFFFFF')
    .attr('font-family', 'NYUTypeReguar')
    .attr('font-size', '16px')
    .attr('text-anchor', 'start');
}



function normalizeCrimeType(rawType) {
  if (!rawType) return null;
  
  // 1. 转大写，移除多余空格
  const type = rawType.toUpperCase().trim();

  // 2. 正则匹配规则 (优先级从上到下)
  
  // --- Larceny (偷窃类) ---
  // 包含: Larceny, Theft, Burglary, Robbery, Stolen
  if (/LARCENY|THEFT|BURGLARY|ROBBERY|STOLEN/i.test(type)) {
    return 'Larceny';
  }

  // --- Harassment (骚扰类) ---
  // 包含: Harassment, Stalking, Menacing
  if (/HARASSMENT|STALKING|MENACING/i.test(type)) {
    return 'Harassment';
  }

  // --- Controlled Substance (毒品/药物类) ---
  // 包含: Drug, Marijuana, Substance, CPCS (Criminal Possession of Controlled Substance)
  if (/DRUG|MARIJUANA|SUBSTANCE|CPCS/i.test(type)) {
    return 'Controlled Substance';
  }

  // --- Liquor (酒类违规) ---
  // 包含: Liquor, Alcohol
  if (/LIQUOR|ALCOHOL/i.test(type)) {
    return 'Liquor Law Violation';
  }

  // --- Criminal Mischief (恶意破坏) ---
  // 包含: Mischief, Graffiti, Vandalism
  if (/MISCHIEF|GRAFFITI|VANDALISM/i.test(type)) {
    return 'Criminal Mischief';
  }
  
  // --- Assault (袭击) ---
  // 包含: Assault, Rape, Sex
  if (/ASSAULT|RAPE|SEX/i.test(type)) {
    return 'Assault';
  }

  // --- Trespass (非法入侵) ---
  if (/TRESPASS/i.test(type)) {
    return 'Criminal Trespass';
  }

  // 如果以上都没匹配上，返回原始名称的首字母大写形式，或者直接归为 "Other"
  // 这里我们返回原始名，让后续的 Top 5 逻辑去决定它是不是 Other
  return type.split(' ').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
}



//2图
function drawTopCrimeHotspotsChart(data) {
  const container = document.getElementById('d3-chartTwo-wrapper');
  if (!container) return;
  container.innerHTML = ''; // 清空

  const width = container.clientWidth;
  const height = container.clientHeight;

  // 给左侧地点名留很宽的边距
  const margin = { top: 20, right: 200, bottom: 100, left: 250 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const svg = d3.select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height);


  const g = svg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  // 只保留前 10 个，按 count 降序
  const chartData = data
    .slice()
    .sort((a, b) => d3.descending(a.count, b.count))
    .slice(0, 10);

  // ===== 比例尺 =====
  const xMaxRaw = d3.max(chartData, d => d.count) || 1;
  // 设计图里最大是 6，这里做一个向上取整的“整数最大值”
  const xMax = Math.ceil(xMaxRaw);

  const x = d3.scaleLinear()
    .domain([0, xMax])
    .range([0, innerWidth]);

  const y = d3.scaleBand()
    .domain(chartData.map(d => d.name))
    .range([0, innerHeight])
    .paddingInner(0.25)
    .paddingOuter(0.2);

  // ===== 小标题 "Top 10 crime hotspots"（在plot内部左上）=====
  // g.append('text')
  //   .text('Top 10 crime hotspots')
  //   .attr('x', -10)          // 微微向左伸出一点，视觉对齐左侧
  //   .attr('y', -25)
  //   .attr('fill', '#FFFFFF')
  //   .attr('font-family', 'NYUTypeBold')
  //   .attr('font-size', '20px')
  //   .attr('text-anchor', 'start');

  // ===== 背景垂直网格线（紫色）=====
  const smartTicks = x.ticks(6).filter(tick => Number.isInteger(tick));

  // ===== 背景垂直网格线（紫色）=====
  g.selectAll('.grid-line-vertical')
    .data(smartTicks)
    .enter()
    .append('line')
    .attr('class', 'grid-line-vertical')
    .attr('x1', d => x(d))
    .attr('x2', d => x(d))
    .attr('y1', 0)
    .attr('y2', innerHeight)
    .attr('stroke', '#2A0050')
    .attr('stroke-width', 1);

  // 🌟🌟🌟 新增代码开始：X 轴白色短刻度 🌟🌟🌟
  // 手动绘制刻度线，并过滤掉 0，防止在左下角重叠
  g.selectAll('.x-tick-line')
    .data(smartTicks.filter(d => d !== 0)) // 过滤掉 0
    .enter()
    .append('line')
    .attr('class', 'x-tick-line')
    .attr('x1', d => x(d)) // 使用当前的 x 比例尺
    .attr('x2', d => x(d))
    .attr('y1', innerHeight)     // 起点：图表底部
    .attr('y2', innerHeight + 6) // 终点：向下延伸 6px
    .attr('stroke', '#FFFFFF')   // 白色
    .attr('stroke-width', 1);

  // ===== 条形图（紫色横条）=====
  const bars = g.selectAll('.bar')
    .data(chartData)
    .enter()
    .append('rect')
    .attr('class', 'bar')
    .attr('y', d => y(d.name))
    .attr('x', 0)
    .attr('height', y.bandwidth())
    .attr('width', 0)
    .attr('fill', '#9B00FF');

  // 宽度动画
  bars.transition()
    .duration(1000)
    .ease(d3.easeCubicOut)
    .attr('width', d => x(d.count));

const formatPlaceName = (rawName) => {
    if (!rawName) return '';
    return rawName
      .split('_') // 按下划线拆分
      .map(word => {
        // 特殊处理 NYU
        if (word.toUpperCase() === 'NYU') return 'NYU';
        // 其他单词：首字母大写 + 剩余小写
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(' '); // 用空格重新连接
  };

  // ===== 左侧地点名称 =====
  g.selectAll('.place-label')
    .data(chartData)
    .enter()
    .append('text')
    .attr('class', 'place-label')
    .attr('x', -15)
    .attr('y', d => y(d.name) + y.bandwidth() / 2 + 4)
    .attr('text-anchor', 'end')
    .attr('fill', '#FFFFFF')
    .attr('font-family', 'NYUTypeRegular') // 保持你改过的 Regular
    .attr('font-size', '16px')
    .text(d => formatPlaceName(d.name)); // 🌟 在这里调用格式化函数

  // ===== 条形右端数字 =====
  g.selectAll('.bar-count-label')
    .data(chartData)
    .enter()
    .append('text')
    .attr('class', 'bar-count-label')
    .attr('x', d => x(d.count) - 10)
    .attr('y', d => y(d.name) + y.bandwidth() / 2 + 8)
    .attr('text-anchor', 'end')
    .attr('fill', '#FFFFFF')
    .attr('font-family', 'NYUTypeMedium')
    .attr('font-size', '24px')
    .text(d => d.count);

  // ===== X 轴：底部 0~xMax，白色轴线 + 紫色数字 =====
const xAxis = d3.axisBottom(x)
    .tickValues(smartTicks)       // <--- 改这里：只显示智能计算出的刻度
    .tickFormat(d3.format('d'))   // <--- 改这里：强制只显示整数 (No decimals)
    .tickSize(0)
    .tickPadding(10);

  const xAxisGroup = g.append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(xAxis);

  xAxisGroup.select('.domain')
    .attr('stroke', '#FFFFFF')
    .attr('stroke-width', 1);

  xAxisGroup.selectAll('.tick line')
    .attr('stroke', 'transparent');

  xAxisGroup.selectAll('.tick text')
    .attr('fill', '#9B00FF')
    .attr('y', 20)

    .attr('font-family', 'NYUTypeLight')
    .attr('font-size', '32px');

  // ===== 右下角 “Number of Crime” =====
  g.append('text')
    .text('Number of Crime')
    .attr('x', innerWidth + 10)      // 在轴线末端之后一点点
    .attr('y', innerHeight + 5)      // 基线略高于数字
    .attr('fill', '#FFFFFF')
    .attr('font-family', 'NYUTypeRegular')
    .attr('font-size', '16px')
    .attr('text-anchor', 'start');
}

// 图3*************************************************************
// =========================================================
// 📊 D3 图表 3: Top 5 + Other (RegEx Cleaned)
// =========================================================

// =========================================================
// 📊 D3 图表 3: Crime Types (大饼图 + 左侧文字版)
// =========================================================

function drawCrimeTypePieChart(data) {
  const container = document.getElementById('d3-chartThree-wrapper');
  
  // 1. 安全检查：如果容器不存在，或者宽度为0，直接不画，防止报错
  if (!container || container.clientWidth === 0 || container.clientHeight === 0) {
    console.warn("Chart container has no size yet, skipping draw.");
    return;
  }

  container.innerHTML = '';

  const width = container.clientWidth;
  const height = container.clientHeight;

  const margin = { top: 60, right: 40, bottom: 100, left: 50 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  // 2. 二次安全检查：防止 margin 比容器本身还大
  if (innerWidth <= 0 || innerHeight <= 0) return;

  const svg = d3.select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height);

  const g = svg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  // 颜色配置
  const gradientColors = [
    '#3200ac', '#4c00d4', '#7020ed', 
    '#9550fa', '#b480ff', '#ffffff'
  ];

  // 标题
  svg.append('text')
    .text('Crime Types')
    .attr('x', margin.left)
    .attr('y', 50) 
    .attr('fill', '#ffffff')
    .attr('font-family', 'NYUTypeRegular')
    .attr('font-size', '16px')
    .attr('text-anchor', 'start');

  // ===== 布局计算 =====
  const legendSectionWidth = innerWidth * 0.40; 
  const maxLabelWidth = legendSectionWidth - 20; 
  const pieSectionWidth = innerWidth * 0.60;
  
  const radius = Math.min(pieSectionWidth, innerHeight) / 2 * 1.1;
  const pieCenterX = legendSectionWidth + (pieSectionWidth / 2);
  const pieCenterY = innerHeight / 2;

  const pieGroup = g.append('g')
    .attr('transform', `translate(${pieCenterX},${pieCenterY})`);

  // ===== 绘制饼图 =====
  const total = d3.sum(data, d => d.value);
  const pie = d3.pie().sort(null).value(d => d.value);
  const arc = d3.arc().innerRadius(0).outerRadius(radius);
  const arcs = pieGroup.selectAll('.slice').data(pie(data)).enter().append('g').attr('class', 'slice');

  arcs.append('path')
    .attr('d', arc)
    .attr('fill', (d, i) => gradientColors[i % gradientColors.length])
    .attr('stroke', '#000').attr('stroke-width', 1);

  arcs.append('text')
    .attr('transform', d => `translate(${arc.centroid(d)})`)
    .attr('text-anchor', 'middle')
    .attr('dy', '0.35em')
    .attr('font-family', 'NYUTypeBold')
    .attr('font-size', '20px') 
    .attr('fill', (d, i) => {
        const color = gradientColors[i % gradientColors.length];
        return color === '#ffffff' ? '#000000' : '#FFFFFF';
    })
    .text(d => {
      const pct = total === 0 ? 0 : Math.round((d.data.value / total) * 100);
      return pct > 3 ? pct + '%' : ''; 
    });

  // ===== 左侧文字图例 =====
  
  // 预计算 Y 坐标
  let currentY = 0;
  const itemPositions = data.map(d => {
    const y = currentY;
    const isLong = d.label.length > 22; 
    currentY += isLong ? 70 : 36; 
    return { ...d, y: y };
  });

  const totalLegendHeight = currentY;
  const startY = (innerHeight - totalLegendHeight) / 2;

  const legendGroup = g.append('g')
    .attr('transform', `translate(0, ${startY})`); 

  const legendItems = legendGroup.selectAll('.legend-item')
    .data(itemPositions) 
    .enter()
    .append('g')
    .attr('class', 'legend-item')
    .attr('transform', d => `translate(0, ${d.y})`);

  legendItems.append('text')
    .text(d => d.label)
    .attr('x', 0)
    .attr('y', 0)
    .attr('dy', '0.35em')
    .attr('font-family', (d, i) => i < 3 ? 'NYUTypeBold' : 'NYUTypeMedium') 
    .attr('font-size', '32px') 
    .attr('fill', (d, i) => gradientColors[i % gradientColors.length])
    .call(wrap, maxLabelWidth); 
}

// 辅助函数：Wrap
function wrap(text, width) {
  text.each(function() {
    var text = d3.select(this),
        words = text.text().split(/\s+/).reverse(),
        word,
        line = [],
        lineNumber = 0,
        lineHeight = 1.0, 
        y = text.attr("y"),
        dy = parseFloat(text.attr("dy")) || 0,
        tspan = text.text(null).append("tspan").attr("x", 0).attr("y", y).attr("dy", dy + "em");
    while (word = words.pop()) {
      line.push(word);
      tspan.text(line.join(" "));
      if (tspan.node().getComputedTextLength() > width) {
        line.pop();
        tspan.text(line.join(" "));
        line = [word];
        tspan = text.append("tspan").attr("x", 0).attr("y", y).attr("dy", ++lineNumber * lineHeight + dy + "em").text(word);
      }
    }
  });
}


// =========================================================
// 7. 动画与交互
// =========================================================

function startEntranceAnimation() {
  // 设置【上帝视角】初始状态
  camera.position.set(40, 30, -6); 
  controls.target.set(1, 1, 2); 
  controls.update();

  const timeline = gsap.timeline();

  // 相机运动
  timeline.to(camera.position, {
    x: 4,
    y: 7.5,
    z: -4,
    duration: 3,
    ease: "power2.inOut"
  }, 0);

  // 视角中心运动
  timeline.to(controls.target, {
    x: -0.7, 
    y: 1.9, 
    z: 1,
    duration: 3,
    ease: "power2.inOut",
    onUpdate: () => {
      controls.update();
    },
    onComplete: () => {
      controls.enabled = true;
      lockControls(); 
      console.log("入场动画完成，视角已锁定");
    }
  }, 0);
}

function lockControls() {
  controls.update();
  const currentPolar = controls.getPolarAngle();
  const currentAzimuth = controls.getAzimuthalAngle();

  controls.minPolarAngle = currentPolar;
  controls.maxPolarAngle = currentPolar;
  controls.minAzimuthAngle = currentAzimuth;
  controls.maxAzimuthAngle = currentAzimuth;

  controls.enableRotate = false;
  controls.update();
}

// 鼠标交互
window.addEventListener('mousemove', onMouseMove)

function onMouseMove(event) {
  if (!MABuildings || !meshes['MABuildings']) return

  // 🌟 修正：使用 getBoundingClientRect 处理页面滚动后的坐标偏移
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera)
  const root = meshes['MABuildings']
  const intersects = raycaster.intersectObject(root, true)

  if (intersects.length > 0) {
    const firstHit = intersects[0].object
    const info = MABuildings.getBuildingInfoFromObject(firstHit)

    if (info && info.part) {
      if (activeHoverBuilding !== info.part) {
        if (activeHoverBuilding) {
          gsap.to(activeHoverBuilding.group.position, { y: activeHoverBuilding.originalY, duration: 0.3 })
        }
        activeHoverBuilding = info.part
        gsap.to(activeHoverBuilding.group.position, { y: activeHoverBuilding.originalY + 0.1, duration: 0.3 })
      }
      showTooltip(info, event.clientX, event.clientY)
    }
  } else {
    if (activeHoverBuilding) {
      gsap.to(activeHoverBuilding.group.position, { y: activeHoverBuilding.originalY, duration: 0.3 })
      activeHoverBuilding = null
    }
    hideTooltip()
  }
}

function showTooltip(info, x, y) {
  tooltip.innerHTML = `<div><strong>${info.displayName}</strong></div><div>Reported Crimes: ${info.crimeCount}</div>`
  tooltip.style.left = `${x + 12}px`
  tooltip.style.top = `${y + 12}px`
  tooltip.style.display = 'block'
}

function hideTooltip() { tooltip.style.display = 'none' }

function animate() {
  requestAnimationFrame(animate)
  if (stats) stats.update()

  controls.update()

  // 坐标强行纠偏限制
  controls.target.x = THREE.MathUtils.clamp(controls.target.x, PAN_LIMITS.minX, PAN_LIMITS.maxX)
  controls.target.z = THREE.MathUtils.clamp(controls.target.z, PAN_LIMITS.minZ, PAN_LIMITS.maxZ)

  renderer.render(scene, camera)
}