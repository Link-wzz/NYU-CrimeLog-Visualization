import './style.css'
import Stats from 'three/examples/jsm/libs/stats.module.js'
import * as THREE from 'three'
import { addLight } from './addLight'
import Model from './model'
import { InteractionManager } from 'three.interactive'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import gsap from 'gsap'

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

  // 情况 1: 默认 "Past 12 Months" -> 直接用现成的 Summary JSON
  if (value === '12') {
    await applyCrimeDataToModel(MABuildings); 
    return;
  }

  // 情况 2: 动态计算
  let targetSlugs = [];

  if (value === '3') {
    targetSlugs = monthSlugs.slice(monthSlugs.length - 3).reverse(); // 取最后3个并倒序(如果是按时间顺序列的)
    // 或者直接按你的倒序逻辑:
    // targetSlugs = [...monthSlugs].reverse().slice(0, 3);
    // 这里假设 monthSlugs 是按时间正序排列的 (oct-24 -> oct-25)
    targetSlugs = monthSlugs.slice(-3); 
  } else if (value === '6') {
    targetSlugs = monthSlugs.slice(-6); 
  } else {
    // 单月
    targetSlugs = [value];
  }

  // 开始前端实时计算
  await fetchAndCalcCsvData(targetSlugs);
}

// 核心计算函数
async function fetchAndCalcCsvData(slugs) {
  const mapping = await getBuildingMapping();
  if (!mapping) return;

  const countByGlb = {};
  
  // 并行 fetch 所有需要的 CSV
  const promises = slugs.map(slug => fetch(`/crime-data/crime-log-${slug}.csv`));
  const responses = await Promise.all(promises);

  for (const res of responses) {
    if (!res.ok) continue; 
    const text = await res.text();
    const rows = parseCSV(text);

    rows.forEach(row => {
      // 假设 col5 = building, col6 = area
      const rawBuilding = row.col5; 
      const rawArea = row.col6;

      if (!rawBuilding) return;

      const b = rawBuilding.trim().toUpperCase();
      const a = (rawArea || '').trim().toUpperCase();
      const keyBA = `${b}||${a}`;

      // 匹配逻辑
      let match = mapping.mappingByBA.get(keyBA);
      if (!match) match = mapping.mappingByB.get(b); // Fallback

      // 只有 include=yes 且有 glb_name 才统计
      if (match && match.include?.toLowerCase() === 'yes' && match.glb_name) {
        const name = match.glb_name;
        countByGlb[name] = (countByGlb[name] || 0) + 1;
      }
    });
  }

  // --- 更新模型 ---
  
  // 1. 重置之前的数据 (必须在 Model 类中实现 resetAllCounts)
  if (MABuildings && MABuildings.resetAllCounts) {
      MABuildings.resetAllCounts();
  }

  // 2. 计算最大最小值用于颜色映射
  const counts = Object.values(countByGlb);
  let min = 0, max = 0;
  if (counts.length > 0) {
    min = Math.min(...counts);
    max = Math.max(...counts);
  }

  console.log(`计算完成。最大犯罪数: ${max}`, countByGlb);

  // 3. 应用数据
  MABuildings.setCrimeScale({ min, max });
  for (const [name, count] of Object.entries(countByGlb)) {
    MABuildings.setCrimeCountByName(name, count);
  }

  // 4. 刷新颜色
  MABuildings.updateAllBuildingColors();
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

function init() {
  scene.add(addLight())
  addGround()
  loadModel()
  animate()
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
  tooltip.innerHTML = `<div><strong>${info.displayName}</strong></div><div>Records: ${info.crimeCount}</div>`
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