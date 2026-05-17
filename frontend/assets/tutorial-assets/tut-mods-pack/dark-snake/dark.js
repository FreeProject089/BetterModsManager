// Dark Snake — removes the grid and applies a dark monochrome palette
(function () {
  const G = window.GAME;
  if (!G) return;
  G.bgGrid     = false;
  G.snakeColor = '#e5e7eb';
  G.foodColor  = '#f43f5e';
})();
