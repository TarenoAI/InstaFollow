---
name: e2e-testing
description: "A skill for End-to-End (E2E) testing and iterative implementation. It defines a workflow where a task is implemented, then immediately verified using browser automation (screenshots/DOM checks) to ensure it meets visual and functional requirements. If the verification fails, the implementation is iteratively adjusted."
---

# End-to-End Testing & Iterative Implementation

This skill defines a strict workflow for implementing user-facing features, ensuring that what is coded actually matches what the user sees and wants.

## Workflow: Implement -> Verify -> Iterate

When you receive a task that involves visible changes (Frontend) or verifiable logic via the browser:

### 1. Implementation
- Analyze the requirements.
- Write the necessary code (HTML, CSS, JS/TS, React, etc.).
- Build the project if necessary to ensure no compilation errors.

### 2. Live Verification (The "E2E Check")
**Crucial Step:** Do not just assume the code works. You must see it.

1.  **Start the Application**: Ensure the local development server is running (e.g., `npm run dev`).
2.  **Launch Browser**: Use the `browser_subagent` to open the relevant URL.
3.  **Visual Proof**:
    -   Take a **Screenshot** of the implemented feature.
    -   (Optional) Read the DOM using browser tools if specific text/elements need validation.
4.  **Compare**: Check if the visual output matches the user's request.
    -   *Does the design look premium?*
    -   *Are the elements in the right place?*
    -   *Is the data correct?*

### 3. Iterative Repair
If the "Live Verification" shows discrepancies (e.g., styling is off, component is missing, logic error):

1.  **Analyze the Screenshot/DOM**: Identify exactly *why* it looks wrong.
2.  **Adjust Code**: Modify the implementation to fix the specific visual/functional defect.
3.  **Retest**: Go back to Step 2 (Reload page -> Screenshot -> Verify).
4.  **Repeat**: Continue this loop until the result matches the expectation.

## Tools Checklist

-   **`browser_subagent`**: Your primary tool for this skill. Use it to navigate, click, and capture screenshots.
-   **Terminal**: To ensure the server is up.

## Example Scenario

**User**: "Add a 'Login with GitHub' button to the login page."

**Agent Action**:
1.  **Code**: Add the button to `login.tsx`.
2.  **Verify**:
    -   Open browser to `localhost:3000/login`.
    -   Take screenshot.
    -   *Self-Correction*: "The button is blue, but GitHub buttons are usually black. It also touches the border."
3.  **Fix**: Update CSS to make it black and add margin.
4.  **Verify**: Reload -> Screenshot. "Looks correct."
5.  **Done**: Report success to user with the proof.
