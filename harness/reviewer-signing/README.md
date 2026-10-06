# Reviewer signing browser checks

From the SDK worktree, run:

```sh
node harness/reviewer-signing/run.cjs
```

No installation, SDK build, backend, auth, or Kiwi environment is required. This
local check borrows `esbuild` from the sibling main `feathery-frontend/node_modules`;
override with `SIGNING_TOOLING_ROOT`. Playwright and its test assertions come from
`hosted-forms-next/node_modules` (1.57.0, matching installed Chromium 1200); override
with `SIGNING_PLAYWRIGHT_ROOT`. The frontend's older Playwright 1.53.0 exhibited
screenshot timeouts with this newer browser, so use the matched installation.
React and ReactDOM resolve from this SDK's existing node_modules.

The script uses Playwright's installed Chromium, or cached macOS ARM headless
shell revision 1200/1234. Set `SIGNING_BROWSER` to override the executable. Cached
fallback versions differ from Playwright's pin; the actual version is printed.
No browser downloads are performed.

Each scenario runs in a fresh offline browser context with service workers
blocked and every request aborted. The actual DocumentViewer and signing modal
are bundled in memory with Emotion styles. PDF loading stays pending and the
browser utility module supplies only DOM helpers, avoiding unrelated SDK imports.
Finalize records arguments and waits for an explicit mock result; no real API
client is mounted. This verifies UI/callback behavior, not PDF or backend behavior.

Desktop (1280×900) and mobile (390×844, touch) checks cover validation, recipient
mapping across documents, email edits, Back, pending submission, retry, draft,
keyboard trapping, Escape and Close focus restoration, omitted blank email
overrides versus explicitly cleared presets, and viewport fit, including a host
page scrolled down 700px before mounting the viewer. Failures return
exit code 1. Screenshots and results.json go into a unique `/tmp/reviewer-signing-*`
directory; override with `SIGNING_OUTPUT`. No artifacts are written to the repo.
