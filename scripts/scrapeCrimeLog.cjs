// scripts/scrapeCrimeLog.cjs
// 策略：
// 1. 打开主页，抓当前月数据（cmp-table 新组件）
// 2. 从主页侧边栏解析所有归档链接（不手动拼 URL，避免 NYU 的 URL 后缀变化问题）
// 3. 对每个归档链接：有旧文件的跳过，最近 2 个月强制重爬

const fs = require('fs')
const path = require('path')
const puppeteer = require('puppeteer')

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]

const NYU_BASE = 'https://www.nyu.edu'
const MAIN_URL = `${NYU_BASE}/life/safety-health-wellness/campus-safety/crime-log.html`

// 主页使用新版 CMS 组件
const MAIN_SELECTOR = 'table.cmp-table__table tbody tr'
// 归档页使用旧版 nyutable 组件
const ARCHIVE_SELECTOR =
  '#main-article .nyutable table.table-no-sort.horizontal.table-scroller tbody tr.table-no-sort-tr'

const DATA_DIR = path.join(__dirname, '..', 'public', 'crime-data')

// 从归档 URL（如 /annual-detail/february-20260.html）提取标准 slug（february-2026）
function urlToSlug(href) {
  const filename = href.split('/').pop().replace('.html', '')
  const match = filename.match(/^([a-z]+)-(\d+)$/)
  if (!match) return null
  const month = match[1]
  const year = match[2].substring(0, 4) // 处理 "20260" → "2026" 这类 NYU URL 怪癖
  if (!MONTH_NAMES.includes(month)) return null
  return `${month}-${year}`
}

function shouldScrapeArchive(slug) {
  const filePath = path.join(DATA_DIR, `crime-log-${slug}.csv`)
  if (!fs.existsSync(filePath)) return true

  const now = new Date()
  const currentSlug = `${MONTH_NAMES[now.getMonth()]}-${now.getFullYear()}`
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1)
  const lastSlug = `${MONTH_NAMES[lastMonthDate.getMonth()]}-${lastMonthDate.getFullYear()}`

  return slug === currentSlug || slug === lastSlug
}

async function main() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

  const launchArgs = ['--disable-dev-shm-usage']
  if (process.env.CI) launchArgs.push('--no-sandbox', '--disable-setuid-sandbox')

  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: { width: 1400, height: 900 },
    args: launchArgs,
  })

  try {
    // 步骤 1 & 2：爬主页，同时解析侧边栏归档链接
    const archiveLinks = await scrapeMainPage(browser)

    // 步骤 3：爬归档页
    const toScrape = archiveLinks.filter(({ slug }) => shouldScrapeArchive(slug))
    const toSkip = archiveLinks.filter(({ slug }) => !shouldScrapeArchive(slug))

    if (toSkip.length) {
      console.log(`跳过已有数据的归档月份（${toSkip.length} 个）：${toSkip.map(l => l.slug).join(', ')}\n`)
    }
    console.log(`归档页需爬取（${toScrape.length} 个）：${toScrape.map(l => l.slug).join(', ') || '无'}\n`)

    for (const { href, slug } of toScrape) {
      console.log(`==== 归档页：${slug} ====`)
      try {
        await scrapeArchivePage(browser, href, slug)
      } catch (err) {
        console.error(`❌ ${slug} 失败：`, err.message)
      }
      console.log('')
    }
  } finally {
    await browser.close()
    console.log('全部完成 ✅')
  }
}

// 爬主页：抓当前月数据并解析侧边栏所有归档链接
// 返回 [{ href, slug }, ...] 归档链接列表
async function scrapeMainPage(browser) {
  console.log('==== 主页（当前月数据 + 归档链接）====')
  console.log('打开页面：', MAIN_URL)

  const page = await browser.newPage()
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  )

  try {
    await page.goto(MAIN_URL, { waitUntil: 'networkidle2', timeout: 60_000 })
  } catch (err) {
    await page.close()
    console.error('主页加载失败：', err.message)
    return []
  }

  // 解析侧边栏归档链接（不依赖表格是否加载）
  const archiveLinks = await page.$$eval(
    'a[href*="/annual-detail/"]',
    (anchors) => anchors.map((a) => a.getAttribute('href')).filter(Boolean)
  )

  const parsedLinks = []
  for (const href of [...new Set(archiveLinks)]) {
    const slug = urlToSlug(href)
    if (slug) parsedLinks.push({ href, slug })
  }
  console.log(`发现 ${parsedLinks.length} 个归档链接：${parsedLinks.map(l => l.slug).join(', ')}`)

  // 抓当前月数据
  try {
    await page.waitForSelector(MAIN_SELECTOR, { timeout: 15_000 })
  } catch {
    console.warn('⚠️ 主页 15s 内未找到数据表格，跳过当前月数据。')
    await saveDebug(page, 'main-page')
    await page.close()
    return parsedLinks
  }

  const rows = await page.$$eval(MAIN_SELECTOR, (trs) =>
    trs
      .map((tr) =>
        Array.from(tr.querySelectorAll('td')).map((td) =>
          td.textContent.trim().replace(/\s+/g, ' ')
        )
      )
      .filter((row) => row.length > 0 && row.some((cell) => cell !== ''))
  )

  await page.close()

  if (!rows || rows.length === 0) {
    console.warn('⚠️ 主页数据表格为空，跳过当前月数据。')
    return parsedLinks
  }

  // col2（index 1）= Reported 日期，格式 "03/24/2026 4:20 AM"，按月分组
  const monthGroups = {}
  for (const row of rows) {
    const reported = row[1] || ''
    const match = reported.match(/^(\d{1,2})\/\d{1,2}\/(\d{4})/)
    if (!match) continue
    const slug = `${MONTH_NAMES[parseInt(match[1]) - 1]}-${match[2]}`
    if (!monthGroups[slug]) monthGroups[slug] = []
    monthGroups[slug].push(row)
  }

  for (const [slug, monthRows] of Object.entries(monthGroups)) {
    const header = Array.from({ length: monthRows[0].length }, (_, i) => `col${i + 1}`)
    const csv = toCSV([header, ...monthRows])
    fs.writeFileSync(path.join(DATA_DIR, `crime-log-${slug}.csv`), csv, 'utf8')
    console.log(`  ✅ 当前月 ${slug}：${monthRows.length} 行`)
  }
  console.log('')

  return parsedLinks
}

// 爬单个归档页
async function scrapeArchivePage(browser, href, slug) {
  const url = href.startsWith('http') ? href : `${NYU_BASE}${href}`
  console.log('打开页面：', url)

  const page = await browser.newPage()
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  )

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 })
  } catch (err) {
    await page.close()
    throw new Error(`页面加载失败：${err.message}`)
  }

  // 检查是否 404
  const is404 = await page.$('link[rel="canonical"][href*="404"]')
  if (is404) {
    console.log(`  ℹ️ ${slug} 归档页返回 404，跳过。`)
    await page.close()
    return
  }

  // 检查归档页是否也用了新 CMS 组件
  let selector = ARCHIVE_SELECTOR
  const hasNewTable = await page.$(MAIN_SELECTOR.replace(' tbody tr', ''))
  if (hasNewTable) selector = MAIN_SELECTOR

  try {
    await page.waitForSelector(selector, { timeout: 15_000 })
  } catch {
    console.warn('⚠️ 15s 内未找到表格，跳过。')
    await saveDebug(page, slug)
    await page.close()
    return
  }

  const rows = await page.$$eval(selector, (trs) =>
    trs
      .map((tr) =>
        Array.from(tr.querySelectorAll('td')).map((td) =>
          td.textContent.trim().replace(/\s+/g, ' ')
        )
      )
      .filter((row) => row.length > 0 && row.some((cell) => cell !== ''))
  )

  if (!rows || rows.length === 0) {
    console.warn('⚠️ 表格无有效行，跳过。')
    await saveDebug(page, slug)
    await page.close()
    return
  }

  console.log(`  共抓到 ${rows.length} 行`)

  const header = Array.from({ length: rows[0].length }, (_, i) => `col${i + 1}`)
  const csv = toCSV([header, ...rows])
  const filePath = path.join(DATA_DIR, `crime-log-${slug}.csv`)

  if (fs.existsSync(filePath)) console.log('  ℹ️ 覆盖已有文件')
  fs.writeFileSync(filePath, csv, 'utf8')
  console.log('  ✅ 已写入：', filePath)
  await page.close()
}

function toCSV(rows) {
  if (!rows || rows.length === 0) return ''
  return rows
    .map((cols) =>
      (cols || []).map((value) => {
        if (value == null) return '""'
        return `"${String(value).replace(/"/g, '""')}"`
      }).join(',')
    )
    .join('\n')
}

async function saveDebug(page, label) {
  try {
    const base = path.join(DATA_DIR, `debug-${label}`)
    fs.writeFileSync(`${base}.html`, await page.content(), 'utf8')
    await page.screenshot({ path: `${base}.png`, fullPage: true })
    console.log(`  📝 debug 文件已保存：${base}.html`)
  } catch (err) {
    console.warn('保存 debug 文件失败：', err.message)
  }
}

main().catch((err) => {
  console.error('脚本运行出错：', err)
  process.exit(1)
})
