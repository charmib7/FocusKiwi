const siteName = document.querySelector("#site-name");
const site = new URLSearchParams(window.location.search).get("site");

if (site) siteName.textContent = site;