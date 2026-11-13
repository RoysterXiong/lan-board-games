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
        // Navigating.
      }
      await sleep(100);
    }
    throw new Error(`waitFor timeout: ${expression}`);
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
    await this.waitFor("document.readyState === 'complete'");
    await sleep(400);
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
      // Starting.
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

async function click(cdp, selector) {
  await cdp.evaluate(
    `document.querySelector(${JSON.stringify(selector)})?.click()`
  );
}

async function waitText(cdp, selector, text, timeout = 6000) {
  await cdp.waitFor(
    `document.querySelector(${JSON.stringify(selector)})?.textContent.trim() === ${JSON.stringify(text)}`,
    timeout
  );
}

async function clearToasts(cdp) {
  await cdp.evaluate('document.querySelectorAll(".toast").forEach((node) => node.remove())');
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const pages = [];
  try {
    const desktop = await makePage(9431, 'desktop', 1440, 1000, false);
    pages.push(desktop);
    const mobile = await makePage(9432, 'mobile', 390, 844, true);
    pages.push(mobile);

    await mobile.cdp.evaluate('document.querySelector("[data-game=poker]").click()');
    await sleep(300);
    await mobile.cdp.screenshot('poker-home-mobile.png');
    console.log(
      'mobile home metrics',
      await mobile.cdp.evaluate(
        'JSON.stringify({w:innerWidth,h:innerHeight,sh:document.documentElement.scrollHeight,choices:document.querySelectorAll(".game-choice").length,stackHidden:document.querySelector("#pokerStackPicker").hidden})'
      )
    );

    await desktop.cdp.evaluate('document.querySelector("[data-game=poker]").click()');
    await sleep(350);
    await desktop.cdp.screenshot('poker-home.png');
    console.log(
      'stack picker visible',
      await desktop.cdp.evaluate(
        'document.querySelector("#pokerStackPicker").hidden === false'
      )
    );
    console.log(
      'home metrics',
      await desktop.cdp.evaluate(
        'JSON.stringify({w:innerWidth,h:innerHeight,sh:document.documentElement.scrollHeight})'
      )
    );

    await setInput(desktop.cdp, '#nameInput', '小林');
    await click(desktop.cdp, '#createButton');
    await desktop.cdp.waitFor('document.querySelector("#gameScreen").hidden === false');
    await desktop.cdp.waitFor('document.querySelector("#pokerShell").hidden === false');
    const roomCode = await desktop.cdp.evaluate(
      'document.querySelector("#roomCodeLabel").textContent.trim()'
    );
    console.log('room', roomCode);
    await waitText(desktop.cdp, '#pokerLockTitle', '等待对手入座');
    await desktop.cdp.screenshot('poker-waiting.png');

    await mobile.cdp.navigate(`${BASE}/?room=${roomCode}`);
    await setInput(mobile.cdp, '#joinNameInput', '阿青');
    await click(mobile.cdp, '#joinButton');
    await mobile.cdp.waitFor('document.querySelector("#gameScreen").hidden === false');
    await desktop.cdp.waitFor('document.querySelector("#pokerLock").hidden === true');
    await waitText(desktop.cdp, '#statusTitle', '轮到你行动');
    await waitText(mobile.cdp, '#statusTitle', '等待对手行动');
    await clearToasts(desktop.cdp);
    await clearToasts(mobile.cdp);
    await desktop.cdp.screenshot('poker-desktop.png');
    await mobile.cdp.screenshot('poker-mobile.png');

    // Turn on the right-side GTO coach.
    await click(desktop.cdp, '#gtoToggle');
    await desktop.cdp.waitFor(
      'document.querySelector("#gtoBody").hidden === false && document.querySelector("#gtoAction").textContent.trim() !== "—"'
    );
    console.log(
      'gto:',
      await desktop.cdp.evaluate(
        'JSON.stringify({action:document.querySelector("#gtoAction").textContent, reason:document.querySelector("#gtoReason").textContent, equity:document.querySelector("#gtoEquity").textContent})'
      )
    );
    await desktop.cdp.screenshot('poker-gto.png');

    // Host calls the small blind; guest checks to the flop.
    await click(desktop.cdp, '#pokerCallButton');
    await waitText(mobile.cdp, '#statusTitle', '轮到你行动');
    await click(mobile.cdp, '#pokerCheckButton');
    await desktop.cdp.waitFor(
      'document.querySelectorAll("#pokerCommunity .playing-card:not(.is-empty)").length === 3'
    );
    await waitText(mobile.cdp, '#statusTitle', '轮到你行动');
    await waitText(desktop.cdp, '#statusTitle', '等待对手行动');
    await sleep(300);
    await clearToasts(desktop.cdp);
    await desktop.cdp.screenshot('poker-flop.png');

    // Guest opens the betting UI, picks a half-pot bet and sends it.
    await click(mobile.cdp, '#pokerRaiseToggle');
    await mobile.cdp.waitFor('document.querySelector("#pokerRaiseBox").hidden === false');
    await mobile.cdp.evaluate(
      'document.querySelector(".poker-raise-presets button[data-size=\\"0.5\\"]").click()'
    );
    const raiseAmount = await mobile.cdp.evaluate(
      'document.querySelector("#pokerRaiseAmount").textContent'
    );
    console.log('raise amount', raiseAmount);
    await click(mobile.cdp, '#pokerRaiseConfirm');
    await waitText(desktop.cdp, '#statusTitle', '轮到你行动');
    await click(desktop.cdp, '#pokerCallButton');
    await desktop.cdp.waitFor(
      'document.querySelectorAll("#pokerCommunity .playing-card:not(.is-empty)").length === 4'
    );
    await desktop.cdp.waitFor(
      'document.querySelector("#statusTitle").textContent === "等待对手行动"'
    );
    await sleep(350);
    await clearToasts(desktop.cdp);
    await desktop.cdp.screenshot('poker-turn.png');

    // Check through to the river for a visual of a complete board.
    await click(mobile.cdp, '#pokerCheckButton');
    await waitText(desktop.cdp, '#statusTitle', '轮到你行动');
    await click(desktop.cdp, '#pokerCheckButton');
    await desktop.cdp.waitFor(
      'document.querySelectorAll("#pokerCommunity .playing-card:not(.is-empty)").length === 5'
    );
    await sleep(300);
    await clearToasts(desktop.cdp);
    await desktop.cdp.screenshot('poker-river.png');
    console.log(
      'river UI',
      await desktop.cdp.evaluate(
        'JSON.stringify({pot:document.querySelector("#pokerPot").textContent, stage:document.querySelector("#pokerStageLabel").textContent, buttons:[...document.querySelectorAll("#pokerCallButton,#pokerCheckButton,#pokerRaiseToggle")].map(b=>({id:b.id,disabled:b.disabled,text:b.textContent.trim()}))})'
      )
    );

    // Check the river through to a showdown and inspect the result panel.
    await click(mobile.cdp, '#pokerCheckButton');
    await waitText(desktop.cdp, '#statusTitle', '轮到你行动');
    await click(desktop.cdp, '#pokerCheckButton');
    await desktop.cdp.waitFor(
      'document.querySelector("#pokerResultPanel").hidden === false'
    );
    await sleep(350);
    await desktop.cdp.screenshot('poker-showdown.png');
    console.log(
      'showdown',
      await desktop.cdp.evaluate(
        'JSON.stringify({title:document.querySelector("#pokerResultTitle").textContent, detail:document.querySelector("#pokerResultDetail").textContent, hands:document.querySelector("#pokerResultHands").textContent, countdown:document.querySelector("#pokerResultCountdown").textContent, gto:document.querySelector("#gtoAction").textContent, board:document.querySelectorAll("#pokerCommunity .playing-card:not(.is-empty)").length})'
      )
    );
    await mobile.cdp.screenshot('poker-showdown-mobile.png');

    // Wait for the automatic next hand.
    await desktop.cdp.waitFor(
      'document.querySelector("#pokerResultPanel").hidden === true && document.querySelector("#pokerStageLabel").textContent === "翻牌前"',
      9000
    );
    await sleep(350);
    await clearToasts(desktop.cdp);
    await desktop.cdp.screenshot('poker-next-hand.png');
    console.log(
      'next hand',
      await desktop.cdp.evaluate(
        'JSON.stringify({round:document.querySelector("#roundLabel").textContent, heroPos:document.querySelector("#pokerHeroPosition").textContent, oppPos:document.querySelector("#pokerOpponentPosition").textContent, status:document.querySelector("#statusTitle").textContent})'
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
    await desktop.cdp.screenshot('poker-laptop.png');
    console.log(
      'laptop metrics',
      await desktop.cdp.evaluate(
        'JSON.stringify({w:innerWidth,h:innerHeight,sh:document.documentElement.scrollHeight,side:document.querySelector(".side-panel").getBoundingClientRect().toJSON(),table:document.querySelector(".poker-table").getBoundingClientRect().toJSON()})'
      )
    );

    // Short-stack all-in: verify match end, result bar, and rematch.
    await desktop.cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: 1440,
      screenHeight: 1000,
    });
    await click(desktop.cdp, '#leaveLink');
    await desktop.cdp.waitFor('document.querySelector("#confirmDialog").open === true');
    await click(desktop.cdp, '#dialogConfirmButton');
    await desktop.cdp.waitFor('document.querySelector("#homeScreen").hidden === false');
    await mobile.cdp.navigate(BASE + '/');
    await desktop.cdp.evaluate('document.querySelector("[data-game=poker]").click()');
    await click(desktop.cdp, '.stack-option[data-stack="20"]');
    await setInput(desktop.cdp, '#nameInput', '小满');
    await click(desktop.cdp, '#createButton');
    await desktop.cdp.waitFor('document.querySelector("#gameScreen").hidden === false');
    const shortCode = await desktop.cdp.evaluate(
      'document.querySelector("#roomCodeLabel").textContent.trim()'
    );
    await mobile.cdp.navigate(`${BASE}/?room=${shortCode}`);
    await setInput(mobile.cdp, '#joinNameInput', '阿七');
    await click(mobile.cdp, '#joinButton');
    await mobile.cdp.waitFor('document.querySelector("#gameScreen").hidden === false');
    await waitText(desktop.cdp, '#statusTitle', '轮到你行动');
    await click(desktop.cdp, '#pokerRaiseToggle');
    await desktop.cdp.waitFor('document.querySelector("#pokerRaiseBox").hidden === false');
    await click(desktop.cdp, '.poker-raise-presets button[data-size="allin"]');
    await click(desktop.cdp, '#pokerRaiseConfirm');
    await waitText(mobile.cdp, '#statusTitle', '轮到你行动');
    await click(mobile.cdp, '#pokerCallButton');
    await desktop.cdp.waitFor(
      'document.querySelector("#pokerResultPanel").hidden === false && document.querySelector("#statusKicker").textContent === "MATCH OVER"'
    );
    await sleep(350);
    await clearToasts(desktop.cdp);
    await desktop.cdp.screenshot('poker-match-end.png');
    console.log(
      'match end',
      await desktop.cdp.evaluate(
        'JSON.stringify({status:document.querySelector("#statusTitle").textContent, sub:document.querySelector("#statusSub").textContent, result:document.querySelector("#pokerResultTitle").textContent, buttons:[...document.querySelectorAll("#primaryAction,#secondaryAction")].map(b=>({text:b.textContent.trim(),hidden:b.hidden,disabled:b.disabled})), pot:document.querySelector("#pokerPot").textContent})'
      )
    );

    await click(desktop.cdp, '#primaryAction');
    await click(mobile.cdp, '#primaryAction');
    await desktop.cdp.waitFor(
      'document.querySelector("#pokerResultPanel").hidden === true && document.querySelector("#pokerStageLabel").textContent === "翻牌前"',
      6000
    );
    await sleep(300);
    await clearToasts(desktop.cdp);
    await desktop.cdp.screenshot('poker-rematch.png');
    console.log(
      'rematch',
      await desktop.cdp.evaluate(
        'JSON.stringify({hand:document.querySelector("#moveCountLabel").textContent, hero:document.querySelector("#pokerHeroStack").textContent, opponent:document.querySelector("#pokerOpponentStack").textContent, status:document.querySelector("#statusTitle").textContent})'
      )
    );

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
  console.error('FAILED', error);
  process.exitCode = 1;
});
