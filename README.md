# Focus Kiwi

A small Chrome extension for timed study sessions with focus and break periods. Chosen websites are blocked during focus periods.

## Install in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select this folder.
4. Open the Focus Kiwi toolbar button, add sites, set the focus, break, and total study lengths, then start a session.

## Session behavior

- Focus, break, and total study durations cannot be changed during an active session.
- Sites can be added during focus, but cannot be removed until the session ends. Site editing is disabled during breaks.
- Adding a site during focus updates blocking rules immediately and reloads only already-open tabs on that domain and its subdomains.
- At the end of focus, only tabs showing Focus Kiwi's blocked page are reloaded. At the end of a break, only tabs on listed domains are reloaded. Session completion reloads only tabs relevant to the phase that ended.
- Starting a session reloads open tabs so blocking takes effect immediately.

## Blocking behavior

Blocking applies to main-page navigations for each listed domain and its subdomains. A navigation-event fallback redirects pages served directly by a service worker or CacheStorage to the extension's blocked page, without clearing the site's stored data.

## Session persistence

Study sessions are saved independently of the popup and Chrome windows. Closing all windows does not cancel a session. If Chrome is fully shut down, the session's wall-clock schedule is restored on the next launch; phase changes and tab reloads can only run while Chrome is open.