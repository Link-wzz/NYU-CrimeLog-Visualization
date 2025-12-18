// scripts/scrapeCrimeLog.cjs
// 使用：npm run scrape:crime

const fs = require('fs')
const path = require('path')
const puppeteer = require('puppeteer')

// 想抓的月份 slug，例如 "july-2025"
// 后面你可以随时往里加别的月份或年份
const MONTH_SLUGS = [
    'october-2024',
    'november-2024',
    'december-2024',
    'january-2025',
    'february-2025',
    'march-2025',
    'april-2025',
    'may-2025',
    'june-2025',
  'july-2025',
  'august-2025',
  'september-2025',
  'october-2025',
  'november-2025',

]

// NYU crime log 基础 URL
const BASE_URL =
  'https://www.nyu.edu/life/safety-health-wellness/campus-safety/crime-log/annual-detail'

// CSV 输出目录：public/crime-data
const DATA_DIR = path.join(__dirname, '..', 'public', 'crime-data')

async function main() {
  console.log('即将抓取月份：', MONTH_SLUGS.join(', '), '\n')

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }

  const browser = await puppeteer.launch({
    headless: true, 
    defaultViewport: { width: 1400, height: 900 },
  })

  try {
    for (const slug of MONTH_SLUGS) {
      console.log(`==== 抓取 ${slug} ====`)
      try {
        await scrapeMonth(browser, slug)
      } catch (err) {
        console.error(`❌ 抓取 ${slug} 失败：`, err.message)
      }
      console.log('') 
    }
  } finally {
    await browser.close()
    console.log('全部完成 ✅')
  }
}


async function scrapeMonth(browser, monthSlug) {
  const url = `${BASE_URL}/${monthSlug}.html`
  console.log('打开页面：', url)

  const page = await browser.newPage()

  // 可选：伪装一下 UA（你也可以复制自己浏览器的 UA 填到这里）
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  )

  try {
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 60_000,
    })
  } catch (err) {
    await page.close()
    throw new Error(`页面加载失败：${err.message}`)
  }

  // 等待 crime log 表格出现（如果 15 秒出不来就认定失败）
  try {
    await page.waitForSelector(
      '#main-article .nyutable table.table-no-sort.horizontal.table-scroller tbody tr.table-no-sort-tr',
      { timeout: 15_000 }
    )
  } catch (err) {
    // 这里不抛致命错误，只提示并结束这个月份
    console.warn('⚠️ 在 15s 内没等到 crime log 表格，跳过这个月份。')
    await saveDebug(page, monthSlug)
    await page.close()
    return
  }

  // 采集表格行
  const rows = await page.$$eval(
    '#main-article .nyutable table.table-no-sort.horizontal.table-scroller tbody tr.table-no-sort-tr',
    (trs) => {
      return trs
        .map((tr) => {
          const cells = Array.from(tr.querySelectorAll('td')).map((td) =>
            td.textContent.trim().replace(/\s+/g, ' ')
          )
          return cells
        })
        .filter((row) => row.length > 0 && row.some((cell) => cell !== ''))
    }
  )

  if (!rows || rows.length === 0) {
    console.warn('⚠️ 表格存在，但没有抓到任何有效行，跳过这个月份。')
    await saveDebug(page, monthSlug)
    await page.close()
    return
  }

  console.log(`共抓到 ${rows.length} 行`)

  // 由于 thead 是空的，这里用通用 col1/col2... 作为表头
  const columnCount = rows[0].length
  const header = Array.from({ length: columnCount }, (_, i) => `col${i + 1}`)
  const dataRows = rows

  const csv = toCSV([header, ...dataRows])

  const filePath = path.join(DATA_DIR, `crime-log-${monthSlug}.csv`)

  // ✅ 如果已有同名文件，明确提示“将覆盖”
  if (fs.existsSync(filePath)) {
    console.log('ℹ️ 发现已有文件，将覆盖：', filePath)
  }

  try {
    fs.writeFileSync(filePath, csv, 'utf8') // 默认就是覆盖写
    console.log('✅ 已写入：', filePath)
  } catch (err) {
    throw new Error(`写入 CSV 失败：${err.message}`)
  } finally {
    await page.close()
  }
}

/**
 * 简单 CSV 转换：二维数组 -> CSV 文本
 */
function toCSV(rows) {
  if (!rows || rows.length === 0) return ''

  return rows
    .map((cols) =>
      (cols || [])
        .map((value) => {
          if (value == null) return '""'
          const v = String(value).replace(/"/g, '""')
          return `"${v}"`
        })
        .join(',')
    )
    .join('\n')
}

/**
 * Debug 辅助：当抓取失败时，把页面 HTML 和截图存下来，方便之后分析。
 * 不会影响正常流程。
 */
async function saveDebug(page, monthSlug) {
  try {
    const debugHtmlPath = path.join(DATA_DIR, `debug-${monthSlug}.html`)
    const debugPngPath = path.join(DATA_DIR, `debug-${monthSlug}.png`)
    const html = await page.content()
    fs.writeFileSync(debugHtmlPath, html, 'utf8')
    await page.screenshot({ path: debugPngPath, fullPage: true })

    console.log('📝 已保存 debug 文件：')
    console.log('   ', debugHtmlPath)
    console.log('   ', debugPngPath)
  } catch (err) {
    console.warn('保存 debug 文件失败，但不影响主流程：', err.message)
  }
}

main().catch((err) => {
  console.error('脚本运行出错：', err)
  process.exit(1)
})
