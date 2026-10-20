// Late-bound hooks so views and actions can navigate without importing main.js (avoids import cycles).
export const nav = {
  go: (_view, _arg) => {},
  capture: () => {},
  palette: (_q) => {},
};
