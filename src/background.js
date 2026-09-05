// The background does one thing: open the settings the first time the extension is
// installed, so the person sees where the address and token go. Capturing itself runs
// from the popup, in response to a click; nothing here reads any page.
const ext = globalThis.browser ?? globalThis.chrome;

ext.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    ext.runtime.openOptionsPage();
  }
});
