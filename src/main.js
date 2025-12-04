import './style.css'

import * as THREE from 'three'  // 引入threejs 库
import { addDefaultMeshes, addSandardMesh } from './addDefaultMeshes'
import { addLight } from './addLight'
import Model from './model'
import { InteractionManager } from 'three.interactive'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import gsap from 'gsap'
const raycaster = new THREE.Raycaster()
const mouse = new THREE.Vector2()

const tooltip = document.createElement('div')
tooltip.className = 'building-tooltip'
tooltip.style.position = 'fixed'
tooltip.style.pointerEvents = 'none'
tooltip.style.display = 'none'
document.body.appendChild(tooltip)

// hover 状态
let hoverTimer = null
let hoverTarget = null // { rawName, displayName, crimeCount, part }

// ------------------ 场景 & 渲染器 & 相机 ------------------

const scene = new THREE.Scene()
scene.background = new THREE.Color(0xffffff)

const renderer = new THREE.WebGLRenderer({ antialias: true })

const camera = new THREE.PerspectiveCamera(
  10,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
)

// 移动 camera
camera.position.set(5, 7,-5)  // 可以自己微调


// 只需要 append 一次，否则会出现两个 canvas
renderer.setSize(window.innerWidth, window.innerHeight)
document.body.appendChild(renderer.domElement)

// ------------------ 交互控制 OrbitControls ------------------

const controls = new OrbitControls(camera, renderer.domElement)

controls.target.set(0.4, 2.4, 0)   // 模型中心
controls.update()              // 刷新


// 惯性阻尼可以保留
controls.enableDamping = true
controls.dampingFactor = 0.1

// ✅ 不允许旋转 & 缩放，只允许平移
controls.enableRotate = false
controls.enableZoom = false
controls.enablePan = true

// ✅ 左键 = 平移，中键/右键不用
controls.mouseButtons = {
  LEFT: THREE.MOUSE.PAN,
  MIDDLE: THREE.MOUSE.PAN,   // 随便映射一下，实际上也用不到
  RIGHT: THREE.MOUSE.PAN,
}

// ✅ 为了防止“拖着拖着把相机拉太远”，也可以锁一下距离（可选）
controls.minDistance = controls.maxDistance = camera.position.length()

// ------------------ 其他全局对象 ------------------

const meshes = {}
const lights = {}
const mixers = []
const clock = new THREE.Clock()

const interactionManager = new InteractionManager(
  renderer,
  camera,
  renderer.domElement
)

// 把模型对象提升到外层作用域，方便之后在别的地方访问
let MABuildings = null

init()

function init() {
  // 灯光
  lights.default = addLight()
  scene.add(lights.default)

  loadModel()
  animate()
}

window.addEventListener('mousemove', onMouseMove)

function onMouseMove(event) {
  // 标准化鼠标坐标（-1 ~ 1）
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1

  if (!MABuildings || !meshes['MABuildings']) {
    hideTooltip()
    return
  }

  // 从相机发射射线
  raycaster.setFromCamera(mouse, camera)

  // 与整棵 MABuildings 场景树做相交检测
  const root = meshes['MABuildings']
  const intersects = raycaster.intersectObject(root, true)

  if (!intersects.length) {
    // 鼠标没指向任何楼 → 清除 hover / 隐藏 tooltip
    hoverTarget = null
    clearTimeout(hoverTimer)
    hideTooltip()
    return
  }

  const firstHit = intersects[0].object
  const info = MABuildings.getBuildingInfoFromObject(firstHit)

  if (!info) {
    hoverTarget = null
    clearTimeout(hoverTimer)
    hideTooltip()
    return
  }

  // 如果还是同一栋楼，只更新 tooltip 位置即可
  if (hoverTarget && hoverTarget.part === info.part) {
    // 如果 tooltip 已经显示，跟着鼠标移动
    if (tooltip.style.display === 'block') {
      positionTooltip(event.clientX, event.clientY)
    }
    return
  }

  // 换了一栋楼：重置计时器
  hoverTarget = info
  clearTimeout(hoverTimer)
  hideTooltip()

  hoverTimer = setTimeout(() => {
    // 500ms 后仍然是这个 target，就显示 tooltip
    if (!hoverTarget || hoverTarget.part !== info.part) return
    showTooltip(info, event.clientX, event.clientY)
  }, 500)
}

function showTooltip(info, x, y) {
  tooltip.innerHTML = `
    <div><strong>${info.displayName}</strong></div>
    <div>Records: ${info.crimeCount}</div>
  `
  positionTooltip(x, y)
  tooltip.style.display = 'block'
}

function positionTooltip(x, y) {
  const offset = 12
  tooltip.style.left = `${x + offset}px`
  tooltip.style.top = `${y + offset}px`
}

function hideTooltip() {
  tooltip.style.display = 'none'
}

// ------------------ 载入 GLB 模型 + 应用犯罪数据 ------------------

// 读取 crime-summary，把次数写进模型里
async function applyCrimeDataToModel(model) {
  try {
    // ✅ 如果你的 summary 叫别的名字，在这里改路径就行
    const res = await fetch('/crime-data/crime-summary-2024-2025.json')
    if (!res.ok) {
      console.error('加载 crime summary 失败:', res.status)
      return
    }

    const summary = await res.json()
    const { minCount, maxCount } = summary.meta

    // 设定颜色映射区间（次数少 → 浅紫，次数多 → 深紫）
    model.setCrimeScale({
      min: minCount,
      max: maxCount,
    })

    // 把每个 GLB 分件的次数写进去
    for (const [glbName, count] of Object.entries(summary.buildings)) {
      model.setCrimeCountByName(glbName, count)
    }

    // 更新所有楼的颜色
    model.updateAllBuildingColors()

    console.log('✅ 已把犯罪数据应用到模型')
  } catch (err) {
    console.error('应用犯罪数据时出错:', err)
  }
}

function loadModel() {
  MABuildings = new Model({
    url: '/NYUBuildingMA.glb',
    name: 'MABuildings',
    scene: scene,
    meshes: meshes,
    scale: new THREE.Vector3(0.2, 0.2, 0.2),
    position: new THREE.Vector3(0, 0, 0),
    animationState: false,
    mixers: mixers,
    replace: true,

    enableBuildingMode: true,

    crimeScale: { min: 0, max: 100 },
    colorLow: '#EBD7FF',
    colorHigh: '#4A148C',

    callback: () => {
      console.log('模型加载完成，开始应用犯罪数据...')
      applyCrimeDataToModel(MABuildings) // 你之前写过的函数
    },
  })

  MABuildings.init()
}


// ------------------ 动画循环 ------------------

function animate() {
  requestAnimationFrame(animate)

  // 如果你以后要用动画 mixer，这里可以打开：
  // const delta = clock.getDelta()
  // mixers.forEach((m) => m.update(delta))

  controls.update()
  renderer.render(scene, camera)
}

animate()
