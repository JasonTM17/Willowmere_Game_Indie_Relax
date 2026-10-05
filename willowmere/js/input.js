/* Willowmere — input.js · window.WInput
   Bind-once keyboard + mouse. Leaf library: never calls game layers.
   - Actions: move WASD/arrows · interact E/Enter/Space · net Q · fish F ·
     pause Esc/P · menus use up/down/left/right.
   - pressed() = edge-true for one frame; consume() takes the edge away.
   - mouse is in CSS-pixel canvas space {x,y,inside,clicked,released}.
   - endFrame() clears all edges; the main loop calls it last every frame.
   - Input ignored while document.hidden; blur clears all held state. */
(function () {
  'use strict';

  var ACTIONS = {
    up: ['KeyW', 'ArrowUp'],
    down: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    interact: ['KeyE', 'Enter', 'Space'],
    net: ['KeyQ'],
    fish: ['KeyF'],
    pause: ['Escape', 'KeyP']
  };

  /* code -> [actions] */
  var forCode = {};
  (function buildIndex() {
    for (var a in ACTIONS) {
      if (!ACTIONS.hasOwnProperty(a)) continue;
      var list = ACTIONS[a];
      for (var i = 0; i < list.length; i++) {
        if (!forCode[list[i]]) forCode[list[i]] = [];
        forCode[list[i]].push(a);
      }
    }
  })();

  /* stop the page from scrolling on game keys */
  var PREVENT = {
    ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Space: 1
  };

  var keys = {};          // code -> bool
  var edges = {};         // action -> bool (this-frame press)
  var edgeList = [];      // actions pressed this frame (for O(n) clearing)
  var mouse = { x: 0, y: 0, inside: false, clicked: false, released: false };
  var AXIS = { x: 0, y: 0 };

  var canvas = null;
  var attached = false;

  function onKeyDown(e) {
    if (document.hidden) return;
    var c = e.code;
    if (PREVENT[c]) e.preventDefault();
    if (!keys[c]) {
      keys[c] = true;
      var acts = forCode[c];
      if (acts) {
        for (var i = 0; i < acts.length; i++) {
          var act = acts[i];
          if (!edges[act]) {
            edges[act] = true;
            edgeList.push(act);
          }
        }
      }
    }
  }

  function onKeyUp(e) {
    keys[e.code] = false;
  }

  function onBlur() {
    keys = {};
    edgeList.length = 0;
    for (var k in edges) if (edges.hasOwnProperty(k)) edges[k] = false;
    mouse.x = 0; mouse.y = 0;
    mouse.inside = false; mouse.clicked = false; mouse.released = false;
  }

  function updateMousePos(e) {
    var r = canvas.getBoundingClientRect();
    mouse.x = e.clientX - r.left;
    mouse.y = e.clientY - r.top;
    mouse.inside = mouse.x >= 0 && mouse.y >= 0 &&
                   mouse.x < r.width && mouse.y < r.height;
  }

  function onMouseMove(e) { if (!attached) return; updateMousePos(e); }

  function onMouseDown(e) {
    if (!attached || document.hidden) return;
    if (e.button !== 0) return;
    e.preventDefault();
    updateMousePos(e);
    mouse.clicked = true;
  }

  function onMouseUp(e) {
    if (!attached) return;
    if (e.button !== 0) return;
    updateMousePos(e);
    mouse.released = true;
  }

  function onMouseLeave() {
    mouse.inside = false;
  }

  function attach(cv) {
    if (attached || !cv) return;
    attached = true;
    canvas = cv;
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    cv.addEventListener('mousemove', onMouseMove);
    cv.addEventListener('mousedown', onMouseDown);
    cv.addEventListener('mouseup', onMouseUp);
    cv.addEventListener('mouseleave', onMouseLeave);
  }

  function down(action) {
    var list = ACTIONS[action];
    if (!list) return false;
    for (var i = 0; i < list.length; i++) {
      if (keys[list[i]]) return true;
    }
    return false;
  }

  function pressed(action) {
    return edges[action] === true;
  }

  /* Take the edge: true once, then cleared until the next press. */
  function consume(action) {
    if (edges[action]) {
      edges[action] = false;
      return true;
    }
    return false;
  }

  /* Normalised movement axis (diagonals scaled to length 1). */
  function axis() {
    var x = (down('right') ? 1 : 0) - (down('left') ? 1 : 0);
    var y = (down('down') ? 1 : 0) - (down('up') ? 1 : 0);
    if (x !== 0 && y !== 0) { x *= 0.7071; y *= 0.7071; }
    AXIS.x = x;
    AXIS.y = y;
    return AXIS;
  }

  /* Clear one-frame edges. Main calls this LAST in every frame. */
  function endFrame() {
    for (var i = 0; i < edgeList.length; i++) edges[edgeList[i]] = false;
    edgeList.length = 0;
    mouse.clicked = false;
    mouse.released = false;
  }

  window.WInput = {
    attach: attach,
    axis: axis,
    down: down,
    pressed: pressed,
    consume: consume,
    endFrame: endFrame,
    mouse: mouse,
    ACTIONS: ACTIONS,
    isAttached: function () { return attached; }
  };
})();
