// Play a built course's #selfcheck in headless Chrome at 400px, then reload
// and read the map's resume card. Driven over the DevTools protocol, because
// the command line cannot make a headless window narrower than 500px.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const pf = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)
const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/snap/bin/chromium', '/usr/bin/microsoft-edge',
  ...pf.flatMap(p => [join(p, 'Google/Chrome/Application/chrome.exe'), join(p, 'Microsoft/Edge/Application/msedge.exe')]),
]

export const findChrome = () => CANDIDATES.find(p => p && existsSync(p))

export async function selfcheck(file, { chrome = findChrome(), width = 400, timeoutMs = 180_000 } = {}) {
  if (!chrome) throw new Error('no Chrome, Chromium or Edge found; set CHROME_PATH')
  if (typeof WebSocket !== 'function') throw new Error(`Node ${process.versions.node} has no WebSocket; Node 22 or later runs the self-check`)
  const profile = mkdtempSync(join(tmpdir(), 'selfcheck-'))
  const proc = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' })
  try {
    let port
    for (let i = 0; i < 200 && !port; i++) {
      await sleep(100)
      const f = join(profile, 'DevToolsActivePort')
      if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0]
    }
    if (!port) throw new Error(`${chrome} did not start its DevTools port`)
    const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page')
    const ws = new WebSocket(page.webSocketDebuggerUrl), waiting = new Map()
    await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no })
    ws.onmessage = e => { const m = JSON.parse(e.data); waiting.get(m.id)?.(m.result); waiting.delete(m.id) }
    let id = 0
    const send = (method, params = {}) => new Promise(r => { waiting.set(++id, r); ws.send(JSON.stringify({ id, method, params })) })
    const until = async (expr, what) => {
      for (const end = Date.now() + timeoutMs; Date.now() < end; await sleep(100)) {
        const v = (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.value
        if (v) return v
      }
      throw new Error(`timed out after ${timeoutMs / 1000}s waiting for ${what}`)
    }
    await send('Emulation.setDeviceMetricsOverride', { width, height: 860, deviceScaleFactor: 1, mobile: false })
    await send('Page.navigate', { url: `${pathToFileURL(file)}#selfcheck` })
    const report = await until("document.title.startsWith('Self-check') && document.getElementById('selfcheck')?.textContent", 'the self-check report')
    await send('Page.reload')
    const resume = await until("document.getElementById('resume')?.innerText", 'the map\'s resume card after the reload')
    ws.close()
    return { report, resume: resume.replace(/\s+/g, ' ').trim() }
  } finally {
    proc.kill()
    await sleep(200)
    rmSync(profile, { recursive: true, force: true })
  }
}

// The report names the lesson and card the reload should resume at.
export function resumeMatches(report, resume) {
  const m = report.match(/"Continue where you left off" for "([^"]+)", card (\d+) of (\d+)/)
  return !!m && resume.includes('Continue where you left off') && resume.includes(m[1]) && resume.includes(`Card ${m[2]} of ${m[3]}`)
}
