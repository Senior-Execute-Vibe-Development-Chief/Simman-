// ── One home for every floating surface ─────────────────────────────────────
// Popovers, drawers and full-screen documents all live on a single ordered
// stack in this external store. The rules that end the overlap-and-orphan
// mess of per-surface booleans:
//   · POPOVERS (menu, layers) are exclusive — opening one closes the others.
//   · DRAWERS (levers, editor, wind) are exclusive with each other — two of
//     them docked to the same edge used to overlap.
//   · DOCUMENTS (chronicle, dynasty, tech tree, help, new-world) stack.
//   · Esc closes the TOP of the stack, whatever it is.
//   · z-index comes from kind + stack position — never hand-picked again.
// The store is external (useSyncExternalStore) so any component can open or
// close surfaces without threading setters through the tree.

import { useSyncExternalStore } from "react";

let stack = [];                 // [{id, kind}] bottom → top
const subs = new Set();
const emit = () => { for (const f of subs) f(); };

const EXCLUSIVE = { popover: true, drawer: true, document: false };

export function openSurface(id, kind = "popover") {
  stack = stack.filter((s) => s.id !== id);
  if (EXCLUSIVE[kind]) stack = stack.filter((s) => s.kind !== kind);
  stack = [...stack, { id, kind }];
  emit();
}
export function closeSurface(id) {
  const n = stack.filter((s) => s.id !== id);
  if (n.length !== stack.length) { stack = n; emit(); }
}
export function toggleSurface(id, kind = "popover") {
  if (stack.some((s) => s.id === id)) closeSurface(id); else openSurface(id, kind);
}
/** Close the top surface. Returns true if something was closed. */
export function closeTopSurface() {
  if (!stack.length) return false;
  stack = stack.slice(0, -1);
  emit();
  return true;
}
export function isSurfaceOpen(id) { return stack.some((s) => s.id === id); }

const getSnap = () => stack;
const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };
export function useSurfaceStack() { return useSyncExternalStore(subscribe, getSnap); }

const Z_BASE = { drawer: 30, popover: 44, document: 60 };
/** z-index for a surface id given the current stack (monotonic within kind). */
export function surfaceZ(stackArr, id) {
  const i = stackArr.findIndex((s) => s.id === id);
  if (i < 0) return 0;
  return Z_BASE[stackArr[i].kind] + i;
}
