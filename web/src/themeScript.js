// The mode's storage key and the script that applies the remembered mode before the first paint
// (inlined in app/layout.js, a server component, so this file has no React).
export const THEME_KEY = "tenderos-theme";

/** Runs before the first paint (inlined in app/layout.js) so the page never flashes the other mode. */
export const PRE_PAINT = `(function(){try{var m=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(m!=="light")m="dark";var d=document.documentElement;d.dataset.theme=m;d.style.colorScheme=m;}catch(e){}})();`;
