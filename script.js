const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const START_URL = 'https://plan.yoga-go.io/onboarding';
const NEXT_URL = 'https://example.com/next-page';
const SEEN_VALUES_FILE = path.resolve(__dirname, 'seen_values.json');
const SCREENSHOT_FILE = path.resolve(__dirname, 'element.png');
const API_ENDPOINT = 'wellfunnel-web-api.asqq.io/get-default-config/';
const TARGET_FIELD = 'some_field';
const TARGET_SELECTOR = '#target-element';
const WAIT_TIME_MS = 20000; // 1 minute

async function loadSeenValues() {
  try {
    const data = fs.readFileSync(SEEN_VALUES_FILE, 'utf-8');
    return new Set(JSON.parse(data));
  } catch (e) {
    return new Set();
  }
}

function saveSeenValues(set) {
  fs.writeFileSync(SEEN_VALUES_FILE, JSON.stringify(Array.from(set), null, 2));
}

async function monitorNetwork(page, durationMs) {
  const requests = [];
  page.on('request', (request) => {
    requests.push(request);
  });
  await page.waitForTimeout(durationMs);
  return requests;
}

async function extractFieldFromRequests(requests, endpoint, field) {
  for (const req of requests) {
    if (req.url().includes(endpoint)) {
      try {
        const postData = req.postData();
        if (postData) {
          const payload = JSON.parse(postData);
          if (payload && Object.prototype.hasOwnProperty.call(payload, field)) {
            return payload[field];
          }
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
  }
  return null;
}

async function isBackButtonPresent(page) {
  const buttons = await page.$$('button');
  for (const button of buttons) {
    const locator = await button.getAttribute('data-locator');
    const text = await button.textContent();
    const visible = await button.isVisible ? await button.isVisible() : true;
    const enabled = await button.isEnabled ? await button.isEnabled() : true;
    if (locator && (locator.includes('back') || text.toLowerCase().includes('back')) && visible && enabled) {
      return true;
    }
  }
  return false;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Create a unique folder for this run's screenshots
  const runTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const screenshotsDir = path.resolve(__dirname, `screenshots-${runTimestamp}`);
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir);
  }

  // Listen for console events from the page
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log(`[PAGE CONSOLE ERROR] ${msg.text()}`);
    } else if (msg.type() === 'warning') {
      console.log(`[PAGE CONSOLE WARN] ${msg.text()}`);
    } else {
      console.log(`[PAGE CONSOLE ${msg.type().toUpperCase()}] ${msg.text()}`);
    }
  });

  try {
    await page.goto(START_URL);

    // --- Step Handlers Definition ---
    const stepTypes = [
        {
          name: 'skip_button',
          detect: async () => {
            const buttons = await page.$$('button');
            for (const button of buttons) {
              const locator = await button.getAttribute('data-locator');
              const text = await button.textContent();
              const visible = await button.isVisible ? await button.isVisible() : true;
              const enabled = await button.isEnabled ? await button.isEnabled() : true;
              if (locator && (locator.includes('skip') || text.toLowerCase().includes('skip')) && visible && enabled && !text.toLowerCase().includes('back')) {
                return true;
              }
            }
            return false;
          },
          solve: async () => {
            const buttons = await page.$$('button');
            for (const button of buttons) {
              const locator = await button.getAttribute('data-locator');
              const text = await button.textContent();
              const visible = await button.isVisible ? await button.isVisible() : true;
              const enabled = await button.isEnabled ? await button.isEnabled() : true;
              if (locator && (locator.includes('skip') || text.toLowerCase().includes('skip')) && visible && enabled && !text.toLowerCase().includes('back')) {
                try {
                  await button.click({ timeout: 5000 });
                  console.log(`[INFO] Clicked skip button: ${locator} - ${text}`);
                  break;
                } catch (err) {
                  console.log(`[WARN] Failed to click skip button: ${err}`);
                }
              }
            }
          }
        },
        {
          name: 'multi_select_button',
          detect: async () => {
            return await page.$('input[data-locator*=multi_select]') !== null && await page.$('[data-locator*=CTAButton]') !== null;
          },
          solve: async () => {
            const inputs = await page.$$('input[data-locator*=multi_select]');
            if (!inputs || inputs.length === 0) {
              console.log('[ERROR] No multi select inputs found when trying to solve.');
              return;
            }
            // Log all found inputs
            for (let i = 0; i < inputs.length; i++) {
              const locator = await inputs[i].getAttribute('data-locator');
              const type = await inputs[i].getAttribute('type');
              let checked;
              try {
                checked = await inputs[i].isChecked ? await inputs[i].isChecked() : undefined;
              } catch (e) {
                checked = undefined;
              }
              const visible = await inputs[i].isVisible ? await inputs[i].isVisible() : true;
              const enabled = await inputs[i].isEnabled ? await inputs[i].isEnabled() : true;
              console.log(`[DEBUG] Found multi_select input [${i}]: data-locator: ${locator}, type: ${type}, checked: ${checked}, visible: ${visible}, enabled: ${enabled}`);
            }
            // Click the first interactable input
            let clicked = false;
            for (let i = 0; i < inputs.length; i++) {
              const visible = await inputs[i].isVisible ? await inputs[i].isVisible() : true;
              const enabled = await inputs[i].isEnabled ? await inputs[i].isEnabled() : true;
              if (visible && enabled) {
                try {
                  await inputs[i].click({ timeout: 5000 });
                  console.log(`[INFO] Clicked multi select input [${i}].`);
                  clicked = true;
                  break;
                } catch (err) {
                  console.log(`[WARN] Failed to click input [${i}]: ${err}`);
                }
              }
            }
            if (!clicked) {
              console.log('[ERROR] No interactable multi select input could be clicked.');
              return;
            }
            // Wait a couple seconds for DOM to update after click
            console.log('[INFO] Waiting 2 seconds for DOM to update after input click...');
            await page.waitForTimeout(2000);
            // Wait for checked or next controls
            try {
              await Promise.race([
                Promise.all(inputs.map(input => input.waitForElementState ? input.waitForElementState('checked', { timeout: 10000 }).catch(() => {}) : Promise.resolve())),
                page.waitForFunction(() => {
                  return (
                    document.querySelectorAll('[data-locator*=option], [data-locator*=option_square]').length > 0 ||
                    document.querySelectorAll('[data-locator*=CTAButton]').length > 0
                  );
                }, {}, { timeout: 10000 })
              ]);
              const afterClickScreenshot = path.resolve(screenshotsDir, `after-click-multi_select-${Date.now()}.png`);
              await page.screenshot({ path: afterClickScreenshot, fullPage: true });
              console.log(`[INFO] Screenshot after selecting input: ${afterClickScreenshot}`);
              // Log all available buttons and inputs after click
              const btns = await page.$$('button');
              const inps = await page.$$('input');
              for (let i = 0; i < btns.length; i++) {
                const locator = await btns[i].getAttribute('data-locator');
                const text = await btns[i].textContent();
                const visible = await btns[i].isVisible ? await btns[i].isVisible() : true;
                const enabled = await btns[i].isEnabled ? await btns[i].isEnabled() : true;
                console.log(`[DEBUG] Button after input click [${i}]: data-locator: ${locator}, text: '${text}', visible: ${visible}, enabled: ${enabled}`);
              }
              for (let i = 0; i < inps.length; i++) {
                const locator = await inps[i].getAttribute('data-locator');
                const type = await inps[i].getAttribute('type');
                let checked;
                try {
                  checked = await inps[i].isChecked ? await inps[i].isChecked() : undefined;
                } catch (e) {
                  checked = undefined;
                }
                const visible = await inps[i].isVisible ? await inps[i].isVisible() : true;
                const enabled = await inps[i].isEnabled ? await inps[i].isEnabled() : true;
                console.log(`[DEBUG] Input after input click [${i}]: data-locator: ${locator}, type: ${type}, checked: ${checked}, visible: ${visible}, enabled: ${enabled}`);
              }
              // Log all elements with data-locator attribute after click
              const allDataLocator = await page.$$('[data-locator]');
              for (let i = 0; i < allDataLocator.length; i++) {
                const tag = await allDataLocator[i].evaluate(el => el.tagName);
                const locator = await allDataLocator[i].getAttribute('data-locator');
                const text = await allDataLocator[i].textContent();
                const visible = await allDataLocator[i].isVisible ? await allDataLocator[i].isVisible() : true;
                let enabled = true;
                try { enabled = await allDataLocator[i].isEnabled ? await allDataLocator[i].isEnabled() : true; } catch { enabled = true; }
                console.log(`[DEBUG] data-locator element after input click [${i}]: <${tag.toLowerCase()}> data-locator: ${locator}, text: '${text}', visible: ${visible}, enabled: ${enabled}`);
              }
              console.log('[INFO] Input selection resulted in a DOM change or next step controls appeared.');
            } catch (e) {
              console.log('[WARN] Input did not become checked or next step controls did not appear after click. There may not have been a visible effect.');
            }
            const btn = await page.$('[data-locator*=CTAButton]');
            if (btn) {
              await btn.click();
              console.log('Clicked CTAButton after multi select');
            }
          }
        },
        {
          name: 'email_input',
          detect: async () => {
            return await page.$('input[data-locator*=email_input]') !== null;
          },
          solve: async () => {
            const emailInput = await page.$('input[data-locator*=email_input]');
            if (emailInput) {
              const randomEmail = `test${Math.floor(Math.random() * 1000000)}@example.com`;
              await emailInput.fill(randomEmail);
              console.log(`Filled email_input with value ${randomEmail}`);
              
              // After filling email, look for and click continue button
              await page.waitForTimeout(1000);
              const continueBtn = await page.$('button[data-locator*=obContinue], button[data-locator*=CTAButton], button[data-locator*=tCTAButton]');
              if (continueBtn) {
                await continueBtn.click();
                console.log('Clicked continue button after filling email');
              }
            }
          }
        },
        {
          name: 'number_input',
          detect: async () => {
            return await page.$('input[data-locator*=height_metric_input], input[data-locator*=weight_metric_input], input[data-locator*=ob_age_input]') !== null;
          },
          solve: async () => {
            const heightInput = await page.$('input[data-locator*=height_metric_input]');
            const weightInput = await page.$('input[data-locator*=weight_metric_input]');
            const ageInput = await page.$('input[data-locator*=ob_age_input]');
            if (heightInput) {
              await heightInput.fill('175');
              console.log('Filled height_metric_input with value 175');
            }
            if (weightInput) {
              await weightInput.fill('70');
              console.log('Filled weight_metric_input with value 70');
            }
            if (ageInput) {
              await ageInput.fill('30');
              console.log('Filled ob_age_input with value 30');
            }
            const btn = await page.$('button[data-locator*=CTAButton], button[data-locator*=ob_continue_btn]');
            if (btn && await btn.isEnabled()) {
              await btn.click();
              console.log('Clicked CTAButton after number input');
            }
          }
        },
        {
          name: 'single_button',
          detect: async () => {
            const buttons = await page.$$('button');
            for (const button of buttons) {
              const locator = await button.getAttribute('data-locator');
              const enabled = await button.isEnabled ? await button.isEnabled() : true;
              if (locator && (locator.includes('CTAButton') || locator.includes('tCTAButton') || locator.includes('ob_continue_btn') || locator.includes('obContinue')) && enabled && !locator.includes('back')) {
                return true;
              }
            }
            return false;
          },
          solve: async () => {
            try {
              const btn = await page.$('button[data-locator*=CTAButton], button[data-locator*=tCTAButton], button[data-locator*=ob_continue_btn], button[data-locator*=obContinue]');
              if (btn) {
                const initialUrl = await page.url();
                await btn.click();
                console.log('Clicked single CTA button');
                await page.waitForTimeout(2000);
                const finalUrl = await page.url();
                if (finalUrl === initialUrl) {
                  console.log('[INFO] URL did not change after clicking single CTA button. Skipping...');
                }
              }
            } catch (err) {
              if (err.message.includes('detached')) {
                console.log('[WARN] Button detached from DOM before click. Skipping...');
              } else {
                console.log(`[ERROR] Failed to click single CTA button: ${err}`);
              }
            }
          }
        },
        {
          name: 'option',
          detect: async () => {
            return await page.$('[data-locator*=option], [data-locator*=option_square]') !== null;
          },
          solve: async () => {
            const btn = await page.$('[data-locator*=option], [data-locator*=option_square]');
            if (!btn) {
              console.log('[ERROR] Option button not found when trying to solve.');
              return;
            }
            // Log button details
            const locator = await btn.getAttribute('data-locator');
            const text = await btn.textContent();
            const visible = await btn.isVisible ? await btn.isVisible() : true;
            const enabled = await btn.isEnabled ? await btn.isEnabled() : true;
            console.log(`[DEBUG] About to click option button. data-locator: ${locator}, text: '${text}', visible: ${visible}, enabled: ${enabled}`);
            if (!visible || !enabled || text.toLowerCase().includes('back')) {
              console.log(`[ERROR] Option button is not interactable (visible: ${visible}, enabled: ${enabled}) or is a back button`);
              return;
            }
            try {
              await btn.click({ timeout: 5000 });
              console.log('[INFO] Clicked option button. Waiting for next step controls or DOM change...');
            } catch (err) {
              console.log(`[ERROR] Failed to click option button: ${err}`);
            }
            // Wait a couple seconds for DOM to update after click
            console.log('[INFO] Waiting 2 seconds for DOM to update after click...');
            await page.waitForTimeout(2000);
            // Take screenshot after click
            const afterClickScreenshot = path.resolve(screenshotsDir, `after-click-option-${Date.now()}.png`);
            await page.screenshot({ path: afterClickScreenshot, fullPage: true });
            console.log(`[INFO] Screenshot after click: ${afterClickScreenshot}`);
            // Log all available buttons and inputs after click
            const btns = await page.$$('button');
            const inps = await page.$$('input');
            for (let i = 0; i < btns.length; i++) {
              const locator = await btns[i].getAttribute('data-locator');
              const text = await btns[i].textContent();
              const visible = await btns[i].isVisible ? await btns[i].isVisible() : true;
              const enabled = await btns[i].isEnabled ? await btns[i].isEnabled() : true;
              console.log(`[DEBUG] Button after click [${i}]: data-locator: ${locator}, text: '${text}', visible: ${visible}, enabled: ${enabled}`);
            }
            for (let i = 0; i < inps.length; i++) {
              const locator = await inps[i].getAttribute('data-locator');
              const type = await inps[i].getAttribute('type');
              let checked;
              try {
                checked = await inps[i].isChecked ? await inps[i].isChecked() : undefined;
              } catch (e) {
                checked = undefined;
              }
              const visible = await inps[i].isVisible ? await inps[i].isVisible() : true;
              const enabled = await inps[i].isEnabled ? await inps[i].isEnabled() : true;
              console.log(`[DEBUG] Input after click [${i}]: data-locator: ${locator}, type: ${type}, checked: ${checked}, visible: ${visible}, enabled: ${enabled}`);
            }
            // Log all elements with data-locator attribute after click
            const allDataLocator = await page.$$('[data-locator]');
            for (let i = 0; i < allDataLocator.length; i++) {
              const tag = await allDataLocator[i].evaluate(el => el.tagName);
              const locator = await allDataLocator[i].getAttribute('data-locator');
              const text = await allDataLocator[i].textContent();
              const visible = await allDataLocator[i].isVisible ? await allDataLocator[i].isVisible() : true;
              let enabled = true;
              try { enabled = await allDataLocator[i].isEnabled ? await allDataLocator[i].isEnabled() : true; } catch { enabled = true; }
              console.log(`[DEBUG] data-locator element after click [${i}]: <${tag.toLowerCase()}> data-locator: ${locator}, text: '${text}', visible: ${visible}, enabled: ${enabled}`);
            }
          }
        },
        {
          name: 'single_option',
          detect: async () => {
            // Log all inputs and their data-locator/type/visibility/enabled/checked
            const allInputs = await page.$$('input');
            if (!allInputs || allInputs.length === 0) {
              console.log('[DEBUG] No input elements found on the page.');
            } else {
              for (let i = 0; i < allInputs.length; i++) {
                const locator = await allInputs[i].getAttribute('data-locator');
                const type = await allInputs[i].getAttribute('type');
                let checked;
                try {
                  checked = await allInputs[i].isChecked ? await allInputs[i].isChecked() : undefined;
                } catch (e) {
                  checked = undefined;
                }
                const visible = await allInputs[i].isVisible ? await allInputs[i].isVisible() : true;
                const enabled = await allInputs[i].isEnabled ? await allInputs[i].isEnabled() : true;
                console.log(`[DEBUG] Input [${i}]: data-locator: ${locator}, type: ${type}, checked: ${checked}, visible: ${visible}, enabled: ${enabled}`);
              }
            }
            const singleSelectInput = await page.$('input[data-locator*=single_select]');
            if (!singleSelectInput) {
              console.log('[WARN] No input[data-locator*=single_select] found on the page during single_option detection. See above for all inputs.');
            }
            return singleSelectInput !== null;
          },
          solve: async () => {
            const inputs = await page.$$('input[data-locator*=single_select]');
            if (!inputs || inputs.length === 0) {
              console.log('[ERROR] No single select inputs found when trying to solve.');
              return;
            }
            // Log all found inputs
            for (let i = 0; i < inputs.length; i++) {
              const locator = await inputs[i].getAttribute('data-locator');
              const type = await inputs[i].getAttribute('type');
              let checked;
              try {
                checked = await inputs[i].isChecked ? await inputs[i].isChecked() : undefined;
              } catch (e) {
                checked = undefined;
              }
              const visible = await inputs[i].isVisible ? await inputs[i].isVisible() : true;
              const enabled = await inputs[i].isEnabled ? await inputs[i].isEnabled() : true;
              console.log(`[DEBUG] Found single_select input [${i}]: data-locator: ${locator}, type: ${type}, checked: ${checked}, visible: ${visible}, enabled: ${enabled}`);
            }
            // Click the first interactable input
            let clicked = false;
            for (let i = 0; i < inputs.length; i++) {
              const visible = await inputs[i].isVisible ? await inputs[i].isVisible() : true;
              const enabled = await inputs[i].isEnabled ? await inputs[i].isEnabled() : true;
              if (visible && enabled) {
                try {
                  await inputs[i].click({ timeout: 5000 });
                  console.log(`[INFO] Clicked single select input [${i}].`);
                  clicked = true;
                  break;
                } catch (err) {
                  console.log(`[WARN] Failed to click input [${i}]: ${err}`);
                }
              }
            }
            if (!clicked) {
              console.log('[ERROR] No interactable single select input could be clicked.');
              return;
            }
            // Wait a couple seconds for DOM to update after click
            console.log('[INFO] Waiting 2 seconds for DOM to update after input click...');
            await page.waitForTimeout(2000);
            // Wait for checked or next controls
            try {
              await Promise.race([
                Promise.all(inputs.map(input => input.waitForElementState ? input.waitForElementState('checked', { timeout: 10000 }).catch(() => {}) : Promise.resolve())),
                page.waitForFunction(() => {
                  return (
                    document.querySelectorAll('[data-locator*=option], [data-locator*=option_square]').length > 0 ||
                    document.querySelectorAll('[data-locator*=CTAButton]').length > 0
                  );
                }, {}, { timeout: 10000 })
              ]);
              const afterClickScreenshot = path.resolve(screenshotsDir, `after-click-single_option-${Date.now()}.png`);
              await page.screenshot({ path: afterClickScreenshot, fullPage: true });
              console.log(`[INFO] Screenshot after selecting input: ${afterClickScreenshot}`);
              // Log all available buttons and inputs after click
              const btns = await page.$$('button');
              const inps = await page.$$('input');
              for (let i = 0; i < btns.length; i++) {
                const locator = await btns[i].getAttribute('data-locator');
                const text = await btns[i].textContent();
                const visible = await btns[i].isVisible ? await btns[i].isVisible() : true;
                const enabled = await btns[i].isEnabled ? await btns[i].isEnabled() : true;
                console.log(`[DEBUG] Button after input click [${i}]: data-locator: ${locator}, text: '${text}', visible: ${visible}, enabled: ${enabled}`);
              }
              for (let i = 0; i < inps.length; i++) {
                const locator = await inps[i].getAttribute('data-locator');
                const type = await inps[i].getAttribute('type');
                let checked;
                try {
                  checked = await inps[i].isChecked ? await inps[i].isChecked() : undefined;
                } catch (e) {
                  checked = undefined;
                }
                const visible = await inps[i].isVisible ? await inps[i].isVisible() : true;
                const enabled = await inps[i].isEnabled ? await inps[i].isEnabled() : true;
                console.log(`[DEBUG] Input after input click [${i}]: data-locator: ${locator}, type: ${type}, checked: ${checked}, visible: ${visible}, enabled: ${enabled}`);
              }
              // Log all elements with data-locator attribute after click
              const allDataLocator = await page.$$('[data-locator]');
              for (let i = 0; i < allDataLocator.length; i++) {
                const tag = await allDataLocator[i].evaluate(el => el.tagName);
                const locator = await allDataLocator[i].getAttribute('data-locator');
                const text = await allDataLocator[i].textContent();
                const visible = await allDataLocator[i].isVisible ? await allDataLocator[i].isVisible() : true;
                let enabled = true;
                try { enabled = await allDataLocator[i].isEnabled ? await allDataLocator[i].isEnabled() : true; } catch { enabled = true; }
                console.log(`[DEBUG] data-locator element after input click [${i}]: <${tag.toLowerCase()}> data-locator: ${locator}, text: '${text}', visible: ${visible}, enabled: ${enabled}`);
              }
              console.log('[INFO] Input selection resulted in a DOM change or next step controls appeared.');
            } catch (e) {
              console.log('[WARN] Input did not become checked or next step controls did not appear after click. There may not have been a visible effect.');
            }
          }
        },
        {
          name: 'multi_option',
          detect: async () => {
            return await page.$('input[data-locator*=multi_select]') !== null && await page.$('[data-locator*=CTAButton]') !== null;
          },
          solve: async () => {
            const input = await page.$('input[data-locator*=multi_select]');
            if (input) {
              await input.click();
              console.log('Selected multi option input');
            }
            const btn = await page.$('[data-locator*=CTAButton]');
            if (btn) {
              await btn.click();
              console.log('Clicked CTAButton after multi option');
            }
          }
        },
        {
          name: 'occasion_result_screen',
          detect: async () => {
            const url = await page.url();
            if (!url.includes('result')) {
              return false;
            }
            const inputs = await page.$$('input');
            for (const input of inputs) {
              const locator = await input.getAttribute('data-locator');
              if (locator !== null) {
                return false;
              }
            }
            return true;
          },
          solve: async () => {
            console.log('Found occasion result screen');
            // Look for continue buttons or other actionable elements on the result screen
            const continueButtons = await page.$$('button:visible');
            if (continueButtons.length > 0) {
              for (const button of continueButtons) {
                const locator = await button.getAttribute('data-locator');
                const text = await button.textContent();
                const enabled = await button.isEnabled ? await button.isEnabled() : true;
                if (enabled && !text.toLowerCase().includes('back') && !locator.toLowerCase().includes('back')) {
                  try {
                    await button.click({ timeout: 5000 });
                    console.log(`[INFO] Clicked continue button: ${locator} - ${text}`);
                    break;
                  } catch (err) {
                    console.log(`[WARN] Failed to click continue button: ${err}`);
                  }
                }
              }
            } else {
              console.log('[INFO] No continue buttons found on the result screen.');
            }
          }
        },
      ];

      // --- Main Loop ---
      let retryCount = 0;
      let lastUrl = '';
      let stuckCount = 0;
      const MAX_RETRIES = 300; // Allow for many steps but not infinite
      let screenshotCounter = 0;
      while (retryCount < MAX_RETRIES) {
        try {
          let stepSolved = false;
          
          for (const stepType of stepTypes) {
            if (await stepType.detect()) {
              console.log(`[INFO] Detected step type: ${stepType.name}. Attempting to solve...`);
              await stepType.solve();
              stepSolved = true;
              break;
            } else {
              console.log(`[DEBUG] Checking step type: ${stepType.name}`);
            }
          }

          if (stepSolved) {
            screenshotCounter++;
            console.log(`[INFO] Screenshot saved: ${screenshotsDir}/screenshot-${screenshotCounter}.png`);
            await page.screenshot({ path: `${screenshotsDir}/screenshot-${screenshotCounter}.png` });
            
            // Reset stuck counter when we make progress
            stuckCount = 0;
            retryCount++;
            continue; // Immediately try to detect the next step
          }

          // Fallback: if no step type was detected, wait a bit and try again
          console.log('[WARN] No step type detected. Waiting before retry...');
          const buttons = await page.$$('button');
          for (const button of buttons) {
            const locator = await button.getAttribute('data-locator');
            const text = await button.textContent();
            const visible = await button.isVisible ? await button.isVisible() : true;
            const enabled = await button.isEnabled ? await button.isEnabled() : true;
            console.log(`[DEBUG] Button: data-locator: ${locator}, text: '${text}', visible: ${visible}, enabled: ${enabled}`);
          }
          const elements = await page.$$('[data-locator]');
          for (const element of elements) {
            const locator = await element.getAttribute('data-locator');
            const text = await element.textContent();
            const visible = await element.isVisible ? await element.isVisible() : true;
            let enabled = true;
            try { enabled = await element.isEnabled ? await element.isEnabled() : true; } catch { enabled = true; }
            console.log(`[DEBUG] Element: data-locator: ${locator}, text: '${text}', visible: ${visible}, enabled: ${enabled}`);
          }
          
          // Check if we're stuck on the same URL
          const currentUrl = page.url();
          if (currentUrl === lastUrl) {
            stuckCount++;
            if (stuckCount > 5) {
              console.log('[INFO] Detected potential completion or infinite loop. Checking for completion indicators...');
              
              // Look for completion indicators
              const completionIndicators = await page.$$eval('*', elements => {
                return elements.some(el => {
                  const text = el.textContent?.toLowerCase();
                  return text?.includes('complete') || text?.includes('finish') || text?.includes('done') || 
                         text?.includes('success') || text?.includes('congratulations') || text?.includes('welcome');
                });
              });
              
              if (completionIndicators) {
                console.log('[SUCCESS] Onboarding appears to be complete!');
                break;
              }
              
              if (stuckCount > 10) {
                console.log('[INFO] Maximum stuck attempts reached. Exiting to prevent infinite loop.');
                break;
              }
            }
          } else {
            stuckCount = 0; // Reset if URL changed
          }
          lastUrl = currentUrl;
          
          await page.waitForTimeout(2000);
          retryCount++;
          
        } catch (err) {
          console.log(`[ERROR] Error in main loop: ${err}`);
          retryCount++;
        }
      }

      if (retryCount >= MAX_RETRIES) {
        console.log('[INFO] Maximum retries reached. Onboarding automation complete.');
      }
    } finally {
      await browser.close();
    }
  }

  main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
