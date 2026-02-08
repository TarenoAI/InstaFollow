---
name: process-documentation-reference
description: A skill to enforce the use of Single Source of Truth documentation for all critical processes (Instagram, X/Twitter).
---

# Process Documentation Reference Skill

This skill establishes the **Process Documentation** as the absolute authority for the agent's actions regarding Instagram and X/Twitter automation.

## 🚨 MANDATE

The agent is **FORBIDDEN** from modifying login, navigation, scraping, or posting logic WITHOUT FIRST consulting the corresponding documentation.

If an error occurs (e.g., element not found, login failed), the agent MUST:
1.  **READ** the relevant documentation file.
2.  **COMPARE** the documented process with the observed failure (via screenshots/logs).
3.  **ACT** based on the findings:
    *   **Scenario A:** The documentation matches reality, but the code failed (e.g., timeout). -> Retry / Adjust Code.
    *   **Scenario B:** The documentation is OUTDATED (e.g., UI changed). -> **UPDATE THE DOCUMENTATION FIRST**, then update the code.

## 📚 The Truth Sources

| Platform | Process | File Path |
| :--- | :--- | :--- |
| **Instagram** | Login, Navigation, Scraping | `docs/LOGIN-INSTAGRAM.md` |
| **X / Twitter** | Login, Posting | `docs/LOGIN-TWITTER.md` |

## 🛠️ Usage Instructions

### When Debugging Errors
1.  **Retrieve Screenshot:** Check `public/debug/` for the failure evidence.
2.  **Consult Documentation:** Open `docs/LOGIN-INSTAGRAM.md` or `docs/LOGIN-TWITTER.md`.
3.  **Verify Selector:** Does the documented selector match what is visible in the screenshot?
4.  **Verify Flow:** Did the failure happen at a documented step?

### When Updating Logic
1.  **Read Before Write:** Always read the documentation to understand the intended flow.
2.  **Document Changes:** If you change a selector or logic step in the code, you MUST update the documentation file to reflect this change.
    *   Example: "Changed 'Weiter' button selector to include `div[role='button']`." -> Update `docs/LOGIN-INSTAGRAM.md`.

## 📄 Key Files to Watch

*   `docs/LOGIN-INSTAGRAM.md`
*   `docs/LOGIN-TWITTER.md`
*   `scripts/monitors/smart-monitor-v4.ts`
