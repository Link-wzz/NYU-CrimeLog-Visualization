import './style.css'
import Stats from 'three/examples/jsm/libs/stats.module.js'
import * as THREE from 'three'
import { addLight } from './addLight'
import Model from './model'
import { InteractionManager } from 'three.interactive'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import gsap from 'gsap'

// ------------------ 全局变量 & 配置 ------------------
const raycaster = new THREE.Raycaster()
const mouse = new THREE.Vector2()

// 设置平移视角限制
const PAN_LIMITS = {
  minX: -2.5, 
  maxX: 2.5,  
  minZ: -0.5, 
  maxZ: 0.5   
}

const clock = new THREE.Clock()
const meshes = {}
const mixers = []
let MABuildings = null
let activeHoverBuilding = null 

// ------------------ 场景 & 渲染器 & 相机 ------------------
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
document.body.appendChild(renderer.domElement)

const camera = new THREE.PerspectiveCamera(9, window.innerWidth / window.innerHeight, 0.1, 1000)

// ------------------ 监测器 & UI ------------------
const stats = new Stats()
document.body.appendChild(stats.dom)

const tooltip = document.createElement('div')
tooltip.className = 'building-tooltip'
tooltip.style.position = 'fixed'
tooltip.style.pointerEvents = 'none'
tooltip.style.display = 'none'
document.body.appendChild(tooltip)

// ------------------ 交互控制 OrbitControls ------------------
const controls = new OrbitControls(camera, renderer.domElement)

// 🌟 初始化配置
controls.enabled = false;     // 入场动画期间禁用交互
controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.enableRotate = false; // 初始禁止旋转
controls.enableZoom = false;
controls.enablePan = true;

// 设置按键映射
controls.mouseButtons = {
  LEFT: THREE.MOUSE.PAN,
  MIDDLE: THREE.MOUSE.PAN,
  RIGHT: THREE.MOUSE.PAN,
}

const interactionManager = new InteractionManager(renderer, camera, renderer.domElement)

// ------------------ 核心初始化 ------------------
init()

function init() {
  scene.add(addLight())
  addGround()
  loadModel()
  animate()
}

// ------------------ 入场动画逻辑 ------------------

function startEntranceAnimation() {
  // 1. 设置【上帝视角】初始状态：垂直向下看
  camera.position.set(40,30, -6); 
  controls.target.set(1, 1, 2); // 初始看地面
  controls.update();

  const timeline = gsap.timeline();

  // 2. 协同动画：降落并平移至交互视角
  timeline.to(camera.position, {
    x: 4,
    y: 7.5,
    z: -4,
    duration: 3,
    ease: "power2.inOut"
  }, 0);

  //x: 向下运动
  timeline.to(controls.target, {
    x: -0.7, 
    y: 1.9, 
    z: 1,
    duration: 3,
    ease: "power2.inOut",
    onUpdate: () => {
      // 动画每帧都强制控制器更新
      controls.update();
    },
    onComplete: () => {
      // 🌟 动画结束后，开启交互并执行锁定逻辑
      controls.enabled = true;
      lockControls(); 
      console.log("入场动画完成，视角已锁定");
    }
  }, 0);
}

// 视角锁定函数：动画结束后执行
function lockControls() {
  controls.update();
  const currentPolar = controls.getPolarAngle();
  const currentAzimuth = controls.getAzimuthalAngle();

  // 此时锁死角度，不再干扰动画
  controls.minPolarAngle = currentPolar;
  controls.maxPolarAngle = currentPolar;
  controls.minAzimuthAngle = currentAzimuth;
  controls.maxAzimuthAngle = currentAzimuth;

  controls.enableRotate = false;
  controls.update();
}

// ------------------ 模型与地面加载 ------------------

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
      startEntranceAnimation(); // 🌟 触发降落动画
    },
  })
  MABuildings.init()
}

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

// ------------------ 交互处理 ------------------

window.addEventListener('mousemove', (event) => {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1

  if (!MABuildings || !meshes['MABuildings']) return
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
})

function showTooltip(info, x, y) {
  tooltip.innerHTML = `<div><strong>${info.displayName}</strong></div><div>Records: ${info.crimeCount}</div>`
  tooltip.style.left = `${x + 12}px`
  tooltip.style.top = `${y + 12}px`
  tooltip.style.display = 'block'
}

function hideTooltip() { tooltip.style.display = 'none' }

// ------------------ 动画循环 ------------------

function animate() {
  requestAnimationFrame(animate)
  if (stats) stats.update()

  controls.update()

  // 1. 坐标强行纠偏限制
  controls.target.x = THREE.MathUtils.clamp(controls.target.x, PAN_LIMITS.minX, PAN_LIMITS.maxX)
  controls.target.z = THREE.MathUtils.clamp(controls.target.z, PAN_LIMITS.minZ, PAN_LIMITS.maxZ)

  renderer.render(scene, camera)
}