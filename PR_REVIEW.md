# PR Review: Plan Mode Feature

**PR:** feat: add plan mode for writing implementation plans
**URL:** https://github.com/skspade/octofriend/pull/1
**Files Changed:** 24 files
**Review Date:** 2026-02-01

**Last Updated:** 2026-02-01

---

## Status Summary

| Category    | Total Issues | Fixed | Partially Fixed | Remaining |
| ----------- | ------------ | ----- | --------------- | --------- |
| Critical    | 3            | 2     | 0               | 1         |
| Important   | 8            | 1     | 1               | 6         |
| Suggestions | 5            | 0     | 1               | 4         |
| **Total**   | **16**       | **3** | **2**           | **11**    |

**Progress:** 3/16 issues fixed (18.75%), 2/16 partially fixed (12.5%)

---

## Summary

This PR adds plan mode functionality that allows users to explore the codebase with read-only tools and write implementation plans before execution. The code demonstrates solid engineering with excellent type design (particularly the `PlanModeConfig` discriminated union), comprehensive test coverage, and good security practices (restricting tools in plan mode).

However, there are several critical issues around error handling, race conditions, and silent failures that should be addressed before merging.

---

## Critical Issues (Must Fix)

### 1. Unhandled `transport.cwd()` Error

- **Location:** `source/plan-mode.ts:37-40`
- **Severity:** Critical
- **Status:** ✅ FIXED
- **Issue:** The `transport.cwd()` call lacks error handling. If it fails (permission denied, directory deleted, etc.), it will crash the application with an unhandled rejection.
- **Current Code:**
  ```typescript
  if (!branchName) {
    const cwdPath = await transport.cwd(signal); // NO ERROR HANDLING!
    branchName = path.basename(cwdPath);
  }
  ```
- **Recommended Fix:**
  ```typescript
  if (!branchName) {
    try {
      const cwdPath = await transport.cwd(signal);
      branchName = path.basename(cwdPath);
    } catch (cwdErr) {
      if (signal.aborted) throw cwdErr;
      const errorMessage = cwdErr instanceof Error ? cwdErr.message : String(cwdErr);
      logger.error("info", "Failed to get current working directory for plan path", {
        error: errorMessage,
      });
      throw new Error(
        `Could not determine plan file path: Could not access current working directory (${errorMessage})`,
      );
    }
  }
  ```

### 2. Silent Failure Continuation in Plan Mode

- **Location:** `source/state.ts:476-496`
- **Severity:** Critical
- **Status:** ✅ FIXED
- **Issue:** When plan file initialization fails, the code logs the error, notifies the user, and continues execution. The agent operates with an uninitialized/nonexistent plan file, causing confusing behavior later.
- **Current Behavior:** User sees notification that plan file couldn't be initialized, but app behaves as if everything is fine.
- **Recommended Fix:** Exit plan mode when initialization fails rather than continuing in a broken state:
  ```typescript
  get().notify(
    `Plan mode: failed to initialize plan file at ${displayPath(activePlanFilePath)}. You can create it manually. Exiting plan mode.`,
  );
  // EXIT PLAN MODE - don't continue in a broken state
  set({
    modeData: { mode: "input", vimMode: "INSERT" },
    currentMode: "collaboration",
    activePlanFilePath: null,
    planFileInitialized: false,
  });
  return;
  ```

### 3. Race Condition in Plan Initialization

- **Location:** `source/app.tsx:175-224`
- **Severity:** Critical
- **Issue:** If the user toggles modes (via Shift+Tab) during initialization, the state may become inconsistent. The initialization may complete after the mode has been left, incorrectly setting plan file paths for a mode that's no longer active.
- **Recommended Fix:** Verify still in plan mode before setting state after async operations, or use a Promise-based cache with initialization IDs.

---

## Important Issues (Should Fix)

### 4. Overly Broad Catch Block

- **Location:** `source/plan-mode.ts:22-35`
- **Severity:** High
- **Issue:** The git command catch block classifies errors solely by string matching. System errors (ENOMEM, EMFILE, disk space issues) that don't match expected patterns are silently logged and execution continues with a fallback.
- **Fix:** Check for system error codes before falling back to message matching:
  ```typescript
  if (err instanceof Error && "code" in err) {
    const errorCode = (err as NodeJS.ErrnoException).code;
    if (SYSTEM_ERROR_CODES.includes(errorCode || "")) {
      throw err; // Don't silently ignore system errors
    }
  }
  ```

### 5. Fragile Error Classification in trajectory-arc.ts

- **Location:** `source/agent/trajectory-arc.ts:344-358` and `469-490`
- **Severity:** High
- **Status:** 🟡 PARTIALLY FIXED
- **Issue:** Error classification uses string message matching which is fragile across Node versions/platforms. Expected errors may be re-thrown as unexpected, or unexpected errors may be silently swallowed.
- **Fix:** Use error codes where available:
  ```typescript
  const errorCode =
    autofixErr instanceof Error && "code" in autofixErr
      ? String((autofixErr as NodeJS.ErrnoException).code)
      : null;
  const isExpectedError =
    errorCode === "ENOENT" || errorCode === "EACCES" || errorMessage.includes("validation");
  ```

### 6. Unnecessary Empty String in Windows Command

- **Location:** `source/app.tsx:1398`
- **Severity:** Medium
- **Status:** ✅ FIXED
- **Issue:** The Windows `start` command includes an empty string argument: `args = ["/c", "start", "", activePlanFilePath]`
- **Fix:** Remove the empty string: `args = ["/c", "start", activePlanFilePath]`

### 7. Missing Test for Critical Tool Failure

- **Location:** `source/tools/index.ts:39-42`
- **Severity:** High
- **Issue:** No test for the "fail fast" behavior when critical tools (read, edit) fail to load. This could allow silent failures for essential functionality.
- **Fix:** Add test in `source/tools/index.test.ts`:
  ```typescript
  it("throws error when critical read tool fails to load", async () => {
    const readOnlyTransport = createMockTransport({
      readFile: vi.fn().mockRejectedValue(new Error("Critical read failure")),
    });
    await expect(loadTools(readOnlyTransport, signal, mockConfig, undefined, null)).rejects.toThrow(
      'Critical tool "read" failed to load',
    );
  });
  ```

### 8. Missing Test for "Still Initializing" Path

- **Location:** `source/state.ts:500-504`
- **Severity:** Medium
- **Issue:** No test for early return when `activePlanFilePath` is null in plan mode (initialization not complete).
- **Fix:** Add test verifying the notification and early return behavior.

### 9. Missing Database Migration Error Handling

- **Location:** `source/db/migrate.ts:33-35`
- **Severity:** High
- **Issue:** The `drizzleMigrate` call lacks try-catch and could crash on migration failure.
- **Fix:** Wrap in try-catch with proper error logging.

### 10. Path Sanitization Inconsistency

- **Location:** `source/plan-mode.ts:15, 39`
- **Severity:** Medium
- **Issue:** Sanitization is applied to git branch names but not to `path.basename(cwdPath)` fallback, creating a potential path injection vulnerability.
- **Fix:** Apply same sanitization to cwd fallback:
  ```typescript
  branchName = path.basename(cwdPath).replace(/[^a-zA-Z0-9_-]/g, "-");
  ```

### 11. Weak UiState Encapsulation

- **Location:** `source/state.ts:93-107`
- **Severity:** Medium
- **Issue:** Individual setters allow invalid state transitions (e.g., clearing `activePlanFilePath` while in plan mode). Invariants exist only as comments, not as type guarantees.
- **Fix:** Consolidate into atomic transition methods that enforce valid state:
  ```typescript
  setMode: (mode: ModeType) => {
    const planFilePath = get().sessionPlanFilePath;
    set({
      currentMode: mode,
      activePlanFilePath: mode === "plan" ? planFilePath : null,
      planFileInitialized: mode === "plan" ? false : get().planFileInitialized,
    });
  },
  ```

---

## Suggestions (Nice to Have)

### 12. Log Severity for Expected Errors

- **Location:** `source/state.ts:488, 746, 763`
- **Status:** 🟡 PARTIALLY FIXED
- **Issue:** Expected/recoverable errors are logged at "error" level, creating noise in error logs for normal operation scenarios.
- **Suggestion:** Use `logger.log("verbose", ...)` for expected/recoverable errors instead of `logger.error()`.

### 13. Redundant Default Case

- **Location:** `source/app.tsx:1478`
- **Issue:** The switch statement has `default: return null;` when the function already returns null implicitly.
- **Suggestion:** Remove the redundant default case.

### 14. Missing MODE_NOTIFICATIONS Test

- **Location:** `source/modes.ts:25-29`
- **Issue:** The `MODE_NOTIFICATIONS` constant is exported but has no tests verifying notification strings match their corresponding modes.
- **Suggestion:** Add a test verifying each mode has a corresponding notification.

### 15. Missing leavePlanMode Test

- **Location:** `source/state.ts:302-308`
- **Issue:** The `leavePlanMode` state setter is exported but not directly tested (only indirectly through `exitPlanModeAndImplement` tests).
- **Suggestion:** Add direct unit tests for `leavePlanMode`.

### 16. Version Check Error Masking

- **Location:** `source/app.tsx:389-400`
- **Issue:** All errors in version check are silently ignored without distinguishing network failures from schema validation bugs.
- **Suggestion:** Log schema/parse errors at a higher level than network errors.

---

## Type Design Analysis

| Type                  | Encapsulation | Invariant Expression | Usefulness | Enforcement | Overall  |
| --------------------- | ------------- | -------------------- | ---------- | ----------- | -------- |
| `ModeType`            | 7/10          | 9/10                 | 8/10       | 9/10        | **8.25** |
| `PlanModeConfig`      | 9/10          | 10/10                | 10/10      | 10/10       | **9.75** |
| `PlanWrittenItem`     | 6/10          | 7/10                 | 7/10       | 5/10        | **6.25** |
| `UiState` new fields  | 4/10          | 6/10                 | 7/10       | 4/10        | **5.25** |
| `exitPlanMode` params | 5/10          | 8/10                 | 8/10       | 2/10        | **5.75** |
| `PLAN_MODE_TOOLS`     | 7/10          | 6/10                 | 9/10       | 8/10        | **7.50** |

**Best Type:** `PlanModeConfig` is an excellent example of discriminated unions making illegal states unrepresentable.

**Weakest Area:** The `UiState` new fields have poor encapsulation with weak invariant enforcement.

---

## Test Coverage Summary

**Overall Quality:** 8/10

### Strengths

- Exceptional error handling coverage in `plan-mode.test.ts` (mkdir errors, writeFile errors, abort signal handling)
- Comprehensive edge case coverage (empty branch names, special characters, non-git repository fallbacks)
- Good state management testing (history clearing, mode transitions, write-plan tool)
- Well-structured write-plan tests (line count calculations, error wrapping)

### Gaps

1. Missing test for critical tool failure loading
2. Missing test for "still initializing" early return path
3. Missing integration test for lazy plan file initialization
4. Limited `trajectory-arc.test.ts` coverage (only 3 tests, all argument verification)

---

## Security Considerations

1. **Tool Restrictions:** Plan mode correctly restricts tools to read-only + write-plan only, preventing destructive operations.
2. **Path Sanitization:** Branch names are sanitized to prevent directory traversal, but the cwd fallback needs the same treatment.
3. **Shell Injection:** The git command uses proper timeout and signal handling.

---

## Recommended Action Plan

1. **Fix critical issues first:**
   - [x] Add error handling for `transport.cwd()` in plan-mode.ts
   - [x] Exit plan mode when initialization fails instead of continuing
   - [ ] Fix race condition in plan initialization

2. **Address important issues:**
   - [ ] Fix overly broad catch block with system error code checking
   - [ ] Improve error classification in trajectory-arc.ts
   - [x] Remove unnecessary empty string in Windows command
   - [ ] Add test for critical tool failure
   - [ ] Add test for "still initializing" path
   - [ ] Add error handling for database migration
   - [ ] Apply path sanitization to cwd fallback
   - [ ] Consolidate state setters into atomic transitions

3. **Consider suggestions** for code polish
   - [ ] Improve log severity for expected errors

4. **Re-run review after fixes** to verify resolution

---

## Positive Observations

- **Excellent discriminated union design** (`PlanModeConfig`) making illegal states unrepresentable
- **Comprehensive test coverage** for error scenarios including abort signal handling
- **Good error handling practices** with abort signal checks and context-rich error messages
- **Security-conscious** tool restrictions in plan mode
- **Well-documented** state fields with clear JSDoc comments explaining the relationship between `activePlanFilePath`, `sessionPlanFilePath`, and `currentMode`
- **Type-safe mode management** using const assertion tuples

---

## Verified External Issues

### Issue #4: Manual percentage string handling - NOT APPLICABLE

**File**: `packages/database/src/validations/pollResult.ts:4-10`

**Status**: ❌ **False Positive - File Does Not Exist**

**Verification Date**: 2026-02-01

**Findings**:

- No `packages/` directory exists in this codebase
- No `database/` directory exists at any level
- No `validations/` directory exists
- No `pollResult.ts` file exists anywhere in the project
- Project does not use Zod (not in package.json dependencies)
- Database code uses Drizzle ORM, not Zod for validation
- No manual percentage string handling code exists in source files

**Conclusion**: This issue was reported by an automated code review tool scanning a different repository or template. The described code pattern does not exist in the octofriend codebase.

---

_Review generated by Claude Code PR Review Toolkit_
