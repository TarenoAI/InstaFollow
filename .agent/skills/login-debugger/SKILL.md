---
name: login-debugger
description: A skill to debug and fix login issues for Instagram and X/Twitter by cross-referencing official documentation.
---

# Login Debugger Skill

This skill is designed to systematically debug and resolve login issues for Instagram and X/Twitter. It enforces a strict protocol of checking the documentation, verified behavior, and updating the single source of truth.

## 🚨 Protocol

When a login failure is detected (e.g., via logs or screenshots), follow these steps:

1.  **Identify the Platform:** Is it Instagram or X/Twitter?
2.  **Read the Documentation:**
    *   **Instagram:** `docs/LOGIN-INSTAGRAM.md`
    *   **X/Twitter:** `docs/LOGIN-TWITTER.md`
3.  **Analyze the Failure:**
    *   Check `public/debug/` for screenshots (`login-failed-*.png`, `twitter-session-expired-*.png`).
    *   Compare the screenshot with the expected state described in the documentation.
    *   Identify discrepancies (e.g., button text changed, new popup, different URL).

## 🛠️ Actions

### Scenario A: UI Mismatch (Documentation Outdated)
If the screenshot shows a UI element (button, text, flow) that differs from the documentation:

1.  **UPDATE DOCUMENTATION:**
    *   Modify `docs/LOGIN-INSTAGRAM.md` or `docs/LOGIN-TWITTER.md` to reflect the *new* reality.
    *   Describe the new selector, text, or flow step required.
2.  **UPDATE CODE:**
    *   Modify `scripts/monitors/smart-monitor-v4.ts` to implement the change documented in step 1.
    *   Ensure the code uses the new selectors/logic.

### Scenario B: Session Issues (Cookies/Tokens Invalid)
If the screenshot shows a login page where a logged-in state was expected (and no UI change happened):

1.  **FLAG FOR MANUAL INTERVENTION:**
    *   This usually requires a manual login via VNC to refresh persistent cookies.
    *   **Instagram:** Check for "Checkpoint" or "Challenge".
    *   **X/Twitter:** Run `DISPLAY=:1 npx tsx scripts/auth/twitter-vnc-login.ts` (or manual browser login).

### Scenario C: Unknown Error
If the failure is not visual or obvious:

1.  **ADD LOGGING:**
    *   Add more `console.log` or `page.screenshot` calls in `smart-monitor-v4.ts` around the failing step.
    *   Push the changes and ask the user to run the script again to gather more data.

## 📄 Reference Files

*   `docs/LOGIN-INSTAGRAM.md`
*   `docs/LOGIN-TWITTER.md`
*   `scripts/monitors/smart-monitor-v4.ts`
