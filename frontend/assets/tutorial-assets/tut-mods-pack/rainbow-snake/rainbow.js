// Rainbow Snake — recolors the snake every step
(function () {
  let hue = 0;
  window.MODS.onStep = (G) => {
    hue = (hue + 8) % 360;
    G.snakeColor = `hsl(${hue}, 85%, 55%)`;
  };
})();
