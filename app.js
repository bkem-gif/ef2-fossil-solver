/*
 * EF2 Fossil Excavation solver — boot.
 * Sets the colour theme and mounts the exact game-read view (live.js).
 */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('fx-theme', theme); } catch (e) { /* private mode */ }
    var btn = $('btnTheme');
    if (btn) btn.textContent = theme === 'dark' ? '☀' : '🌙';
  }

  var saved = null;
  try { saved = localStorage.getItem('fx-theme'); } catch (e) { /* ignore */ }
  setTheme(saved || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

  var bt = $('btnTheme');
  if (bt) bt.onclick = function () {
    setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  };

  if (window.FXLive) FXLive.init($('app'));
})();
