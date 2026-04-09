const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const SITE_URL = 'https://knighthood-webstore.xsolla.site/';
const USER_ID = process.env.USER_ID || '';
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

if (!USER_ID) {
    console.error("❌ 未设置 USER_ID 环境变量");
    process.exit(1);
}

// ==================== 工具函数 ====================

let stepIndex = 0;

async function screenshot(page, name) {
    const file = path.join(SCREENSHOT_DIR, `${String(++stepIndex).padStart(2, '0')}-${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`📸 截图已保存: ${file}`);
}

const delay = ms => new Promise(r => setTimeout(r, ms));

async function domClick(page, el) {
    await page.evaluate(e => e.click(), el);
}

async function getCardText(page, el) {
    return page.evaluate(e => {
        const card = e.closest('.item-card, .product-card, [class*="card"]') || e.parentElement;
        return card ? card.innerText.replace(/\n/g, ' ') : '';
    }, el);
}

/**
 * 通用宝箱领取流程：点击购买按钮 → 等待 claimed-item-modal → 点击返回商店
 * @returns {boolean} 是否领取成功
 */
async function claimChest(page, chestName) {
    const claimedModal = await page.waitForSelector('[class*="claimed-item-modal"]', {
        visible: true, timeout: 15000
    }).catch(() => null);

    if (claimedModal) {
        const itemName = await page.evaluate(() => {
            const el = document.querySelector('.claimed-item-modal__item-name');
            return el ? el.innerText : '';
        });
        console.log(`✅ ${chestName}领取成功！物品: ${itemName}`);
        await screenshot(page, `${chestName}-claimed`);

        const backBtn = await page.waitForSelector(
            '.button.button--min-width.button--large.xds-text-button-md',
            { visible: true, timeout: 15000 }
        ).catch(() => null);

        if (backBtn) {
            console.log("🔹 点击返回商店...");
            await domClick(page, backBtn);
            await delay(2000);
            console.log("✅ 已返回商店");
        } else {
            console.log("ℹ️ 未找到返回商店按钮，尝试 Escape 关闭");
            await page.keyboard.press('Escape');
            await delay(1000);
        }
        await screenshot(page, `${chestName}-done`);
        return true;
    }

    console.log(`⚠️ ${chestName}未检测到 claimed-item-modal，领取可能失败`);
    const debugModals = await page.evaluate(() => {
        const all = document.querySelectorAll('[class*="modal"]');
        return Array.from(all).map(el => ({
            className: el.className,
            visible: el.offsetParent !== null || getComputedStyle(el).display !== 'none',
            text: (el.innerText || '').substring(0, 80)
        }));
    });
    console.log("🔍 页面弹窗调试:", JSON.stringify(debugModals, null, 2));
    await screenshot(page, `${chestName}-no-modal`);
    return false;
}

// ==================== 第一步：登录 ====================

async function stepLogin(page) {
    console.log("\n🔐 ===== 第一步：登录 =====");

    const loginBtn = await page.waitForSelector('.xds-button--primary', { timeout: 8000 })
        .catch(() => null);

    if (!loginBtn) {
        console.log("✅ 已登录，跳过");
        await screenshot(page, 'already-logged-in');
        return;
    }

    console.log("👉 检测到登录按钮，开始登录");
    await loginBtn.click();
    await page.waitForSelector('#user-id-input', { timeout: 60000 });

    console.log("✏️ 输入 USER_ID...");
    await page.type('#user-id-input', USER_ID, { delay: 50 });

    const confirmBtn = await page.waitForSelector('.user-id-modal__button', { timeout: 20000 });
    console.log("✅ 提交登录");
    await confirmBtn.click();

    await page.waitForSelector('.user-id-modal__button', { hidden: true, timeout: 15000 })
        .catch(() => null);
    await delay(3000);

    await page.evaluate(() => {
        document.querySelectorAll('[class*="user-id-modal"]').forEach(el => el.remove());
    });

    console.log("✅ 登录流程完成");
    await screenshot(page, 'login-complete');

    // 关闭登录成功弹窗
    const successModal = await page.$('.successful-login-modal');
    if (successModal) {
        const continueBtn = await successModal.$('button');
        if (continueBtn) {
            console.log("🔹 关闭登录成功弹窗...");
            await domClick(page, continueBtn);
            await delay(2000);
        }
    }

    // 关闭 upsell 弹窗
    const upsellClose = await page.$('.upsell-modal__close');
    if (upsellClose) {
        console.log("🔹 关闭 upsell 弹窗...");
        await domClick(page, upsellClose);
        await delay(1000);
    }
}

// ==================== 第二步：领取免费宝箱（每日） ====================

async function stepClaimDailyChest(page) {
    console.log("\n🎁 ===== 第二步：领取免费宝箱 =====");

    const buyBtn = await page.waitForSelector(
        '[id^="store-buy-button-"][id$="goldchestfree"]',
        { timeout: 60000 }
    ).catch(() => null);

    if (!buyBtn) {
        console.log("❌ 没找到免费宝箱购买按钮");
        await screenshot(page, 'daily-not-found');
        return;
    }

    const isDisabled = await page.evaluate(el => el.disabled, buyBtn);
    const cardText = await getCardText(page, buyBtn);
    console.log("🔍 状态:", isDisabled ? "已领取(按钮禁用)" : "可领取", "| 文本:", cardText.substring(0, 200));

    if (isDisabled) {
        console.log("ℹ️ 今日已领取，跳过");
        await screenshot(page, 'daily-already-claimed');
        return;
    }

    console.log("👉 点击免费宝箱购买按钮...");
    await page.evaluate(el => el.scrollIntoView({ block: 'center' }), buyBtn);
    await delay(500);
    await domClick(page, buyBtn);
    await delay(3000);
    await screenshot(page, 'daily-clicked');

    await claimChest(page, '免费宝箱');
}

// ==================== 第三步：领取每周宝箱 ====================

async function stepClaimWeeklyChest(page) {
    console.log("\n🎁 ===== 第三步：领取每周宝箱 =====");

    const buyBtn = await page.$('[id$="webstore_gemchestfree"]');

    if (!buyBtn) {
        console.log("❌ 没找到每周宝箱按钮");
        await screenshot(page, 'weekly-not-found');
        return;
    }

    const cardText = await getCardText(page, buyBtn);
    const isClaimed = cardText.includes('Claimed');
    console.log("🔍 状态:", isClaimed ? "已领取" : "可领取", "| 文本:", cardText.substring(0, 200));

    if (isClaimed) {
        console.log("ℹ️ 本周已领取，跳过");
        await screenshot(page, 'weekly-already-claimed');
        return;
    }

    console.log("👉 点击每周宝箱购买按钮...");
    await page.evaluate(el => el.scrollIntoView({ block: 'center' }), buyBtn);
    await delay(500);
    await domClick(page, buyBtn);
    await delay(3000);
    await screenshot(page, 'weekly-clicked');

    await claimChest(page, '每周宝箱');
}

// ==================== 主流程 ====================

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
    await page.goto(SITE_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await screenshot(page, 'page-loaded');

    await stepLogin(page);
    await stepClaimDailyChest(page);
    await stepClaimWeeklyChest(page);

    await screenshot(page, 'task-complete');
    console.log("\n🏁 全部任务完成");
    await browser.close();
})();
