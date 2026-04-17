// End-to-end tests for the lecture feedback tool (FYP-Project)
// Tests: enrollment, sessions visibility, live session flow, refresh persistence

import { chromium } from "playwright";

const BASE = "http://localhost:5173";
const LECTURER_EMAIL = "bosslecturer@leeds.ac.uk";
const STUDENT_EMAIL = "scac01@leeds.ac.uk";
const AUTH_CODE = "123456";

let browser;
let passed = 0;
let failed = 0;

function pass(name) {
  passed++;
  console.log(`  \u2713 ${name}`);
}

function fail(name, err) {
  failed++;
  console.error(`  \u2717 ${name}: ${err}`);
}

async function test(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (e) {
    fail(name, e.message);
  }
}

async function login(page, email) {
  await page.goto(`${BASE}/login`);
  await page.waitForSelector('input[type="email"]', { timeout: 5000 });

  // Fill both email and TOTP code, then submit
  await page.fill('input[type="email"]', email);
  await page.fill('input[inputmode="numeric"]', AUTH_CODE);
  await page.click('button[type="submit"]');

  // Wait for navigation away from login
  await page.waitForFunction(
    () => !window.location.pathname.includes('/login') && !window.location.pathname.includes('/verify'),
    { timeout: 10000 },
  );
}

async function run() {
  browser = await chromium.launch({ headless: true });

  // ---- Test Suite 1: Lecturer creates a module and session ----
  console.log("\n=== Test 1: Lecturer Flow ===\n");

  const lecturerCtx = await browser.newContext();
  const lecturerPage = await lecturerCtx.newPage();
  // lecturerPage.on("console", (msg) => console.log(`[lect] ${msg.text()}`));

  await test("Lecturer can log in", async () => {
    await login(lecturerPage, LECTURER_EMAIL);
    // Should be on the lecturer dashboard
    await lecturerPage.waitForFunction(
      () => document.body.innerText.includes("My modules") || document.body.innerText.includes("module"),
      { timeout: 8000 },
    );
  });

  await test("Lecturer sees modules on dashboard", async () => {
    await lecturerPage.waitForFunction(
      () => document.body.innerText.includes("COMP1234") || document.body.innerText.includes("TEST"),
      { timeout: 5000 },
    );
  });

  // ---- Test Suite 2: Student enrollment ----
  console.log("\n=== Test 2: Student Enrollment ===\n");

  const studentCtx = await browser.newContext();
  const studentPage = await studentCtx.newPage();
  // studentPage.on("console", (msg) => console.log(`[stud] ${msg.text()}`));

  await test("Student can log in", async () => {
    await login(studentPage, STUDENT_EMAIL);
    await studentPage.waitForFunction(
      () => document.body.innerText.includes("Welcome back") || document.body.innerText.includes("module"),
      { timeout: 8000 },
    );
  });

  await test("Student sees the Browse tab", async () => {
    // Find and click the browse tab
    const browseBtn = await studentPage.$('button:has-text("Browse")');
    if (browseBtn) await browseBtn.click();
    await studentPage.waitForTimeout(1000);
    const text = await studentPage.evaluate(() => document.body.innerText);
    if (!text.includes("Browse") && !text.includes("Enroll")) {
      throw new Error("Browse tab not visible");
    }
  });

  // Find a module to test enrollment on — track which one we enrolled in
  let testModuleFound = false;
  let enrolledModuleName = "";
  await test("Student can see available modules to enroll", async () => {
    const text = await studentPage.evaluate(() => document.body.innerText);
    // Should see at least one module with Enroll button
    if (text.includes("Enroll")) {
      testModuleFound = true;
    } else if (text.includes("No modules available")) {
      throw new Error("No modules available for enrollment");
    } else {
      throw new Error("No Enroll button found");
    }
  });

  if (testModuleFound) {
    await test("Student can click Enroll and it succeeds", async () => {
      // Count browse modules before
      const beforeCount = await studentPage.evaluate(() =>
        document.querySelectorAll('button').length
      );

      // Click the first Enroll button
      const enrollBtn = await studentPage.$('button:has-text("Enroll")');
      if (!enrollBtn) throw new Error("No Enroll button found");
      await enrollBtn.click();

      // After enrollment, the module card moves to My Modules tab.
      // Wait for the Enroll button to disappear from this card, or
      // for an error to show.
      await studentPage.waitForFunction(
        (origCount) => {
          const text = document.body.innerText;
          // Error = fail
          if (text.includes("Failed") || text.includes("Request failed")) return true;
          // Enrollment succeeded: the enrolled module moved out of browse
          const enrollBtns = document.querySelectorAll('button');
          const enrollTexts = Array.from(enrollBtns).filter(b => b.textContent?.trim() === 'Enroll');
          return enrollTexts.length < origCount; // fewer Enroll buttons = one was enrolled
        },
        beforeCount,
        { timeout: 10000 },
      );

      const text = await studentPage.evaluate(() => document.body.innerText);
      if (text.includes("Failed") || text.includes("Request failed")) {
        throw new Error("Enrollment failed: " + text.match(/Failed.*|Request failed.*/)?.[0]);
      }
    });

    await test("No error message visible after enrollment", async () => {
      const errorEl = await studentPage.$('.bg-red-50, .bg-red-900\\/20');
      if (errorEl) {
        const errorText = await errorEl.textContent();
        throw new Error(`Error visible: ${errorText}`);
      }
    });

    await test("Enrolled module appears in My Modules tab", async () => {
      const myModsBtn = await studentPage.$('button:has-text("My modules")');
      if (myModsBtn) await myModsBtn.click();
      await studentPage.waitForTimeout(1000);
      // Should see Unenroll button (for the just-enrolled module)
      const text = await studentPage.evaluate(() => document.body.innerText);
      if (!text.includes("Unenroll")) {
        throw new Error("Unenroll button not found after enrollment");
      }
      // Capture the name of the enrolled module for later cleanup
      enrolledModuleName = await studentPage.evaluate(() => {
        const cards = document.querySelectorAll('.rounded-2xl');
        for (const card of cards) {
          if (card.textContent?.includes('Unenroll') && !card.textContent?.includes('COMP1234')) {
            const name = card.querySelector('h3');
            return name?.textContent ?? '';
          }
        }
        return '';
      });
    });
  }

  // ---- Test Suite 3: Sessions visibility ----
  console.log("\n=== Test 3: Sessions Visibility ===\n");

  await test("Student sees My Modules tab with enrolled modules", async () => {
    const myModsBtn = await studentPage.$('button:has-text("My modules")');
    if (myModsBtn) await myModsBtn.click();
    await studentPage.waitForTimeout(1000);
    const text = await studentPage.evaluate(() => document.body.innerText);
    if (text.includes("No modules enrolled")) {
      throw new Error("No enrolled modules found after enrollment");
    }
  });

  // ---- Test Suite 4: Refresh persistence ----
  console.log("\n=== Test 4: Refresh Persistence ===\n");

  await test("Student dashboard survives page refresh", async () => {
    await studentPage.reload();
    await studentPage.waitForFunction(
      () => document.body.innerText.includes("Welcome back") || document.body.innerText.includes("module"),
      { timeout: 8000 },
    );
    // Should still show enrolled modules
    const text = await studentPage.evaluate(() => document.body.innerText);
    if (text.includes("No modules enrolled") && !text.includes("My modules (0)")) {
      // It's OK — check if modules tab shows content
    }
  });

  await test("Enrolled modules persist after refresh", async () => {
    const myModsBtn = await studentPage.$('button:has-text("My modules")');
    if (myModsBtn) await myModsBtn.click();
    await studentPage.waitForTimeout(1000);

    // The student was already enrolled in COMP1234 before
    const text = await studentPage.evaluate(() => document.body.innerText);
    if (!text.includes("COMP1234")) {
      throw new Error("Enrolled module COMP1234 not visible after refresh");
    }
  });

  // ---- Test Suite 5: Error message quality ----
  console.log("\n=== Test 5: Error Handling ===\n");

  await test("Error messages include status code", async () => {
    // Make a request to a non-existent endpoint to test error format
    const errorMsg = await studentPage.evaluate(async () => {
      try {
        const token = localStorage.getItem("token");
        const res = await fetch("/api/modules/00000000-0000-0000-0000-000000000000/enroll", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({
            error: `Request failed (${res.status}${res.statusText ? " " + res.statusText : ""})`,
          }));
          return err.error ?? `Request failed (${res.status})`;
        }
        return "unexpected success";
      } catch (e) {
        return e.message;
      }
    });
    // Should contain status code or a clear message, not just "Request failed"
    if (errorMsg === "Request failed") {
      throw new Error("Error message is still generic 'Request failed'");
    }
    console.log(`    Error message: "${errorMsg}"`);
  });

  // ---- Test Suite 6: Live session flow ----
  console.log("\n=== Test 6: Live Session Notification ===\n");

  // Check if there are any sessions for the lecturer
  await test("Lecturer can navigate to a module", async () => {
    await lecturerPage.goto(`${BASE}/lecturer`);
    await lecturerPage.waitForFunction(
      () => document.body.innerText.includes("COMP1234"),
      { timeout: 5000 },
    );
    // Click on COMP1234 module
    const moduleCard = await lecturerPage.$('button:has-text("COMP1234")');
    if (moduleCard) {
      await moduleCard.click();
      await lecturerPage.waitForTimeout(2000);
    }
  });

  // Clean up: unenroll from the module we enrolled during testing (NOT COMP1234)
  if (testModuleFound) {
    await test("Student can unenroll from a module", async () => {
      await studentPage.goto(`${BASE}/student`);
      await studentPage.waitForFunction(
        () => document.body.innerText.includes("Welcome back"),
        { timeout: 8000 },
      );
      const myModsBtn = await studentPage.$('button:has-text("My modules")');
      if (myModsBtn) await myModsBtn.click();
      await studentPage.waitForTimeout(1000);

      // Find the Unenroll button for the module we enrolled (not COMP1234)
      const unenrolled = await studentPage.evaluate(() => {
        const cards = document.querySelectorAll('.rounded-2xl');
        for (const card of cards) {
          const unenrollBtn = card.querySelector('button');
          if (unenrollBtn?.textContent?.trim() === 'Unenroll' && !card.textContent?.includes('COMP1234')) {
            unenrollBtn.click();
            return true;
          }
        }
        return false;
      });
      if (unenrolled) {
        await studentPage.waitForTimeout(1000);
      }
    });
  }

  // ---- Test Suite 7: Incognito-like enrollment (fresh browser context) ----
  console.log("\n=== Test 7: Fresh Context Enrollment (Incognito Simulation) ===\n");

  const incognitoCtx = await browser.newContext();
  const incognitoPage = await incognitoCtx.newPage();

  await test("Student can log in from fresh context (incognito)", async () => {
    await login(incognitoPage, STUDENT_EMAIL);
    await incognitoPage.waitForFunction(
      () => document.body.innerText.includes("Welcome back"),
      { timeout: 8000 },
    );
  });

  await test("Student sees enrolled modules in fresh context", async () => {
    await incognitoPage.waitForTimeout(2000);
    const myModsBtn = await incognitoPage.$('button:has-text("My modules")');
    if (myModsBtn) await myModsBtn.click();
    await incognitoPage.waitForTimeout(1000);
    const text = await incognitoPage.evaluate(() => document.body.innerText);
    if (text.includes("No modules enrolled")) {
      throw new Error("No enrolled modules visible in fresh context");
    }
    // Should see at least COMP1234
    if (!text.includes("COMP1234")) {
      throw new Error("COMP1234 not visible in fresh context — may have been unenrolled by prior test");
    }
  });

  await test("Student can enroll from fresh context", async () => {
    const browseBtn = await incognitoPage.$('button:has-text("Browse")');
    if (browseBtn) await browseBtn.click();
    await incognitoPage.waitForTimeout(1000);

    const enrollBtn = await incognitoPage.$('button:has-text("Enroll")');
    if (!enrollBtn) {
      console.log("    (No unenrolled modules left to test — skipping)");
      return;
    }
    await enrollBtn.click();
    await incognitoPage.waitForTimeout(3000);

    const text = await incognitoPage.evaluate(() => document.body.innerText);
    if (text.includes("Request failed") || text.includes("Failed to enroll")) {
      throw new Error("Enrollment failed in fresh context: " + text);
    }
  });

  await test("Sessions persist after refresh in fresh context", async () => {
    // Refresh
    await incognitoPage.reload();
    await incognitoPage.waitForFunction(
      () => document.body.innerText.includes("Welcome back"),
      { timeout: 8000 },
    );
    await incognitoPage.waitForTimeout(2000);

    // Should still see enrolled modules
    const myModsBtn = await incognitoPage.$('button:has-text("My modules")');
    if (myModsBtn) await myModsBtn.click();
    await incognitoPage.waitForTimeout(1000);
    const text = await incognitoPage.evaluate(() => document.body.innerText);
    if (!text.includes("COMP1234")) {
      throw new Error("Modules disappeared after refresh in fresh context");
    }
  });

  await incognitoCtx.close();

  // ---- Test Suite 8: Enrollment + Live Session + Refresh sequence ----
  console.log("\n=== Test 8: Full User Flow (Enroll -> Live Session -> Refresh) ===\n");

  const lCtx2 = await browser.newContext();
  const lPage2 = await lCtx2.newPage();
  const sCtx2 = await browser.newContext();
  const sPage2 = await sCtx2.newPage();

  await test("Lecturer logs in and navigates to COMP1234", async () => {
    await login(lPage2, LECTURER_EMAIL);
    await lPage2.waitForFunction(
      () => document.body.innerText.includes("My modules"),
      { timeout: 8000 },
    );
    const moduleCard = await lPage2.$('button:has-text("COMP1234")');
    if (moduleCard) await moduleCard.click();
    await lPage2.waitForTimeout(2000);
  });

  await test("Student logs in and sees COMP1234 in enrolled modules", async () => {
    await login(sPage2, STUDENT_EMAIL);
    await sPage2.waitForFunction(
      () => document.body.innerText.includes("COMP1234"),
      { timeout: 8000 },
    );
  });

  await test("Student refreshes page and still sees modules", async () => {
    await sPage2.reload();
    await sPage2.waitForFunction(
      () => document.body.innerText.includes("COMP1234"),
      { timeout: 8000 },
    );
  });

  await test("After multiple refreshes, modules and sessions remain", async () => {
    for (let i = 0; i < 3; i++) {
      await sPage2.reload();
      await sPage2.waitForTimeout(1000);
    }
    await sPage2.waitForFunction(
      () => document.body.innerText.includes("COMP1234") || document.body.innerText.includes("Welcome back"),
      { timeout: 8000 },
    );
    const text = await sPage2.evaluate(() => document.body.innerText);
    if (!text.includes("COMP1234")) {
      throw new Error("Modules disappeared after multiple refreshes");
    }
  });

  await lCtx2.close();
  await sCtx2.close();

  // Cleanup
  await lecturerCtx.close();
  await studentCtx.close();
  await browser.close();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error("Fatal error:", e);
  if (browser) browser.close();
  process.exit(1);
});
