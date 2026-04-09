const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const URL = 'https://knighthood-webstore.xsolla.site/';
const USER_ID = process.env.USER_ID || '';
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
fs.mkdirSync(SCREENSHOT_DIR, {recursive: true});

let stepIndex = 0;

async function screenshot(page, name) {
    const file = path.join(SCREENSHOT_DIR, `${String(++stepIndex).padStart(2, '0')}-${name}.png`);
    await page.screenshot({path: file, fullPage: true});
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
    await page.setViewport({width: 1280, height: 800});

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

        await page.waitForSelector('#user-id-input', {timeout: 60000});

        console.log("✏️ 输入 USER_ID...");
        await page.type('#user-id-input', USER_ID, {delay: 50});

        const confirmBtn = await page.waitForSelector('.user-id-modal__button', {
            timeout: 20000
        });

        console.log("✅ 提交登录");
        await confirmBtn.click();

        await page.waitForSelector('.user-id-modal__button', {hidden: true, timeout: 15000})
            .catch(() => null);
        await new Promise(r => setTimeout(r, 3000));

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
                console.log("🔹 关闭登录成功弹窗（点击 Continue）...");
                await page.evaluate(el => el.click(), continueBtn);
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        // 关闭 upsell 弹窗（如果出现）
        const upsellClose = await page.$('.upsell-modal__close');
        if (upsellClose) {
            console.log("🔹 关闭 upsell 弹窗...");
            await page.evaluate(el => el.click(), upsellClose);
            await new Promise(r => setTimeout(r, 1000));
        }
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
            await page.evaluate(el => el.scrollIntoView({ block: 'center' }), buyBtn);
            await new Promise(r => setTimeout(r, 500));
            await page.evaluate(el => el.click(), buyBtn);
            await new Promise(r => setTimeout(r, 3000));
            await screenshot(page, 'free-chest-clicked');

            // 点击后等待 claimed-item-modal（领取成功的确认弹窗）
            const claimedModal = await page.waitForSelector('[class*="claimed-item-modal"]', {
                visible: true,
                timeout: 15000
            }).catch(() => null);

            if (claimedModal) {
                const itemName = await page.evaluate(() => {
                    const el = document.querySelector('.claimed-item-modal__item-name');
                    return el ? el.innerText : '';
                });
                console.log("✅ 免费宝箱领取成功！物品:", itemName);
                await screenshot(page, 'free-chest-claimed');

                // 点击 "Back to store" 返回商店
                const backBtn = await page.waitForSelector(
                    '.button.button--min-width.button--large.xds-text-button-md',
                    { visible: true, timeout: 15000 }
                ).catch(() => null);

                if (backBtn) {
                    console.log("🔹 点击返回商店...");
                    await page.evaluate(el => el.click(), backBtn);
                    await new Promise(r => setTimeout(r, 2000));
                    console.log("✅ 已返回商店");
                } else {
                    console.log("ℹ️ 未找到返回商店按钮，尝试 Escape 关闭");
                    await page.keyboard.press('Escape');
                    await new Promise(r => setTimeout(r, 1000));
                }
                await screenshot(page, 'free-chest-done');
            } else {
                console.log("⚠️ 未检测到 claimed-item-modal，领取可能失败");
                // 调试：输出当前页面所有弹窗
                const debugModals = await page.evaluate(() => {
                    const all = document.querySelectorAll('[class*="modal"]');
                    return Array.from(all).map(el => ({
                        className: el.className,
                        visible: el.offsetParent !== null || getComputedStyle(el).display !== 'none',
                        text: (el.innerText || '').substring(0, 80)
                    }));
                });
                console.log("🔍 页面弹窗调试:", JSON.stringify(debugModals, null, 2));
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
