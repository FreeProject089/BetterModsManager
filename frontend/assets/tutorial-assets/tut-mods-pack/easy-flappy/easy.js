// Easy Flappy — softer gravity, wider pipe gaps, gentler jump
(function () {
  const G = window.GAME;
  if (!G) return;
  G.gravity = 0.32;
  G.jump    = -6.5;
  G.pipeGap = 180;
  G.birdColor = '#a78bfa';
})();
