const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const URL = 'https://knighthood-webstore.xsolla.site/';
const USER_ID = process.env.USER_ID || '';
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

let stepIndex = 0;
async function screenshot(page, name) {
  const file = path.join(SCREENSHOT_DIR, `${String(++stepIndex).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`📸 截图已保存: ${file}`);
}

if (!USER_ID) {
  console.error("❌ 未设置 USER_ID 环境变量");
  process.exit(1);
}

(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  page.on('response', async (response) => {
    try {
      const url = response.url();
      if (url.includes('purchase') || url.includes('order')) {
        const text = await response.text();
        console.log("📦 接口返回:", text.substring(0, 300));
        if (text.includes('success') || text.includes('completed')) {
          console.log("✅ 接口确认：领取成功");
        }
      }
    } catch (e) {
      console.warn("⚠️ 响应监听异常:", e.message);
    }
  });

  console.log("🌍 打开页面...");
  await page.goto(URL, {
    waitUntil: 'networkidle2',
    timeout: 60000
  });
  await screenshot(page, 'page-loaded');

  // ===== 登录流程 =====
  console.log("🔐 检查是否需要登录...");

  const loginBtn = await page.waitForSelector('.xds-button--primary', {
    timeout: 8000
  }).catch(() => null);

  if (loginBtn) {
    console.log("👉 检测到登录按钮，开始登录");
    await loginBtn.click();

    await page.waitForSelector('#user-id-input', { timeout: 60000 });

    console.log("✏️ 输入 USER_ID...");
    await page.type('#user-id-input', USER_ID, { delay: 50 });

    const confirmBtn = await page.waitForSelector('.user-id-modal__button', {
      timeout: 20000
    });

    console.log("✅ 提交登录");
    await confirmBtn.click();

    await page.waitForSelector('.user-id-modal__button', { hidden: true, timeout: 15000 })
      .catch(() => null);
    await new Promise(r => setTimeout(r, 3000));

    await page.evaluate(() => {
      document.querySelectorAll('[class*="user-id-modal"]').forEach(el => el.remove());
    });

    console.log("✅ 登录流程完成");
    await screenshot(page, 'login-complete');
  } else {
    console.log("✅ 已登录");
    await screenshot(page, 'already-logged-in');
  }

  // ===== 免费宝箱 =====
  console.log("🎁 检查免费宝箱...");

  const buyBtn = await page.waitForSelector('[id^="store-buy-button-"][id$="goldchestfree"]', {
    timeout: 60000
  }).catch(() => null);

  if (buyBtn) {
    const isDisabled = await page.evaluate(el => el.disabled, buyBtn);
    const freeText = await page.evaluate(el => {
      const card = el.closest('.item-card, .product-card, [class*="card"]') || el.parentElement;
      return card ? card.innerText : '';
    }, buyBtn);
    console.log("🔍 免费宝箱状态:", isDisabled ? "已领取(按钮禁用)" : "可领取", "| 文本:", freeText.replace(/\n/g, ' ').substring(0, 200));

    if (!isDisabled) {
      console.log("👉 点击免费宝箱购买按钮...");
      await buyBtn.click();
      await screenshot(page, 'free-chest-clicked');

      const freeModal = await page.waitForSelector('.free-item-modal', {
        timeout: 60000
      }).catch(() => null);

      if (freeModal) {
        console.log("✅ 免费宝箱弹窗已出现");
        await screenshot(page, 'free-chest-modal');

        const confirmBtn = await freeModal.$('.simple-button, .xds-button');
        if (confirmBtn) {
          console.log("🔹 点击领取确认按钮...");
          await confirmBtn.click();
          await new Promise(r => setTimeout(r, 2000));
          await screenshot(page, 'free-chest-confirmed');
        } else {
          console.log("⚠️ 未找到确认按钮");
          await screenshot(page, 'free-chest-no-confirm');
        }

        const backToStoreBtn = await page.waitForSelector(
          '.button.button--min-width.button--large.xds-text-button-md',
          { timeout: 60000 }
        ).catch(() => null);

        if (backToStoreBtn) {
          console.log("🔹 点击返回商店...");
          await backToStoreBtn.click();
          await new Promise(r => setTimeout(r, 2000));
          console.log("✅ 免费宝箱领取完成，已返回商店");
          await screenshot(page, 'free-chest-success');
        } else {
          console.log("⚠️ 未找到返回商店按钮");
          await screenshot(page, 'free-chest-no-back-btn');
        }
      } else {
        console.log("⚠️ 未检测到免费宝箱弹窗（可能领取失败）");
        await screenshot(page, 'free-chest-no-modal');
      }
    } else {
      console.log("ℹ️ 免费宝箱今日已领取（按钮禁用），跳过");
      await screenshot(page, 'free-chest-already-claimed');
    }
  } else {
    console.log("❌ 没找到免费宝箱购买按钮");
    await screenshot(page, 'free-chest-not-found');
  }

  // ===== 每周宝箱 =====
  console.log("🎁 检查每周宝箱...");

  const weekBtn = await page.$('[id$="webstore_gemchestfree"]');

  if (weekBtn) {
    const weekText = await page.evaluate(el => {
      const card = el.closest('.item-card, .product-card, [class*="card"]') || el.parentElement;
      return card ? card.innerText : '';
    }, weekBtn);

    const weekClaimed = weekText.includes('Claimed');
    console.log("🔍 每周宝箱状态:", weekClaimed ? "已领取" : "可领取", "| 文本:", weekText.replace(/\n/g, ' ').substring(0, 200));

    if (!weekClaimed) {
      console.log("👉 准备领取 每周宝箱");
      await weekBtn.click();
      await new Promise(r => setTimeout(r, 3000));
      await screenshot(page, 'weekly-chest-clicked');

      const weekModalHandle = await page.evaluateHandle(() => {
        const selectors = '[class*="upsell-modal"], [class*="free-item"], .ui-site-modal-window';
        const elements = document.querySelectorAll(selectors);
        for (const el of elements) {
          if (el.className.includes('user-id-modal')) continue;
          if (el.offsetParent !== null || getComputedStyle(el).display !== 'none') return el;
        }
        return null;
      });

      const weekModal = weekModalHandle.asElement();

      if (weekModal) {
        console.log("✅ 每周宝箱领取成功");
        await screenshot(page, 'weekly-chest-success');
        try {
          const closeBtn = await page.$('.ui-site-modal-window__close, [class*="modal-window__close"], [class*="modal__close"]');
          if (closeBtn) {
            await closeBtn.click();
          } else {
            await page.keyboard.press('Escape');
          }
        } catch (e) {
          await page.keyboard.press('Escape');
        }
      } else {
        console.log("⚠️ 每周宝箱领取后未检测到弹窗（可能已领取或领取失败）");
        await screenshot(page, 'weekly-chest-no-modal');
      }
    } else {
      console.log("ℹ️ 每周宝箱本周已领取，跳过");
      await screenshot(page, 'weekly-chest-already-claimed');
    }
  } else {
    console.log("❌ 没找到每周宝箱按钮");
    await screenshot(page, 'weekly-chest-not-found');
  }

  await screenshot(page, 'task-complete');
  console.log("🏁 任务完成");
  await browser.close();
})();
