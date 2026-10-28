# Focus Kiwi

A small Chrome extension for timed study sessions with focus and break periods. Chosen websites are blocked during focus periods.

## Install in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select this folder.
4. Open the Focus Kiwi toolbar button, add sites, set the focus, break, and total study lengths, then start a session.

Settings and the site list are locked while a session is active. The extension reloads open tabs at session start, at each focus/break transition, and when the session ends so the blocking rules apply immediately. Blocking applies to main-page navigations for each listed domain and its subdomains. A navigation-event fallback redirects sites rendered directly from a service worker or CacheStorage to the extension's blocked page; this avoids clearing the site's stored data.

Study sessions are saved independently of the popup and Chrome windows. Closing all windows does not cancel a session. If Chrome is fully shut down, the session's wall-clock schedule is restored on the next launch; phase changes and tab reloads can only run while Chrome is open.