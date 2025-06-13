const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const START_URL = 'https://example.com';
const NEXT_URL = 'https://example.com/next-page';
const SEEN_VALUES_FILE = path.resolve(__dirname, 'seen_values.json');
const SCREENSHOT_FILE = path.resolve(__dirname, 'element.png');
const API_ENDPOINT = '/api/some-endpoint';
const TARGET_FIELD = 'some_field';
const TARGET_SELECTOR = '#target-element';
const WAIT_TIME_MS = 60000; // 1 minute

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

async function main() {
  const seenValues = await loadSeenValues();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(START_URL);
    const requests = await monitorNetwork(page, WAIT_TIME_MS);
    const value = await extractFieldFromRequests(requests, API_ENDPOINT, TARGET_FIELD);
    if (value && !seenValues.has(value)) {
      seenValues.add(value);
      saveSeenValues(seenValues);
      console.log('AB test recognized, starting onboarding automation...');

      // --- Step Handlers Definition ---
      const stepTypes = [
        {
          name: 'option',
          detect: async () => {
            return await page.$('[data-locator*=option], [data-locator*=option_square]') !== null;
          },
          solve: async () => {
            const btn = await page.$('[data-locator*=option], [data-locator*=option_square]');
            if (btn) {
              await btn.click();
              console.log('Clicked option button');
            }
          }
        },
        {
          name: 'single_option',
          detect: async () => {
            return await page.$('input[data-locator*=single_select]') !== null;
          },
          solve: async () => {
            const input = await page.$('input[data-locator*=single_select]');
            if (input) {
              await input.click();
              console.log('Clicked single select input');
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
          name: 'single_button',
          detect: async () => {
            const buttons = await page.$$('button');
            if (buttons.length === 1) {
              const locator = await buttons[0].getAttribute('data-locator');
              return locator && locator.includes('CTAButton');
            }
            return false;
          },
          solve: async () => {
            const btn = await page.$('button[data-locator*=CTAButton]');
            if (btn) {
              await btn.click();
              console.log('Clicked single CTAButton');
            }
          }
        },
      ];

      // --- Page Change Detection ---
      async function waitForDomChange(timeout = 120000) {
        return new Promise((resolve, reject) => {
          let timer;
          let lastHtml = '';
          let changed = false;
          function getDomSnapshot() {
            return page.content();
          }
          (async () => {
            lastHtml = await getDomSnapshot();
          })();
          const observer = setInterval(async () => {
            const currentHtml = await getDomSnapshot();
            if (currentHtml !== lastHtml) {
              changed = true;
              clearInterval(observer);
              clearTimeout(timer);
              resolve();
            }
          }, 1000);
          timer = setTimeout(() => {
            if (!changed) {
              clearInterval(observer);
              reject(new Error('Timeout waiting for DOM change'));
            }
          }, timeout);
        });
      }

      // --- Step Loop ---
      let onboarding = true;
      while (onboarding) {
        let matched = false;
        for (const step of stepTypes) {
          if (await step.detect()) {
            await step.solve();
            matched = true;
            break;
          }
        }
        if (!matched) {
          console.log('No known step type detected. Exiting onboarding loop.');
          onboarding = false;
          break;
        }
        // Wait at least a minute before next step
        console.log('Waiting 1 minute before next step...');
        await page.waitForTimeout(60000);
        try {
          await waitForDomChange(120000); // Wait up to 2 min for DOM change
        } catch (e) {
          console.log('No DOM change detected after step. Exiting onboarding loop.');
          onboarding = false;
        }
      }
      console.log('Onboarding automation complete.');
    } else {
      console.log('No new value found or value already seen.');
    }
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
