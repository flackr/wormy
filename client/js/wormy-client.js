/**
 * Wormy multiplayer worm game.
 *
 * Author: Robert Flack (flackr@gmail.com)
 */

wormy.Client = function() {
  function $(id) {
    return document.getElementById(id);
  }

  var requestAnimFrame =
      window.requestAnimationFrame ||
      window.webkitRequestAnimationFrame ||
      window.mozRequestAnimationFrame ||
      window.oRequestAnimationFrame ||
      window.msRequestAnimationFrame ||
      function(callback) {
        window.setTimeout(callback, 0);
      };

  var pageHidden = function() {
    return document.hidden ||
           document.mozHidden ||
           document.msHidden ||
           document.webkitHidden;
  }

  function hexToInt(hex) {
    var hexChars = "123456789abcdef";
    var val = 0;
    for (var i = 0; i < hex.length; i++) {
      val = val * 16 + hexChars.indexOf(hex[i]) + 1;
    }
    return val;
  }

  function hexToRgb(hex) {
    if (hex[0] == '#')
      hex = hex.substr(1);
    if (hex.length == 3)
      hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    var rgb=[0,0,0];
    for (var i=0; i < 3; i++) {
      rgb[i] = hexToInt(hex.substr(i*2, 2));
    }
    return rgb;
  }

  var drawStyle = ['#000', // Background colour.
                   '#800', // Wall colour.
                   '#760', // Food colour.
                   // Player colours.
                   '#ff0', '#f00', '#0f0', '#55f',
                   '#f0f', '#f80', '#aaa', '#f8f',
                   '#080', '#80a', '#fb6', '#88f',
                   '#a06', '#0ee', '#9a4', '#22f'];
  var spriteSize = 32;
  var spriteColour = '#ff1de0';

  // Controls are keyCode values for Up, Right, Down, Left, Join, Quit.
  var controls = [[38, 39, 40, 37, 32, 27],
                  [87, 68, 83, 65, 69, 81],
                  [73, 76, 75, 74, 79, 85]];

  function merge(a, b) {
    var r = {};
    for (var i in a)
      r[i] = a[i];
    for (var i in b)
      r[i] = b[i];
    return r;
  }

  var Client = function() {
    wormy.Game.apply(this);

    this.oos = true;
    this.dialog = null;
    this.socket = undefined;
    this.canvas = document.getElementById('gameCanvas');
    this.flags = {
      retro: false,
    };
    this.localPlayers_ = [];
    for (var i = 0; i < controls.length; i++)
      this.localPlayers_.push({w:-1,queue:0});
    this.panel = $('gameinfo');

    this.initialize();
    this.layout();
    this.showDialog($('lobby'));

    window.addEventListener('resize', bind(this, this.layout));
    document.addEventListener('keydown', bind(this, this.handleKeyDown_));
    document.addEventListener('touchstart', bind(this, this.handleTouchStart_));
    document.addEventListener('visibilitychange', bind(this, this.handleBackground_));
    document.addEventListener('webkitvisibilitychange', bind(this, this.handleBackground_));
    document.addEventListener('mozvisibilitychange', bind(this, this.handleBackground_));
    document.addEventListener('msvisibilitychange', bind(this, this.handleBackground_));
//    document.addEventListener('click', bind(this, this.handleClick_));
  }

  Client.prototype = merge(wormy.Game.prototype, {
    initialize: function() {
      var s = new Image();
      var self = this;
      s.src = 'gfx/wormy.png';
      s.onload = function() {
        var players = drawStyle.length - 3;
        var spriteSheet = document.createElement('canvas');
        spriteSheet.width = s.width;
        spriteSheet.height = spriteSize * (players + 2);
        var ctx = spriteSheet.getContext('2d');
        ctx.drawImage(s, 0, 0, s.width, s.height);
        for (var i = 0; i < players; i++) {
          var data = ctx.getImageData(0, spriteSize, s.width, spriteSize);
          self.colourizeImageData(data, hexToRgb(spriteColour),
                                        hexToRgb(drawStyle[i + 3]));
          ctx.putImageData(data, 0, (i + 2) * spriteSize);
        }
        self.spriteSheet = spriteSheet;
      };

      var storage = (chrome && chrome.storage && chrome.storage.local) ||
          window.localStorage;
      if (typeof(Storage)!=="undefined" && storage) {
        for (var i = 0; i < this.localPlayers_.length; i++) {
          var name = 'name' + i;
          var el = $(name);
          if (el) {
            if (storage[name])
              el.value = storage[name];
            el.onchange = function() {
              storage[this.id] = this.value;
            }
          }
        }
      }

      $('create-game-dialog').style.display = lobby.serverCapable() ?
          '' : 'none';
      $('create-game').addEventListener('click', this.createGame.bind(this));
      this.gameLobby = $('wormy-game-list');
      lobby.GameLobby.setGameId('wormy');
      lobby.GameLobby.decorate(this.gameLobby);
      $('wormy-game-list').onSelectGame = function(game) {
        self.connectClient(new lobby.Client(game));
      };
    },

    createGame: function() {
      var self = this;
      var host = new lobby.Host($('wormy-game-list').getUrl().replace('http://', 'ws://'), parseInt($('game-port').value));
      window.server = new wormy.Server(host, $('game-name').value);
      host.addEventListener('ready', function(address) {
        self.connectClient(new lobby.Client(address));
      });
    },

    colourizeImageData: function(data, oldColour, colour) {
      var oldColourBrightness =
          (oldColour[0] + oldColour[1] + oldColour[2]) / 3;
      for (var x = 0; x < data.width; x++) {
        for (var y = 0; y < data.height; y++) {
          var src_i = (y * data.width + x) * 4;
          var dst_i = (y * data.width + x) * 4;
          // Compute average intensity.
          var bright = (data.data[src_i] +
                        data.data[src_i + 1] +
                        data.data[src_i + 2]) / 3;
          var factor = bright / oldColourBrightness
          var c = [factor * oldColour[0],
                   factor * oldColour[1],
                   factor * oldColour[2]];
          if (Math.abs(c[0] - data.data[src_i] < 30) &&
              Math.abs(c[1] - data.data[src_i + 1] < 30) &&
              Math.abs(c[2] - data.data[src_i + 2] < 30) &&
              data.data[src_i + 3] > 50) {
            for (var i = 0; i < 3; i++)
              data.data[dst_i + i] =
                  (bright / oldColourBrightness) * colour[i];
          }
        }
      }
    },

    showDialog: function(dialog) {
      if (!this.dialogListener) {
        var self = this;
        var stopProp = function(e) {
          e.stopPropagation();
        }
        dialog.listeners = [
          [document, {
            'click': bind(this, this.hideDialog),
            'touchstart': bind(this, this.hideDialog),
            'keydown': function(e) {
              if (e.keyCode == 13 || e.keyCode == 27)
                self.hideDialog();
            },
          }], [dialog, {
            'click': stopProp,
            'touchstart': stopProp,
          }],
        ];

        for (var i = 0; i < dialog.listeners.length; i++) {
          for (var j in dialog.listeners[i][1]) {
            dialog.listeners[i][0].addEventListener(
                j, dialog.listeners[i][1][j]);
          }
        }
      }
      $('dialogs').removeAttribute('hidden');
      if (this.dialog) {
        this.dialog.setAttribute('hidden', true);
      }
      this.dialog = dialog;
      this.dialog.removeAttribute('hidden');
      this.dialog.focus();
    },

    hideDialog: function() {
      if (this.dialog && this.dialog.listeners) {
        for (var i = 0; i < this.dialog.listeners.length; i++) {
          for (var j in this.dialog.listeners[i][1]) {
            this.dialog.listeners[i][0].removeEventListener(
                j, this.dialog.listeners[i][1][j]);
          }
        }
        this.dialog.listeners = null;
      }
      if (this.dialog) {
        $('dialogs').setAttribute('hidden', true);
        this.dialog.setAttribute('hidden', true);
        this.dialog = null;
      }
    },

    step: function() {
      wormy.Game.prototype.step.call(this);
      if (this.started) {
        this.requestDraw();
        this.dispatchQueuedCommands();
      }
    },

    requestDraw: function() {
      if (this.drawRequested) return;
      requestAnimFrame(bind(this, this.redraw));
      this.drawRequested = true;
    },

    // Dispatches a command and acts on it on this frame.
    dispatchImmediateCommand: function(cmd) {
      var evt = {f:this.frame, d:cmd};
      this.socket.emit('i', evt);
      this.addEvent(evt);
    },

    // Dispatches a command which the server will re-dispatch on the frame it
    // is received on. This is useful for things for which there may be a race
    // condition such as joining as a new worm where the order the server sees
    // the messages rules join order.
    dispatchDelayedCommand: function(cmd) {
      // The server will replay the message to us at the frame it is received.
      this.socket.emit('d', cmd);
    },

    changeDirection: function(player, newdir) {
      this.dispatchImmediateCommand(
          {t:'m', p:this.localPlayers_[player].w, d:newdir});
    },

    dispatchQueuedCommands: function() {
      for (var i = 0; i < this.localPlayers_.length; i++) {
        if (this.localPlayers_[i].w >= 0 && this.localPlayers_[i].queue) {
          this.handleDirection(i, this.localPlayers_[i].queue - 1);
          this.localPlayers_[i].queue = 0;
        }
      }
    },

    // Called when a worm is created, you take control immediately.
    takeControl: function(playerNo, localNo) {
      this.localPlayers_[localNo].w = playerNo;
      this.localPlayers_[localNo].queue = 0;
    },

    resetWorm_: function(worm) {
      // Only reset if the worm is dead and has no tail.
      if (this.state_.p[worm].s == 1 && this.state_.p[worm].t.length == 0)
        this.dispatchDelayedCommand({t: 'r', p: worm});
    },

    handleDirection: function(i, j) {
      if (this.localPlayers_[i].w < 0 ||
          this.state_.p[this.localPlayers_[i].w].s != 0 ||
          this.state_.p[this.localPlayers_[i].w].t.length == 0)
        return;
      if (this.localPlayers_[i].f == this.frame) {
        this.localPlayers_[i].queue = j + 1;
      } else {
        if ((j + 2) % 4 == this.state_.p[this.localPlayers_[i].w].t[0][2])
          return;
        this.localPlayers_[i].f = this.frame;
        this.changeDirection(i, j);
      }
    },

    handleClick_: function(e) {
      e.preventDefault();
      this.handlePointerAt(e.pageX, e.pageY);
    },

    handleTouchStart_: function(e) {
      e.preventDefault();
      if (e.touches.length == 1) {
        this.handlePointerAt(e.touches[0].pageX, e.touches[0].pageY);
      }
    },

    handlePointerAt: function(x, y) {
      var i = 0;
      if (this.localPlayers_[i].w >= 0) {
        if (this.state_.p[this.localPlayers_[i].w].s == 1) {
          this.resetWorm_(this.localPlayers_[i].w);
          return;
        }
        var cx = this.canvas.offsetWidth / 2 + this.canvas.offsetLeft;
        var cy = this.canvas.offsetHeight / 2 + this.canvas.offsetTop;
        var dx = x - cx;
        var dy = y - cy;
        if (Math.abs(dx) > Math.abs(dy)) {
          if (dx > 0)
            this.handleDirection(i, 1);
          else
            this.handleDirection(i, 3);
        } else {
          if (dy > 0)
            this.handleDirection(i, 2);
          else
            this.handleDirection(i, 0);
        }
      } else {
        this.socket.emit('start', [i, $('name'+i).value]);
      }
    },

    handleKeyDown_: function(e) {
      if (this.dialog)
        return;
      if (e.keyCode == 82) {
        this.flags.retro = !this.flags.retro;
        this.canvasState = null;
      } else {
        for (var i = 0; i < controls.length; i++) {
          if (this.localPlayers_[i].w >= 0) {
            for (var j = 0; j < controls[i].length; j++) {
              if (e.keyCode == controls[i][j]) {
                if (j < 4) {
                  this.handleDirection(i, j);
                  return;
                } else if (j == 4) {
                  // If the player is already playing and dead, revive.
                  if (this.state_.p[this.localPlayers_[i].w].s == 1) {
                    this.resetWorm_(this.localPlayers_[i].w);
                    return;
                  }
                } else if (j == 5) { // Disconnect.
                  this.dispatchDelayedCommand({t: 'd', p: i});
                  this.localPlayers_[i].w = -1;
                }
              }
            }
          } else if (e.keyCode == controls[i][4]) {
            this.socket.emit('start', [i, $('name'+i).value]);
          }    
        }
      }
    },

    handleBackground_: function() {
      if (pageHidden()) {
        if (this.started) {
          this.stop();
        }
      } else {
        if (!this.started && !this.pingStart) {
          this.pingServer();
        }
      }
    },

    pingServer: function() {
      if (this.pingStart || !this.connection_)
        return;
      this.pingStart = (new Date()).getTime();
      this.socket.emit('frame-ping');
    },

    resetPlayers: function(playerData) {
      var players = $('players').getElementsByClassName('player');
      for (var i = 0; i < players.length; i++)
        players[i].parentNode.removeChild(players[i]);
      for (var i = 0; i < playerData.length; i++)
        this.playerJoined(playerData[i][0], playerData[i][1]);
    },

    playerJoined: function(playerNo, name) {
      this.playerQuit(playerNo);  // Just in case.
      var players = $('players');
      var player = $('player').cloneNode(true);
      player.setAttribute('number', playerNo);
      player.removeAttribute('id');
      player.getElementsByClassName('name')[0].style.color =
          drawStyle[playerNo + 3];
      player.getElementsByClassName('name')[0].textContent = name;
      player.getElementsByClassName('bar')[0].style.backgroundColor =
          drawStyle[playerNo + 3];
      player.local = false;
      for (var i = 0; i < this.localPlayers_.length; i++) {
        if (this.localPlayers_[i].w == playerNo)
          player.local = true;
      }
      players.appendChild(player);
    },

    playerQuit: function(playerNo) {
      var players = $('players').getElementsByClassName('player');
      for (var i = 0; i < players.length; i++) {
        if (players[i].getAttribute('number') == playerNo)
          players[i].parentNode.removeChild(players[i]);
      }
    },

    playerPings: function(data) {
      var players = $('players').getElementsByClassName('player');
      for (var i = 0; i < players.length; i++) {
        var pno = parseInt(players[i].getAttribute('number'));
        for (var j = 0; j < data.length; j++) {
          if (pno == data[j][0]) {
            players[i].getElementsByClassName('ping')[0].textContent =
                '(' + data[j][1] + 'ms)';
          }
        }
      }
    },

    updateScores: function() {
      var playerScore = function(playerNode) {
        return (playerNode.local ? 100 : 0) + playerNode.progress;
      }
      var goal = this.getEndGoal();
      var players = Array.prototype.slice.call(
          $('players').getElementsByClassName('player'), 0);
      if (players.length == 0) return;
      var parentNode = players[0].parentNode;
      var inorder = true;
      for (var i = 0; i < players.length; i++) {
        var pno = parseInt(players[i].getAttribute('number'));
        var progress = 0;
        if (this.state_.p.length > pno && this.state_.p[pno].t)
          progress = this.state_.p[pno].t.length / goal;
        if (progress > 1) progress = 1;
        var pbar = players[i].getElementsByClassName('bar')[0];
        pbar.style.width = Math.round(100 * progress) + '%';
        players[i].progress = progress;
        if (i > 0 && playerScore(players[i - 1]) < playerScore(players[i]))
          inorder = false;
      }
      if (!inorder) {
        players.sort(function(a, b) {
          return playerScore(b) - playerScore(a);
        });
        for (var i = 0; i < players.length; i++)
          players[i].parentNode.removeChild(players[i]);
        for (var i = 0; i < players.length; i++)
          parentNode.appendChild(players[i]);
      }
    },

    connectClient: function(connection) {
      this.showDialog($('instructions'));
      this.connection_ = connection;
      this.socket = new LobbySocketAdapter(this.connection_);

      var self = this;
      this.socket.on('load', function(data) {
        self.stop();
        self.frame = data.f;
        self.reset(data.s);
        self.layout();
        self.resetPlayers(data.p);
        self.oos = false;
        self.pingServer();
      });
      this.socket.on('frame-pong', function(frame) {
        var pingTime = (new Date()).getTime() - self.pingStart;
        self.pingStart = undefined;
        // console.log('Ping: ' + pingTime + ' ms');
        frame += (pingTime / 2) / self.targetGameInterval;
        if (self.started) {
          var syncInfo = self.sync(frame);
          syncInfo.unshift(pingTime);
          self.socket.emit('lag', syncInfo);
          return;
        } else {
          while (self.frame < Math.floor(frame))
            self.step();
          self.start();
          self.socket.emit('lag', [pingTime]);
        }
      });
      this.socket.on('control', function(data) {
        self.takeControl(data[0], data[1]);
      });
      this.socket.on('c', function(data) {
        if (data.t == 'j') {
          self.playerJoined(data.p, data.n);
        } else if (data.t == 'q') {
          self.playerQuit(data.p);
        } else if (data.t == 'p') {
          self.playerPings(data.d);
        }
      });
      this.socket.on('d', bind(this, this.eventReceived));
    },

    eventReceived: function(evt) {
      if (!this.addEvent(evt) && !this.oos) {
        this.socket.emit('oos', [this.frame, evt.f]);
        this.oos = true;
      }
    },

    layout: function() {
      this.canvasState = null;
      var w = document.body.clientWidth;
      var h = document.body.clientHeight;
      var minPanelHeight = 80;

      var canvasSize = this.computeViewingSize(w, h - minPanelHeight);
      var devicePixelRatio = 1;
      if (window.devicePixelRatio) {
        var ctx = this.canvas.getContext('2d');
        devicePixelRatio = window.devicePixelRatio;
        if (ctx.webkitBackingStorePixelRatio) {
          devicePixelRatio =
              devicePixelRatio / ctx.webkitBackingStorePixelRatio;
        }
      }
      this.canvas.setAttribute('width', canvasSize[0] * devicePixelRatio);
      this.canvas.setAttribute('height', canvasSize[1] * devicePixelRatio);
      this.canvas.style.width = canvasSize[0] + 'px';
      this.canvas.style.height = canvasSize[1] + 'px';
      this.canvas.style.marginLeft = ((w - canvasSize[0]) / 2) + 'px';
      var panelHeight = h - canvasSize[1];
      this.panel.style.height = panelHeight + 'px';
    },

    computeViewingSize: function(w, h) {
      // We can't compute the size until the level is loaded.
      if (!this.state_ || !this.state_.l)
        return [w, h];

      var x1 = 0;
      var x2 = this.state_.l[0].length;
      var y1 = 0;
      var y2 = this.state_.l.length;

      var blockSize = Math.floor(Math.min(
          w / (x2 - x1),
          h / (y2 - y1)));
      return [(x2 - x1) * blockSize, (y2 - y1) * blockSize];
    },

    redraw: function() {
      this.drawRequested = false;
      var x1 = 0;
      var x2 = this.state_.l[0].length;
      var y1 = 0;
      var y2 = this.state_.l.length;

      var w = this.canvas.getAttribute('width');
      var h = this.canvas.getAttribute('height');

      var blockSize = Math.floor(Math.min(
          w / (x2 - x1),
          h / (y2 - y1)));
      var dx = Math.floor((w - blockSize*(x2 - x1)) / 2);
      var dy = Math.floor((h - blockSize*(y2 - y1)) / 2);
      var ctx = this.canvas.getContext("2d");

      this.draw(ctx, this.state_,
                this.flags.retro ? null : this.spriteSheet,
                x1, y1, x2, y2, dx, dy, blockSize);
      // Minimap eventually?
      // this.draw(this.baseGameState_, 0, 0, 80, 50, 80, 50);
      this.updateScores();
      if (this.frame % 15 == 0)
        this.pingServer();
    },

    draw: function(ctx, state, spriteSheet, x1, y1, x2, y2, dx, dy, blockSize) {
      ctx.save();
      ctx.translate(dx, dy);
      if (spriteSheet) {
        if (this.canvasState) {
          // If we have a previous state then erase the worms and food from that
          // state.
          while (this.canvasState.length > 0) {
            var pos = this.canvasState.pop();
            var s = state.l[pos[0]][pos[1]];
            ctx.drawImage(spriteSheet, s == 1 ? spriteSize : 0, 0, spriteSize, spriteSize,
                          pos[1] * blockSize, pos[0] * blockSize, blockSize, blockSize);
          }
        } else {
          this.canvasState = [];
          for (var i = 0; i < x2 - x1; i++) {
            for (var j = 0; j < y2 - y1; j++) {
              var s = state.l[y1 + j][x1 + i];
              if (s != 1) {
                ctx.drawImage(spriteSheet, 0, 0, spriteSize, spriteSize,
                              i * blockSize, j * blockSize, blockSize, blockSize);
              } else {
                ctx.drawImage(spriteSheet, spriteSize, 0, spriteSize, spriteSize,
                              i * blockSize, j * blockSize, blockSize, blockSize);
              }
            }
          }
        }

        for (var i = 0; i < state.food.length; i++) {
          this.canvasState.push(state.food[i]);
          ctx.drawImage(spriteSheet,
                        2 * spriteSize, 0, spriteSize, spriteSize,
                        state.food[i][1] * blockSize, state.food[i][0] * blockSize, blockSize, blockSize);
        }
        // Then draw the worms.
        for (var i = 0; i < state.p.length; i++) {
          for (var j = 0; j < state.p[i].t.length; j++) {
            ctx.save();
            this.canvasState.push(state.p[i].t[j])
            ctx.translate(state.p[i].t[j][1] * blockSize + blockSize/2,
                          state.p[i].t[j][0] * blockSize + blockSize/2);
            var rotate = state.p[i].t[j][2];
            var sprite = 1;
            if (j == 0) {
              // If we are greater than 1 length, use rotation from previous
              // piece to avoid continuity problems.
              if (state.p[i].t.length > j + 1) {
                rotate = state.p[i].t[j + 1][2];
              }
              if (rotate == 3)
                ctx.scale(1, -1);
              if (state.p[i].s == 0)
                sprite = 3;
              else
                sprite = 4;
            } else if (j == state.p[i].t.length - 1) {
              sprite = 0;
            } else if (state.p[i].t[j + 1][2] != state.p[i].t[j][2]) {
              sprite = 2;
              if ((state.p[i].t[j][2] + 1) % 4 ==
                      state.p[i].t[j + 1][2])
                rotate += 1;
              else
                rotate += 2;
            }
            ctx.rotate(Math.PI / 2 * rotate);
            // As a special case we draw the tail sprite under the head for
            // length 1 to avoid a discontinuous snake.
            if (state.p[i].t.length == 1) {
              var tailPos = [state.p[i].t[j][0], state.p[i].t[j][1]];
              tailPos[0] -= this.moveVectors[state.p[i].t[j][2]][0];
              tailPos[1] -= this.moveVectors[state.p[i].t[j][2]][1];
              this.canvasState.push(tailPos);
              ctx.drawImage(spriteSheet,
                            0,
                            (2 + i) * spriteSize, // Player
                            spriteSize, spriteSize,
                            -blockSize/2, blockSize/2,
                            blockSize,blockSize);
            }
            ctx.drawImage(spriteSheet,
                          spriteSize * sprite,
                          (2 + i) * spriteSize, // Player
                          spriteSize, spriteSize,
                          -blockSize/2, -blockSize/2,
                          blockSize,blockSize);
            ctx.restore();
          }
        }
      } else {
        if (this.canvasState) {
          // If we have a previous state then erase the worms and food from that
          // state.
          while (this.canvasState.length > 0) {
            var pos = this.canvasState.pop();
            var s = state.l[pos[0]][pos[1]];
            ctx.fillStyle = drawStyle[state.l[pos[0]][pos[1]]];
            ctx.fillRect(pos[1] * blockSize,
                         pos[0] * blockSize,
                         blockSize,
                         blockSize);
          }
          for (var i = 0; i < state.food.length; i++) {
            this.canvasState.push(state.food[i]);
            ctx.fillStyle = drawStyle[state.l[state.food[i][0]][state.food[i][1]]];
            ctx.fillRect(state.food[i][1] * blockSize,
                         state.food[i][0] * blockSize,
                         blockSize,
                         blockSize);
          }
          // Then draw the worms.
          for (var i = 0; i < state.p.length; i++) {
            for (var j = 0; j < state.p[i].t.length; j++) {
              this.canvasState.push(state.p[i].t[j]);
              ctx.fillStyle = drawStyle[state.l[state.p[i].t[j][0]][state.p[i].t[j][1]]];
              ctx.fillRect(state.p[i].t[j][1] * blockSize,
                           state.p[i].t[j][0] * blockSize,
                           blockSize,
                           blockSize);
            }
          }
        } else {
          this.canvasState = [];
          for (var i = 0; i < x2 - x1; i++) {
            for (var j = 0; j < y2 - y1; j++) {
              if (state.l[y1 + j][x1 + i] > 1)
                this.canvasState.push([y1 + j, x1 + i]);
              ctx.fillStyle = drawStyle[state.l[y1 + j][x1 + i]];
              ctx.fillRect(i * blockSize,
                           j * blockSize,
                           blockSize,
                           blockSize);

            }
          }
        }
      }
      ctx.restore();
    },

  });

  return Client;
}();

document.addEventListener('DOMContentLoaded', function() {
  new wormy.Client();
});
