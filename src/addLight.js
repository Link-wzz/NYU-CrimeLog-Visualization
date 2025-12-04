import * as THREE from 'three'


export function addLight() {
  // ⭐ 太阳光（DirectionalLight）
  const sun = new THREE.DirectionalLight(0xffffff, 1.8) // 强度可调
  sun.position.set(50, 80, -30)  // 光从右上方照射
  sun.castShadow = true

  // 阴影设置（可调整）
  sun.shadow.mapSize.width = 2048
  sun.shadow.mapSize.height = 2048
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 200
  sun.shadow.camera.left = -50
  sun.shadow.camera.right = 50
  sun.shadow.camera.top = 50
  sun.shadow.camera.bottom = -50

  // ⭐ 环境光：让阴影不要太黑
  const ambient = new THREE.AmbientLight(0xffffff, 0.45)

  const group = new THREE.Group()
  group.add(sun)
  group.add(ambient)

  return group
}
