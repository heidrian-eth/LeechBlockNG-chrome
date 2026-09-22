# Local security changes

Personal fork of [proginosko/LeechBlockNG-chrome](https://github.com/proginosko/LeechBlockNG-chrome)
(forked at `dbbaed37`, v1.7.3) with the following hardening applied.

## 1. Restrict who may talk to the background worker

`manifest.json` injects `blocked.js` into **any** page whose URL contains the
string `lb-custom`, so any website could reach the extension's message handler.
`background.js` now checks the sender before acting:

* `isExtensionSender()` — messages that change extension state (`add-sites`,
  `close`, `discard-time`, `lockdown`, `options`, `override`, `reset-rollover`,
  `restart`, `tick`) are accepted only from this extension's own pages.
* `getBlockPageSets()` — messages from a blocking page (`blocked`, `delayed`,
  `password`) are accepted only from this extension's own pages or from the
  origin of a custom blocking page actually configured in the options. It
  returns *which* sets that origin may act on, and `delayed` / `password` /
  `createBlockInfo()` refuse a set outside that list. An origin configured as
  the blocking page for one set cannot read or unblock another.

The comparison uses `sender.origin`, the real security origin, falling back to
`sender.url` only when it is absent, and requires a top-level document
(`frameId === 0`). A sandboxed document is rejected because Chrome reports its
origin as opaque, which `sender.url` alone would not reveal.

This closes three issues:

* **Config disclosure.** `createBlockInfo()` was answering any site, which then
  read block set names, custom block messages, custom CSS, theme, unblock time
  and the last matched keyword back out of the shared DOM.
* **Block bypass.** `createBlockInfo()` takes the set and the blocked URL from
  the sender page's own query string, so a page at
  `https://evil.example/lb-custom?1&https://target.example/` could let its
  delay countdown finish, send a `delayed` message, and have `target.example`
  whitelisted in that tab and navigated to.
* **Fingerprinting via the message handler.** See "Not changed" for the part
  of this that remains open.

## 2. Origins are compared with the URL parser, not `PARSE_URL`

`getURLOrigin()` uses `new URL().origin`. The repo's own `PARSE_URL` regexp
cannot be used for a trust decision: its userinfo group only accepts `\w`, so
in `https://trusted.example@evil.example/lb-custom` it reads the host as
`trusted.example` and swallows `@evil.example/lb-custom` as the path. Any
attacker origin could therefore impersonate a configured blocking page. The
URL parser also normalises default ports, case, punycode and IPv6 literals,
and yields an opaque origin (rejected) for `file:` documents.

## 3. Never send the password to the blocking page

`createBlockInfo()` used to return the configured password in cleartext to
`blocked.js`, which compared it locally with `hashCode32`. Since `blocked.js`
ran on attacker-supplied pages, and content-script DOM handlers fire for events
the page dispatches itself, a site could drive the password form in a loop and
distinguish success from failure — an unthrottled guessing oracle.

* `createBlockInfo()` now returns only `passwordRequired: <boolean>`, and
  `blocked.js` disables the form when no password is configured.
* `checkSetPassword()` in `background.js` does the comparison, limited to 5
  attempts per block set followed by a 60-second lockout. The counter is keyed
  by set rather than by tab, so it cannot be reset by opening another tab. It
  still lives in worker memory, so a service worker restart clears it.
* `blocked.js` submits the typed password and acts on the `{allowed}` reply.

This fails closed: a set configured with the password page but a blank password
can no longer be unblocked by submitting an empty string.

## 4. Stop backing passwords up to Chrome Sync

`saveOptions()` calls `exportOptionsSync()` on every save when `autoExportSync`
is on (the default), and that call passed `true` for "include passwords" — so
access, override and per-set passwords were pushed to Google's sync servers in
cleartext even with sync storage switched off. It now honours the same
`exportPasswords` opt-in as the file exports (default off), and with the opt-in
off deletes `password`, `orp` and `passwordSetSpec<n>` from sync storage so
copies uploaded by earlier versions do not linger.

The purge is skipped when sync storage is the *primary* store, where those keys
are the live passwords rather than a backup. The caller passes that flag in
rather than re-reading it, which would race with the save writing it. Note the
purge only removes old copies once the options are saved or exported.

Because most backups now have no password keys, import had to change too.
`cleanAndApplyImportOptions()` reads the current password fields before
`applyImportOptions()` rebuilds the form from its pristine HTML, and puts them
back into the options, so an import that omits passwords no longer blanks them.
Upstream did this for `password` and `orp` but not for `passwordSetSpec<n>`.

## 5. Treat stored config as untrusted in the UI

Replaced `.html()` with `.text()` / DOM construction where option values are
rendered, so a set name or custom message from an imported options file cannot
execute script with extension privileges:
`override.js` (set list, limit counters, end time), `add-sites.js` (block set
dropdown), `options.js` (access-prevent times, clock offset).

`createRegExps()` also compiles imported `regexpBlock` / `regexpAllow` /
`referRE` inside a `try`. An invalid expression used to throw during worker
initialization, which left nothing blocked at all. `content.js` does the same
for the keyword expression, which it compiles itself; throwing there meant the
worker never got an answer and the page was never blocked.

## 6. Misc

* `createAccessCode()` uses `crypto.getRandomValues()` with rejection sampling
  instead of `Math.random()`.
* `initTab()` guards in the `focus` / `loaded` / `referrer` / `blocked` paths
  and in `allowBlockedPage()`, which previously threw if the service worker had
  restarted.
* `checkSetPassword()` and `allowBlockedPage()` coerce the block set to a
  number before the range check. It arrives as a string from the blocking
  page's query string, and `"abc" < 1` and `"abc" > gNumSets` are both false,
  so a non-numeric set used to pass the guard.
* `allowBlockedPage()` validates the redirect URL before it touches any state.
  `BLOCKABLE_URL` has no colon boundary, so `http:` passed it, parsed to null
  fields, and left a host- and path-unrestricted allowance behind. The redirect
  now uses `ALLOWED_REDIRECT_SCHEME` and requires a parsable host.
* `allowBlockedPage()` cross-checks the host from `PARSE_URL` against the URL
  parser. `PARSE_URL` reads the host of `https://target.example@evil.example/`
  as `target.example`, and the generated block patterns accept that userinfo
  too, so a crafted URL looked blocked and then left a real allowance for the
  target host once the delay finished.
* `gTabs[id].keyword` records which set matched it, so a custom blocking page
  for one set cannot be handed a stale keyword produced by another.
* The worker loads its options at startup (after managed storage is copied in)
  rather than waiting for the first tick. Until `gGotOptions` is set every
  custom blocking page is refused, so a restart used to leave one blank;
  `blocked.js` also retries its initial request.
* `getParsedURL()` returns the port, which it never did.

## Not changed

* The per-second `tabs.query({})` sweep and the six keep-alive alarms — that is
  the author's deliberate design; changing it breaks time accounting.
* `hashCode32` on the options/override access prompts — those compare against a
  value the page already holds in cleartext, so no trust boundary is crossed.
* Managed-storage validation — not relevant to a personal unpacked install.
* The `focus` / `loaded` / `referrer` messages. These come from `content.js` on
  every page, so they cannot be gated by origin. A page cannot send them
  directly (there is no `externally_connectable`, so only this extension's own
  content scripts reach the worker), but it shares the DOM with the content
  script, so it can dispatch synthetic `focus` / `blur` events to drive them.
  That skews document-focus accounting, which is currently only used on
  Android. `content.js` reports `document.URL`, which a page can change only
  within its own origin via `pushState`.
* **Extension fingerprinting is still trivial.** `content.css` is injected into
  almost every page, and any page can detect the `.leechblock-timer` rules with
  `getComputedStyle()`. Only the fingerprint via the message handler is closed.
* `lockdown.js`, `stats.js` and `diagnostics.js` already render set names as
  text, so they needed no change.

## Trusting a remote custom blocking page

A custom blocking page is trusted with a lot, and the checks above only
establish *which origin* is talking. Any page on a configured origin can read
that set's block info, complete its delay, and receive the password the user
types into the form. Use an origin you control, and do not put a custom
blocking page on shared hosting.

## Build note

`jquery-ui/` is gitignored upstream and absent from the repo, but
`options.html`, `stats.html`, `lockdown.html`, `override.html`,
`add-sites.html` and `diagnostics.html` all load it. Download jQuery UI and
unpack it into `jquery-ui/` (needs `jquery-ui.min.js`, `jquery-ui.min.css` and
`external/jquery/jquery.js`) before loading this as an unpacked extension, or
every page except the popup will fail with `$ is not defined`.
