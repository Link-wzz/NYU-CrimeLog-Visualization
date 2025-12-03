// scripts/buildCrimeSummary.cjs
// 用法：npm run build:summary

const fs = require('fs')
const path = require('path')
const { parse } = require('csv-parse/sync')

// 📂 所有 CSV 的目录
const DATA_DIR = path.join(__dirname, '..', 'public', 'crime-data')

// 📄 建筑匹配表（你已经有了）
const MAPPING_FILE = path.join(DATA_DIR, 'MABuildingMatch.csv')

// 📄 输出的汇总 JSON
const OUTPUT_FILE = path.join(DATA_DIR, 'crime-summary-2024-2025.json')

// 原始数据里的列名：哪一列是“建筑名称”和“区域”
// 你 scrape 出来的 header 是 col1,col2...，我们现在假定：col5 = building, col6 = area
const RAW_BUILDING_COLUMN = 'col5'
const RAW_AREA_COLUMN = 'col6'

// 工具函数：读取 CSV -> records[]
function loadCsv(filePath) {
  const content = fs.readFileSync(filePath, 'utf8')
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
  })
}

// 把 (building, area) 组合成一个 key，方便 map
function buildKey(rawBuilding, rawArea) {
  const b = (rawBuilding || '').trim().toUpperCase()
  const a = (rawArea || '').trim().toUpperCase()
  return `${b}||${a}`
}

async function main() {
  if (!fs.existsSync(MAPPING_FILE)) {
    console.error('❌ 找不到匹配表：', MAPPING_FILE)
    process.exit(1)
  }

  console.log('读取匹配表 MABuildingMatch.csv ...')
  const mappingRows = loadCsv(MAPPING_FILE)

  // 建两个索引：
  // 1. building + area 完全匹配
  // 2. 只有 building 匹配（作为 fallback）
  const mappingByBA = new Map()
  const mappingByB = new Map()

  for (const row of mappingRows) {
    const rawBuilding = (row.raw_building || '').trim()
    const rawArea = (row.raw_area || '').trim()
    if (!rawBuilding) continue

    const keyBA = buildKey(rawBuilding, rawArea)
    mappingByBA.set(keyBA, row)

    const keyB = rawBuilding.toUpperCase()
    // 第一次出现的写法作为“代表”，后面同名可以覆盖也可以保留，问题不大
    if (!mappingByB.has(keyB)) {
      mappingByB.set(keyB, row)
    }
  }

  // 找出所有 crime-log-*.csv 文件
  const crimeFiles = fs
    .readdirSync(DATA_DIR)
    .filter(
      (f) =>
        f.startsWith('crime-log-') &&
        f.endsWith('.csv') &&
        !f.startsWith('crime-log-data') // 防止你以后手动合并的叫这个名
    )

  if (!crimeFiles.length) {
    console.error('❌ public/crime-data 里没有找到 crime-log-*.csv 文件')
    process.exit(1)
  }

  console.log('将汇总以下文件：\n  ' + crimeFiles.join('\n  ') + '\n')

  const countByGlb = {}
  let totalIncidents = 0
  let unmatchedRows = 0

  for (const file of crimeFiles) {
    const filePath = path.join(DATA_DIR, file)
    console.log('处理：', file)

    const rows = loadCsv(filePath)

    for (const row of rows) {
      const rawBuilding = row[RAW_BUILDING_COLUMN]
      const rawArea = row[RAW_AREA_COLUMN]

      if (!rawBuilding) continue

      // 先用 building + area 匹配
      const keyBA = buildKey(rawBuilding, rawArea)
      let mapping = mappingByBA.get(keyBA)

      // 匹配不到就退化成只看 building
      if (!mapping) {
        const keyB = (rawBuilding || '').trim().toUpperCase()
        mapping = mappingByB.get(keyB)
      }

      if (!mapping) {
        unmatchedRows++
        continue
      }

      const include = String(mapping.include || '').trim().toLowerCase()
      const glbName = (mapping.glb_name || '').trim()

      if (include !== 'yes') continue
      if (!glbName) continue

      countByGlb[glbName] = (countByGlb[glbName] || 0) + 1
      totalIncidents++
    }
  }

  // 计算最小/最大次数，用于颜色映射
  let minCount = Infinity
  let maxCount = 0
  for (const c of Object.values(countByGlb)) {
    if (c < minCount) minCount = c
    if (c > maxCount) maxCount = c
  }
  if (!isFinite(minCount)) minCount = 0

  // 按次数从大到小排序，方便 debug
  const sortedEntries = Object.entries(countByGlb).sort((a, b) => b[1] - a[1])
  const buildings = Object.fromEntries(sortedEntries)

  const summary = {
    meta: {
      totalIncidents,
      unmatchedRows,
      minCount,
      maxCount,
      buildingCount: Object.keys(buildings).length,
      crimeFiles,
      mappingFile: path.basename(MAPPING_FILE),
    },
    buildings, // { glbName: count }
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(summary, null, 2), 'utf8')
  console.log('\n✅ 已写入汇总文件：', OUTPUT_FILE)
  console.log('   楼栋数量:', summary.meta.buildingCount)
  console.log('   总事件数（已匹配且 include=yes）:', summary.meta.totalIncidents)
  console.log('   未匹配行数:', summary.meta.unmatchedRows)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
