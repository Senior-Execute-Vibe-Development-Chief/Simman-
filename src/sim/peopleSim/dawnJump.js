// Mint-ready foresight entry — implementation lives in crystallize.js so the
// gather pass is same-module (avoids a dawnJump↔crystallize circular import
 // that could open at invent-only). Re-exported here for a stable import path.

export { jumpToCivReady } from "./crystallize.js";
