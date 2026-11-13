'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.GOMOKU_URL || 'http://127.0.0.1:3000';
const OUT_DIR = path.join(__dirname, '..', 'artifacts');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CDP {
  constructor(wsUrl) {
    this.nextId = 1;
    this.pending = new Map();
    this.issues = [];
    this.ws = new WebSocket(wsUrl);
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.exceptionThrown') {
        this.issues.push(
          message.params.exceptionDetails?.exception?.description ||
            message.params.exceptionDetails?.text ||
            'Runtime exception'
        );
      }
      if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
        this.issues.push(message.params.entry.text);
      }
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'evaluate failed');
    }
    return result.result.value;
  }

  async waitFor(expression, timeout = 6000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        if (await this.evaluate(expression)) return true;
      } catch {
        // The page may be navigating.
      }
      await sleep(100);
    }
    throw new Error(`waitFor timeout: ${expression}`);
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
    await this.waitFor("document.readyState === 'complete'");
    await sleep(350);
  }

  async screenshot(fileName) {
    const { data } = await this.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    await fs.writeFile(path.join(OUT_DIR, fileName), Buffer.from(data, 'base64'));
  }
}

async function launchChrome(port, width, height) {
  const profile = path.join(OUT_DIR, `chrome-profile-${port}`);
  await fs.rm(profile, { recursive: true, force: true });
  const child = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--remote-allow-origins=*',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  const endpoint = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${endpoint}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === 'page');
      if (page) return { child, wsUrl: page.webSocketDebuggerUrl };
    } catch {
      // Chrome is still starting.
    }
    await sleep(200);
  }
  child.kill();
  throw new Error('Chrome did not start');
}

async function makePage(port, name, width, height, mobile = false) {
  const chrome = await launchChrome(port, width, height);
  const cdp = new CDP(chrome.wsUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
    screenWidth: width,
    screenHeight: height,
  });
  await cdp.navigate(BASE + '/');
  return { name, chrome, cdp };
}

async function setInput(cdp, selector, value) {
  await cdp.evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
}

async function clickSelectors(cdp, selectors) {
  await cdp.evaluate(`(() => {
    const selectors = ${JSON.stringify(selectors)};
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node) node.click();
    }
  })()`);
}

async function waitForText(cdp, selector, text, timeout = 6000) {
  await cdp.waitFor(
    `document.querySelector(${JSON.stringify(selector)})?.textContent.trim() === ${JSON.stringify(text)}`,
    timeout
  );
}

async function clickGomokuCell(cdp, row, col) {
  await cdp.evaluate(
    `document.querySelector('.cell[data-row="${row}"][data-col="${col}"]').click()`
  );
}

async function clickCheckersHole(cdp, index) {
  await cdp.evaluate(`(() => {
    const hit = document.querySelector('.checkers-hole[data-index="${index}"] .checkers-hole-hit');
    hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  })()`);
}

async function clearToasts(cdp) {
  await cdp.evaluate('document.querySelectorAll(".toast").forEach((node) => node.remove())');
}

async function metrics(cdp) {
  return cdp.evaluate(
    'JSON.stringify({innerWidth, innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight})'
  );
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const pages = [];
  try {
    const desktop = await makePage(9441, 'desktop', 1440, 1000, false);
    pages.push(desktop);
    const mobile = await makePage(9442, 'mobile', 390, 844, true);
    pages.push(mobile);

    await desktop.cdp.screenshot('home-desktop.png');
    await desktop.cdp.evaluate('document.querySelector("[data-game=checkers]").click()');
    await sleep(350);
    await desktop.cdp.screenshot('home-checkers.png');
    await desktop.cdp.evaluate('document.querySelector("[data-game=gomoku]").click()');
    await sleep(300);
    await mobile.cdp.screenshot('home-mobile.png');
    console.log('home metrics', await metrics(desktop.cdp), await metrics(mobile.cdp));

    await setInput(desktop.cdp, '#nameInput', '小林');
    await clickSelectors(desktop.cdp, ['#createButton']);
    await desktop.cdp.waitFor('document.querySelector("#gameScreen").hidden === false');
    const gomokuCode = await desktop.cdp.evaluate(
      'document.querySelector("#roomCodeLabel").textContent.trim()'
    );
    await waitForText(desktop.cdp, '#statusTitle', '等待棋友入座');
    await desktop.cdp.screenshot('gomoku-waiting.png');

    await mobile.cdp.navigate(`${BASE}/?room=${gomokuCode}`);
    await setInput(mobile.cdp, '#joinNameInput', '阿青');
    await clickSelectors(mobile.cdp, ['#joinButton']);
    await mobile.cdp.waitFor('document.querySelector("#gameScreen").hidden === false');
    await waitForText(mobile.cdp, '#statusTitle', '等待对手落子');
    await waitForText(desktop.cdp, '#statusTitle', '轮到你落子');

    const gomokuMoves = [
      [desktop, 7, 7],
      [mobile, 8, 7],
      [desktop, 7, 8],
      [mobile, 8, 8],
      [desktop, 7, 9],
      [mobile, 8, 9],
      [desktop, 7, 10],
      [mobile, 8, 10],
      [desktop, 7, 11],
    ];
    for (let index = 0; index < gomokuMoves.length; index += 1) {
      const [page, row, col] = gomokuMoves[index];
      await waitForText(page.cdp, '#statusTitle', '轮到你落子');
      await clickGomokuCell(page.cdp, row, col);
      await desktop.cdp.waitFor(
        `Number(document.querySelector("#moveCountLabel").textContent) === ${index + 1}`
      );
      if (index === 5) {
        await clearToasts(desktop.cdp);
        await clearToasts(mobile.cdp);
        await desktop.cdp.screenshot('game-desktop.png');
        await mobile.cdp.screenshot('game-mobile.png');
      }
    }
    await waitForText(desktop.cdp, '#statusTitle', '你赢了');
    await sleep(1200);
    await clearToasts(desktop.cdp);
    await desktop.cdp.screenshot('result-desktop.png');

    // Start over on the home screen for Chinese checkers.
    await desktop.cdp.navigate(BASE + '/');
    await mobile.cdp.navigate(BASE + '/');
    await desktop.cdp.evaluate('document.querySelector("[data-game=checkers]").click()');
    await setInput(desktop.cdp, '#nameInput', '小林');
    await clickSelectors(desktop.cdp, ['#createButton']);
    await desktop.cdp.waitFor('document.querySelector("#gameScreen").hidden === false');
    const checkersCode = await desktop.cdp.evaluate(
      'document.querySelector("#roomCodeLabel").textContent.trim()'
    );
    await waitForText(desktop.cdp, '#statusTitle', '等待棋友入座');
    await desktop.cdp.waitFor(
      'document.querySelector("#checkersShell").hidden === false'
    );
    await desktop.cdp.screenshot('checkers-waiting.png');

    await mobile.cdp.navigate(`${BASE}/?room=${checkersCode}`);
    await setInput(mobile.cdp, '#joinNameInput', '阿青');
    await clickSelectors(mobile.cdp, ['#joinButton']);
    await mobile.cdp.waitFor('document.querySelector("#gameScreen").hidden === false');
    await waitForText(desktop.cdp, '#statusTitle', '轮到你走棋');
    await waitForText(mobile.cdp, '#statusTitle', '等待对手走棋');
    await clearToasts(desktop.cdp);
    await clearToasts(mobile.cdp);
    await desktop.cdp.screenshot('checkers-desktop.png');
    await mobile.cdp.screenshot('checkers-mobile.png');

    // Deterministic opening that sets up a multi-jump for black:
    // black 61->34, white 91->26, then black jumps 63->61->25.
    await clickCheckersHole(desktop.cdp, 61);
    await clickCheckersHole(desktop.cdp, 34);
    await desktop.cdp.waitFor('document.querySelector("#moveCountLabel").textContent === "1"');
    await waitForText(mobile.cdp, '#statusTitle', '轮到你走棋');
    await clickCheckersHole(mobile.cdp, 91);
    await clickCheckersHole(mobile.cdp, 26);
    await desktop.cdp.waitFor('document.querySelector("#moveCountLabel").textContent === "2"');
    await waitForText(desktop.cdp, '#statusTitle', '轮到你走棋');

    await clickCheckersHole(desktop.cdp, 63);
    await desktop.cdp.waitFor(
      'document.querySelectorAll(".checkers-marker-step, .checkers-marker-jump").length > 0'
    );
    await desktop.cdp.screenshot('checkers-selection.png');
    await clickCheckersHole(desktop.cdp, 61);
    await desktop.cdp.waitFor(
      'document.querySelector("#chainBar") && document.querySelector("#chainBar").hidden === false'
    );
    await desktop.cdp.screenshot('checkers-chain.png');
    console.log(
      'chain state:',
      await desktop.cdp.evaluate(
        'JSON.stringify({count: document.querySelector("#chainCount").textContent, text: document.querySelector("#statusSub").textContent, rect: document.querySelector("#chainBar").getBoundingClientRect().toJSON(), position: getComputedStyle(document.querySelector("#chainBar")).position})'
      )
    );
    await clickSelectors(desktop.cdp, ['#endChainButton']);
    await desktop.cdp.waitFor('document.querySelector("#moveCountLabel").textContent === "3"');
    await waitForText(desktop.cdp, '#statusTitle', '等待对手走棋');
    await waitForText(mobile.cdp, '#statusTitle', '轮到你走棋');
    await sleep(500);
    await clearToasts(desktop.cdp);
    await desktop.cdp.screenshot('checkers-after-move.png');

    await desktop.cdp.send('Page.reload', { ignoreCache: true });
    await desktop.cdp.waitFor("document.readyState === 'complete'", 8000);
    await desktop.cdp.waitFor(
      'document.querySelector("#gameScreen") && document.querySelector("#gameScreen").hidden === false',
      10_000
    );
    await desktop.cdp.waitFor(
      'document.querySelector("#checkersShell") && document.querySelector("#checkersShell").hidden === false',
      6000
    );
    await desktop.cdp.waitFor(
      'document.querySelector("#moveCountLabel").textContent === "3"',
      6000
    );
    await waitForText(desktop.cdp, '#statusTitle', '等待对手走棋');
    console.log(
      'checkers reload:',
      await desktop.cdp.evaluate(
        'document.querySelector("#roomCodeLabel").textContent.trim() + " / " + document.querySelector("#moveCountLabel").textContent + " / " + document.querySelector("#checkersShell").hidden'
      )
    );

    console.log(
      'checkers metrics',
      await metrics(desktop.cdp),
      await metrics(mobile.cdp)
    );
    console.log(
      'checkers markers after move:',
      await desktop.cdp.evaluate(
        'document.querySelectorAll(".checkers-marker-step, .checkers-marker-jump").length'
      )
    );

    await desktop.cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1366,
      height: 768,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: 1366,
      screenHeight: 768,
    });
    await sleep(450);
    await clearToasts(desktop.cdp);
    await desktop.cdp.screenshot('checkers-laptop.png');
    console.log('laptop metrics', await metrics(desktop.cdp));

    for (const page of pages) {
      if (page.cdp.issues.length > 0) {
        console.log(`${page.name} console issues:`, page.cdp.issues);
      }
    }
    console.log('screenshots written to', OUT_DIR);
  } finally {
    for (const page of pages) {
      try {
        page.cdp.ws.close();
      } catch {}
      page.chrome.child.kill();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
