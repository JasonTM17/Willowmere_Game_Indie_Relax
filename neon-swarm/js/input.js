/* NEON SWARM - js/input.js
 * Keyboard + mouse with per-frame edge detection.
 * Public global: window.GameInput (alias GI). Contract: DESIGN.md section 5.2.
 *
 * Mouse position is stored in CSS px relative to the canvas (the canvas fills
 * the window, so clientX/Y equals it, but the rect offset is applied anyway so
 * the value stays correct if the page ever changes shape).
 */
(function () {
  'use strict';

  var GU = window.GameUtil;

  var keys = new Set();              // currently held e.code values
  var pressedThisFrame = new Set();  // e.code values that went down this frame
  var mouse = { x: 0, y: 0, down: false };
  var clickQueued = false;
  var bound = false;
  var canvas = null;

  // Keys that must not scroll or move focus the page.
  var PREVENT = { Space: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Tab: 1 };

  function onKeyDown(e) {
    if (PREVENT[e.code]) e.preventDefault();
    keys.add(e.code);
    if (!e.repeat) pressedThisFrame.add(e.code);
  }

  function onKeyUp(e) {
    keys.delete(e.code);
  }

  function onMouseMove(e) {
    if (canvas) {
      var r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
    } else {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    }
  }

  function onMouseDown(e) {
    if (e.button !== 0) return; // left button only
    mouse.down = true;
    clickQueued = true;
  }

  function onMouseUp(e) {
    if (e.button !== 0) return;
    mouse.down = false;
  }

  // Focus lost: drop everything so no key/shot sticks after alt-tab.
  function onBlur() {
    keys.clear();
    pressedThisFrame.clear();
    mouse.down = false;
    clickQueued = false;
  }

  var GI = {
    keys: keys,
    mouse: mouse,
    pressedThisFrame: pressedThisFrame,

    // Attaches window listeners exactly once.
    bind: function (c) {
      if (bound) return;
      bound = true;
      canvas = c || null;
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mousedown', onMouseDown);
      window.addEventListener('mouseup', onMouseUp);
      window.addEventListener('blur', onBlur);
      document.addEventListener('mouseleave', function () { mouse.down = false; });
      if (canvas) {
        canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      }
    },

    // Normalized WASD + arrow movement axis.
    axis: function () {
      var x = 0;
      var y = 0;
      if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) y += 1;
      if (keys.has('KeyW') || keys.has('ArrowUp')) y -= 1;
      return GU.norm(x, y);
    },

    // True on the frame the key went down (e.code form, e.g. 'KeyW').
    justPressed: function (code) {
      return pressedThisFrame.has(code);
    },

    anyJustPressed: function () {
      return pressedThisFrame.size > 0;
    },

    // True once per mousedown; the first caller consumes it.
    consumeClick: function () {
      var v = clickQueued;
      clickQueued = false;
      return v;
    },

    // Called by main at the end of every frame; clears per-frame state.
    endFrame: function () {
      pressedThisFrame.clear();
      clickQueued = false;
    }
  };

  window.GameInput = GI;
})();
