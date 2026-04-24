//Importing all our different loaders and materials
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader'
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler'
// import {
// 	Color,
// 	AnimationMixer,
// 	PointsMaterial,
// 	Points,
// 	MeshMatcapMaterial,
// 	TextureLoader,
// 	Vector3,
// 	BufferGeometry,
// 	Float32BufferAttribute,
// 	AdditiveBlending,
// 	MeshBasicMaterial,
// 	Group,
// 	Mesh,
// 	MeshStandardMaterial, // ✅ 新增：给 Maperipherals 用的普通标准材质
// } from 'three'

import {
  Color,
  AnimationMixer,
  PointsMaterial,
  Points,
  MeshMatcapMaterial,
  TextureLoader,
  Vector3,
  BufferGeometry,
  Float32BufferAttribute,
  AdditiveBlending,
  MeshBasicMaterial,
  Group,
  Mesh,
  MeshStandardMaterial,
  MeshPhongMaterial,   // ✅ 新增
} from 'three'




// 🧱 一个小的“建筑部分”类，用来封装每栋楼的状态
class BuildingPart {
	constructor(meshes, name, group) { // 新增 group 参数
        this.meshes = meshes
        this.name = name
        this.group = group // 保存对 Group 的引用
        this.crimeCount = 0
        this.originalY = group.position.y // 记录初始 Y 坐标
    }

	// 设置犯罪次数并根据犯罪次数更新颜色
	setCrimeCount(count, scaleConfig) {
		this.crimeCount = count
		this.updateColor(scaleConfig)
	}

	// 根据 crimeCount，把颜色从浅紫 -> 深紫（使用 log scale 映射）
updateColor(scaleConfig) {
    const { min, max, colorLow, colorHigh } = scaleConfig

    // ---- LOG SCALE 版本 ----
    const safeMin = Math.max(1, min)
    const safeMax = Math.max(1, max)
    const safeCount = Math.max(1, this.crimeCount)

    // 取 log10，压缩极端大值（如 Langone）
    const logCount = Math.log10(safeCount)
    const logMin = Math.log10(safeMin)
    const logMax = Math.log10(safeMax)

    const logRange = logMax - logMin || 1
    let t = (logCount - logMin) / logRange
    t = Math.min(1, Math.max(0, t))  // clamp 0~1

    // 插值颜色
    const c1 = colorLow.clone()
    const c2 = colorHigh.clone()
    const finalColor = c1.lerp(c2, t)

    // 应用到本楼所有 mesh
    this.meshes.forEach((m) => {
        if (!m.material) return
        m.material.color.copy(finalColor)
    })
}

}

//create our class, we're using a class since this is a modular template for loading various models
export default class Model {
	//this is akin to our setup function where we create a bunch of default states or variables
	constructor(obj) {

		
		//mostly taking the data like name, meshes, url etc we pass in and setting them as variables in our instance.
		this.name = obj.name
		this.meshes = obj.meshes
		this.file = obj.url
		this.scene = obj.scene
		//new manager line!
		this.loader = new GLTFLoader(obj.manager)
		this.dracoLoader = new DRACOLoader()
		this.dracoLoader.setDecoderPath('./draco/')
		this.loader.setDRACOLoader(this.dracoLoader)
		this.textureLoader = new TextureLoader()
		//this structure is slightly different than the basic var name = value, we basically use the or operator || to set the default to false if obj.animationState or obj.replace is undefined. In the case we don't pass any values into either of those obj.animationState will be undefined and thus this will be resolved as this.animations = (undefined || false) aka this.animations = false
		this.animations = obj.animationState || false

		// ❗注意：老的 replaceMaterials 逻辑是“把所有 mesh 的材质都替换成同一个 Matcap”
		// 但在楼宇模式（enableBuildingMode）下，我们希望每栋楼可单独调色，所以会关闭这个行为。
		this.replaceMaterials = obj.replace || false

		//another expression that may not be super common, ? : is typical for ternary operators, again lets us conditionally set states, this looks like (true false statement) ? if true do this : else do this. -> obj.replaceURL is passed in it evaluates to true since it's not undefined or null so then we do the first line aka this.textureLoader.load(`${obj.replaceURL}`), if not then we use our default /mat.png
		//Why do we do this ternary operator? Well if obj.replaceURL isn't passed in we don't want to try and set our matcap to a value that doesn't exist, this way we only set it to the replaceURL if it exists otherwise we go to a fallback value
		this.defaultMatcap = obj.replaceURL
			? this.textureLoader.load(`${obj.replaceURL}`)
			: this.textureLoader.load('/mat.png')

		this.mixer = null
		this.mixers = obj.mixers
		this.defaultParticle = obj.particleURL
			? this.textureLoader.load(`${obj.particleURL}`)
			: this.textureLoader.load('/10.png')
		this.scale = obj.scale || new Vector3(1, 1, 1)
		this.position = obj.position || new Vector3(0, 0, 0)
		this.rotation = obj.rotation || new Vector3(0, 0, 0)
		this.palette = [
			new Color('#FAAD80'),
			new Color('#FF6767'),
			new Color('#FF3D68'),
			new Color('#A73489'),
		]
		this.callback = obj.callback

		// 🔧🔧🔧 下面是为了 NYU Crime Log 新增的配置 🔧🔧🔧

		// 是否启用“楼宇模式”：会自动把 GLB 顶层子节点当作独立建筑
		this.enableBuildingMode = obj.enableBuildingMode || false

		// 存储每一栋楼（BuildingPart 实例）
		this.buildings = new Map()

		// 外围非 NYU 建筑（MAperipherals）
		this.peripheralGroup = null

		// 犯罪数映射区间，可在外部修改
		this.crimeScale = obj.crimeScale || { min: 0, max: 50 }

		// 低犯罪数对应的浅紫色
		this.colorLow = obj.colorLow ? new Color(obj.colorLow) : new Color('#EBD7FF')
		// 高犯罪数对应的深紫色
		this.colorHigh = obj.colorHigh ? new Color(obj.colorHigh) : new Color('#4A148C')
	}
	init() {
		//the meat and bones of the file, we load our models using our gltf loader
		this.loader.load(this.file, (gltf) => {
			this.mesh = gltf.scene.children[0]

			// ⚠️ 如果启用了楼宇模式，我们不再使用旧的“一键替换材质”逻辑，
			// 因为那样会让所有楼共享同一个材质，无法单独调色。
			if (this.replaceMaterials && !this.enableBuildingMode) {
				const replacementMaterial = new MeshMatcapMaterial({
					matcap: this.defaultMatcap,
				})
				//intuitive naming, we traverse through every element and for each check if it's a mesh, if it's a mesh it must have a material and we sub it out for our new material
				gltf.scene.traverse((child) => {
					if (child.isMesh) {
						child.material = replacementMaterial
					}
				})
			}

			//if animations is set to true we load all the animations saved in the model to our animation mixer so we can manipulate them outside this class
			if (this.animations) {
				this.mixer = new AnimationMixer(gltf.scene)
				gltf.animations.forEach((clip) => {
					this.mixer.clipAction(clip).play()
				})
				this.mixers.push(this.mixer)
			}

			// 🏙️ 如果是楼宇模式，在这里把每一栋楼拆出来，建立 BuildingPart
			if (this.enableBuildingMode) {
				this._setupCampusBuildings(gltf.scene)
			}

			//we're taking the values we passed in and setting the values of our 3d model to said parameters, aka setting the positions, rotations and scale, and also adding the 3dmodel (gltf.scene) to our meshes object
			this.meshes[`${this.name}`] = gltf.scene
			this.meshes[`${this.name}`].position.set(
				this.position.x,
				this.position.y,
				this.position.z
			)
			this.meshes[`${this.name}`].scale.set(
				this.scale.x,
				this.scale.y,
				this.scale.z
			)
			this.meshes[`${this.name}`].rotation.set(
				this.rotation.x,
				this.rotation.y,
				this.rotation.z
			)
			this.meshes[`${this.name}`].userData.groupName = this.name
			if (this.callback) {
				this.callback(this.meshes[`${this.name}`])
			}
			this.scene.add(this.meshes[`${this.name}`])
		})
	}

	resetAllCounts() {
    this.buildings.forEach((part) => {
      part.crimeCount = 0;
    });
  }
  

	_formatBuildingName(rawName) {
		if (!rawName) return ''
		return rawName
			.toLowerCase()
			.split('_')
			.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
			.join(' ')
	}

	getBuildingInfoFromObject(object3D) {
		if (!object3D) return null

		let obj = object3D
		// 向上找，直到找到 userData.buildingPart
		while (obj && !obj.userData.buildingPart && obj.parent) {
			obj = obj.parent
		}

		const part = obj.userData?.buildingPart
		if (!part) return null

		const rawName = part.name
		const displayName = this._formatBuildingName(rawName)
		const crimeCount = part.crimeCount || 0

		return { rawName, displayName, crimeCount, part }
	}

	/**
	 * 🏫 处理整个校园 GLB：
	 * - 顶层子节点中，名字为 "MAperipherals" 的视为外围建筑
	 * - 其他子节点（BOBST_LIBRARY 等）视为可交互的 NYU 楼宇
	 */
	_setupCampusBuildings(rootScene) {
		rootScene.children.forEach((child) => {
			// 1. 先处理外围建筑
			if (child.name === 'MAperipherals') {
				this._setupPeripheral(child)
				return
			}

			// 2. 其他的只要有名字，就当作一栋楼
			if (child.isGroup || child.isMesh) {
				this._setupSingleBuilding(child)
			}
		})
	}

	/**
	 * 🌆 外围建筑（MAperipherals）：
	 * 使用统一的灰色 MeshStandardMaterial，不参与犯罪统计。
	 */
	_setupPeripheral(group) {
        this.peripheralGroup = group

        // 【修改点 1】调整材质参数
        const peripheralMaterial = new MeshStandardMaterial({
            color: 0xffffff,     // 将颜色改为纯白或非常浅的灰（图二看起来几乎是白的）
            metalness: 0.0,      // 0.0 = 完全非金属，像石膏或粘土
            roughness: 1.0,      // 1.0 = 最粗糙，完全哑光面
            // flatShading: true // 可选：如果想要更硬朗的低多边形风格可以开启，但图二看起来是光滑的，所以先注释掉
        })

        group.traverse((child) => {
            if (child.isMesh) {
                // 注意：给外围建筑单独材质，避免和楼宇共享
                child.material = peripheralMaterial.clone()
                
                // 【修改点 2 🌟关键🌟】开启投射阴影
                // 原代码是 child.castShadow = false; 这导致周围建筑没有立体感
                child.castShadow = true 
                
                child.receiveShadow = true
            }
        })
    }

	/**
	 * 🏢 处理一栋 NYU 楼宇（比如 BOBST_LIBRARY）
	 * 会：
	 * 1. 收集它下面所有 mesh
	 * 2. 给这些 mesh 设置基于 matcap 的材质
	 * 3. 创建 BuildingPart 并存入 this.buildings
	 */
_setupSingleBuilding(group) {
  const buildingName = group.name || 'UNNAMED_BUILDING'
  const meshes = []

  group.traverse((child) => {
    if (child.isMesh) {
      const mat = new MeshPhongMaterial({
        color: this.colorLow.clone(),
        shininess: 40,
        specular: new Color('#444444'),
      })
      child.material = mat
      child.castShadow = true
      child.receiveShadow = true
      meshes.push(child)
    }
  })

  if (meshes.length === 0) return

  // 【🌟修改点🌟】传入 group 对象
  const part = new BuildingPart(meshes, buildingName, group)
  this.buildings.set(buildingName, part)

  meshes.forEach((m) => {
    m.userData.buildingName = buildingName
    m.userData.buildingPart = part
  })
}



	/**
	 * 外部接口：根据楼名设置犯罪次数。
	 * 例如：model.setCrimeCountByName('BOBST_LIBRARY', 23)
	 */
	setCrimeCountByName(name, count) {
		const part = this.buildings.get(name)
		if (!part) {
			console.warn(`[Model] Building not found for crime data: ${name}`)
			return
		}

		part.setCrimeCount(count, {
			min: this.crimeScale.min,
			max: this.crimeScale.max,
			colorLow: this.colorLow,
			colorHigh: this.colorHigh,
		})
	}

	/**
	 * 外部接口：一次性更新所有楼的颜色。
	 * 在你调整了 crimeScale.min / max 后，调用这个方法刷新。
	 */
	updateAllBuildingColors() {
		for (const part of this.buildings.values()) {
			part.updateColor({
				min: this.crimeScale.min,
				max: this.crimeScale.max,
				colorLow: this.colorLow,
				colorHigh: this.colorHigh,
			})
		}
	}

	/**
	 * 设置犯罪映射区间，例如：
	 * model.setCrimeScale({ min: 0, max: 100 })
	 */
	setCrimeScale({ min, max }) {
		this.crimeScale.min = min
		this.crimeScale.max = max
		this.updateAllBuildingColors()
	}

	/**
	 * （可选）获取当前所有楼的名字，方便你和 CSV 做对照 debug
	 */
	getBuildingNames() {
		return Array.from(this.buildings.keys())
	}

	//ignore for now, WIP from my end
	initPoints() {
		this.loader.load(this.file, (gltf) => {
			const meshes = []
			const pointCloud = new Group()
			gltf.scene.traverse((child) => {
				if (child.isMesh) {
					meshes.push(child)
				}
			})
			for (const mesh of meshes) {
				pointCloud.add(this.createPoints(mesh))
			}
			console.log(pointCloud)
			this.meshes[`${this.name}`] = pointCloud
			this.meshes[`${this.name}`].scale.set(
				this.scale.x,
				this.scale.y,
				this.scale.z
			)
			this.meshes[`${this.name}`].position.set(
				this.position.x,
				this.position.y,
				this.position.z
			)
			this.meshes[`${this.name}`].rotation.set(
				this.rotation.x,
				this.rotation.y,
				this.rotation.z
			)
			this.scene.add(this.meshes[`${this.name}`])
		})
	}
	createPoints(_mesh) {
		const sampler = new MeshSurfaceSampler(_mesh).build()
		const numParticles = 3000
		const particlesPosition = new Float32Array(numParticles * 3)
		const particleColors = new Float32Array(numParticles * 3)
		const newPosition = new Vector3()
		for (let i = 0; i < numParticles; i++) {
			sampler.sample(newPosition)
			const color =
				this.palette[Math.floor(Math.random() * this.palette.length)]
			particleColors.set([color.r, color.g, color.b], i * 3)
			particlesPosition.set(
				[newPosition.x, newPosition.y, newPosition.z],
				i * 3
			)
		}
		const pointsGeometry = new BufferGeometry()
		pointsGeometry.setAttribute(
			'position',
			new Float32BufferAttribute(particlesPosition, 3)
		)
		pointsGeometry.setAttribute(
			'color',
			new Float32BufferAttribute(particleColors, 3)
		)
		const pointsMaterial = new PointsMaterial({
			vertexColors: true,
			transparent: true,
			alphaMap: this.defaultParticle,
			alphaTest: 0.001,
			depthWrite: false,
			blending: AdditiveBlending,
			size: 0.12,
		})
		const points = new Points(pointsGeometry, pointsMaterial)
		return points
	}
}
