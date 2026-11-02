// Vite transforms syntax; WebViews with a standard URL constructor can still lack canParse.
// Load the missing feature without shipping a replacement URL implementation.
import "core-js/modules/web.url.can-parse.js";
