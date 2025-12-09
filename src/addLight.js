// 文件：addLight.js
import * as THREE from 'three'

export function addLight() {
  // 1. 平行光 (主光源)
  const sun = new THREE.DirectionalLight(0xffffff, 1.5) 

  sun.position.set(10, 20, 5) 
  
  sun.castShadow = true

  // 2. 阴影贴图设置
  sun.shadow.mapSize.width = 8192
  sun.shadow.mapSize.height = 8192
  
  // 【修改 2：缩小阴影相机范围】
  // 之前的范围是 +/- 200，对于缩放后的模型太浪费了。
  // 缩小到 +/- 15，让 4096 的像素全部集中在这一小块区域，影子会超级清晰！
  const d = 15 
  sun.shadow.camera.left = -d
  sun.shadow.camera.right = d
  sun.shadow.camera.top = d
  sun.shadow.camera.bottom = -d
  
  // 远近裁剪面也相应缩小
  sun.shadow.camera.near = 0.1
  sun.shadow.camera.far = 100

  // 【修改 3：微调 Bias】
  // 模型越小，Bias 越敏感。如果发现影子和楼底有空隙，把这个数字调得更接近 0
  sun.shadow.normalBias = 0; // 一个对于小模型很安全的数值
  //这里问老师:
  // sun.shadow.bias = -0.0002;

  // 阴影柔和度 
  sun.shadow.radius = 8; 

  // 3. 环境光
  // 保持亮度，确保白色模型不会变灰
  const ambient = new THREE.AmbientLight(0xffffff, 0.9)

  const group = new THREE.Group()
  group.add(sun)
  group.add(ambient)

  return group
}