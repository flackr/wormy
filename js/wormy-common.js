/**
 * Wormy multiplayer worm game.
 *
 * Author: Robert Flack (flackr@gmail.com)
 */

var bind = function(scope, fn /*, variadic args to curry */) {
  var args = Array.prototype.slice.call(arguments, 2);
  return function() {
    return fn.apply(scope, args.concat(
        Array.prototype.slice.call(arguments)));
  };
};

var clone = function(obj) {
  return JSON.parse(JSON.stringify(obj));
};

function SocketAdapter(connection) {
  this.listeners_ = {};
  this.connection_ = connection;
  this.connection_.addEventListener('message', this.onMessage.bind(this));
  this.connection_.addEventListener('close', this.onClose.bind(this));
}

SocketAdapter.prototype = {
  emit: function(type, data) {
    this.connection_.send(JSON.stringify({t: type, d: data}));
  },

  on: function(type, callback) {
    this.listeners_[type] = callback;
  },

  onMessage: function(e) {
    var m = JSON.parse(e.data);
    if (this.listeners_[m.t]) {
      this.listeners_[m.t](m.d);
    }
  },

  onClose: function() {
    if (this.listeners_['disconnect']) {
      this.listeners_['disconnect']();
    }
  },
};

var wormy = function() {

  var adjust = function(factor, prop) {
    return (factor-1.0)*prop+1.0;
  };

  var tailInitial = 5;
  var tailInc = 8;

  var Game = function() {
    // Base game state.
    this.baseGameState_ = {
      l: undefined,
      food: [],
      p: [],
      f: 0,
    };

    // Current game state.
    this.state_ = undefined;
    this.started = false;

    // If an event is received in a previous frame the current game state is
    // marked stale and the game is replaced from the base game state forward.
    this.stateStale_ = false;

    this.frame = 0;
    this.moves_ = [];
    this.stepTimer_ = 0;
    this.lastStepTime_ = undefined;
    this.gameInterval = Game.prototype.targetGameInterval;
  };

  Game.prototype = {

    moveInterval: 2,

    buffer: 42,

    playAt: 12,

    targetGameInterval: 85,

    moveVectors: [[-1, 0], [0, 1], [1, 0], [0, -1]],

    powers: [{
        name: 'none', // Placeholder for no power.
      }, {
        name: 'speed',
        duration: 2*50,  // 50 squares of fast movement when fully charged.
        recharge: 3*50,  // 50 squares of regular movement to recharge.
        activation: 0.2,
      }, {
        name: 'burrow',
        duration: 2*25,
        recharge: 3*50,
        activation: 0.3,
      }, {
        name: 'reverse',
        duration: 1,
        recharge: 3*15,
        activation: 1,
      }, {
        name: 'freeze',
        duration: 3*50,
        recharge: 3*50,
        activation: 0.2,
      },
    ],

    reset: function(state) {
      this.baseGameState_ = this.decompressGameState(state.base);
      this.moves_ = state.moves;
      this.recomputeState();
      this.lastStepTime_ = undefined;
      this.lastSyncFrame = undefined;
//      this.gameInterval = this.targetGameInterval;
    },

    loadLevel: function(level) {
      this.level = level;
      this.stop();
      this.foodCount = 0;
      this.baseGameState_.l = getLevel(level);
      for (var i = 0; i < this.baseGameState_.p.length; i++) {
        if (this.baseGameState_.p[i].s == 0)
          this.baseGameState_.p[i].s = 1;
        this.baseGameState_.p[i].t = [];
      }
      this.baseGameState_.food = [];
      this.state_ = clone(this.baseGameState_);
    },

    compressGameState: function(level, state) {
      var r = {
        'l': level,
        'food': state.food,
        'p': state.p,
        'f': state.f,
      };
      return r;
    },

    decompressGameState: function(c) {
      var state = {
        'l': getLevel(c.l),
        'food': c.food,
        'p': c.p,
        'f': c.f,
      };
      for (var i = 0; i < state.food.length; i++) {
        state.l[state.food[i][0]][state.food[i][1]][1] = 2;
      }
      for (var i = 0; i < state.p.length; i++) {
        for (var j = 0; j < state.p[i].t.length; j++) {
          state.l[state.p[i].t[j][0]][state.p[i].t[j][1]][state.p[i].t[j][2]] = i + 3;
        }
      }
      return state;
    },

    stop: function() {
      this.stepTimer_ = 0;
      this.started = false;
      this.lastStepTime_ = undefined;
      this.lastSyncFrame = undefined;
    },

    nextStepTimeout: function() {
      return this.gameInterval - ((performance.now() - this.gameStartTime_) % this.gameInterval);
    },

    start: function() {
      this.started = true;
      this.step();
    },

    addEvent: function(evt) {
      // We should always be at least as far as the frame we receive input for.
      // Note: we could check this.started and rely on the requestAnimationFrame to step.
      while (this.frame < evt.f - this.playAt)
        this.step();
      var move_i = this.moves_.length - this.playAt - (this.frame - evt.f) - 1;
      if (move_i < 0 || move_i >= this.moves_.length) {
        console.log('Refusing move for '+evt.f+' because currently at '+this.frame+' and move window extends only '+this.playAt+' frames in future.');
        return false;
      }
      this.moves_[move_i].push(evt.d);
      if (evt.f < this.frame)
        this.stateStale_ = true;
      return true;
    },

    getPartialFrame: function(frame, offset) {
      var pf = this.frame;
      if (this.lastStepTime_)
        pf += Math.min(1, ((new Date()).getTime() - this.lastStepTime_) / this.gameInterval);
      return pf;
    },

    recomputeState: function() {
      this.state_ = clone(this.baseGameState_);
      for (var i = 0; i < this.moves_.length - this.playAt - 1; i++)
        this.process(this.state_, this.moves_[i]);
      this.stateStale_ = false;
    },

    step: function() {
      var targetFrame = Math.floor((performance.now() - this.gameStartTime_) / this.gameInterval);
      var updated = false;
      while (this.frame < targetFrame) {
        var changed = false;
        this.lastStepTime_ = (new Date()).getTime();
        // Add new frame for current moves.
        this.moves_.push([]);
        if (this.moves_.length > this.buffer) {
          var md = this.moves_.splice(0, this.moves_.length - this.buffer);
          for (var i = 0; i < md.length; i++)
            this.process(this.baseGameState_, md[i], true);
        }

        if (this.stateStale_) {
          this.recomputeState();
        } else if (this.moves_.length > this.playAt + 1) {
          this.process(this.state_, this.moves_[this.moves_.length - this.playAt - 2]);
        }
        this.frame++;
        updated = true;
      }
      if (this.started)
        this.stepTimer_ = requestAnimationFrame(bind(this, this.step));
      return updated;
    },

    disconnected: function(playerNo) {
      // Don't do anything.
    },

    foodEaten: function(playerNo) {
      // Increase score maybe?
    },

    clearTail: function(g, playerNo) {
      if (g.p.length <= playerNo)
        return;
      for (var i = 0; i < g.p[playerNo].length; i++) {
        g.l[g.p[playerNo].t[i][0]][g.p[playerNo].t[i][1]][g.p[playerNo].t[i][2]] = 0;
      }
    },

    // Process move data |md| on game data |gd|.
    process: function(g, md, is_final) {
      for (var i = 0; i < md.length; i++) {
        if (md[i].t == 'm') { // Movement
          if (g.p[md[i].p].s != 0)
            console.log('Not moving because worm is dead');
          else if (g.p[md[i].p].t.length > 1 &&
                   (md[i].d + 2) % 4 == g.p[md[i].p].t[1][3])
            console.log('Not letting ' + md[i].p + ' turn into itself.');
          else
            g.p[md[i].p].t[0][3] = md[i].d;
        } else if (md[i].t == 'p') { // Use power.
          if (g.p[md[i].p].f == md[i].f) continue;
          g.p[md[i].p].f = 0;
          if (md[i].f && g.p[md[i].p].p &&
              g.p[md[i].p].e >= this.powers[g.p[md[i].p].p].activation) {
            if (g.p[md[i].p].p == 3) {
              // Reverse is an immediate reaction.
              // Compute the new direction for each segment of the tail.
              for (var j = 0; j < g.p[md[i].p].t.length - 1; j++) {
                var dy = g.p[md[i].p].t[j + 1][0] - g.p[md[i].p].t[j][0];
                var dx = g.p[md[i].p].t[j + 1][1] - g.p[md[i].p].t[j][1];
                if (dx > 1) dx -= g.l[0].length;
                if (dx < -1) dx += g.l[0].length;
                if (dy > 1) dy -= g.l.length;
                if (dy < -1) dy += g.l.length;
                for (var dir = 0; dir < this.moveVectors.length; dir++) {
                  if (dy == this.moveVectors[dir][0] && dx == this.moveVectors[dir][1]) {
                    g.p[md[i].p].t[j][3] = dir;
                    break;
                  }
                }
              }
              g.p[md[i].p].t.reverse();
              // Reverse the last tail segment direction.
              if (g.p[md[i].p].t.length >= 1)
                g.p[md[i].p].t[0][3] = (g.p[md[i].p].t[0][3] + 2) % 4;
            } else {
              g.p[md[i].p].f = 1;
            }
            g.p[md[i].p].e -= this.powers[g.p[md[i].p].p].activation;
          }
        } else if (md[i].t == 'a') { // Add player.
          this.clearTail(g, md[i].p);
          g.p[md[i].p] = {
            t: [md[i].l],  // Tail
            l: tailInitial,  // Length
            s: 0,  // Start alive
            n: md[i].n, // Player name
            e: 0,  // Energy
            p: 0, // Power (none)
            f: 0  // Using power?
          };
          g.l[g.p[md[i].p].t[0][0]][g.p[md[i].p].t[0][1]][1] = md[i].p + 3;
        } else if (md[i].t == 'd') { // Disconnect.
          if (g.p.length > md[i].p) {
            g.p[md[i].p].s = 2;
            if (!md[i].handled) {
              this.disconnected(md[i].p);
              md[i].handled = true;
            }
          }
        } else if (md[i].t == 'r') { // Revive.
          if (g.p.length > md[i].p &&
              g.p[md[i].p].t.length == 0 &&
              g.p[md[i].p].s == 1) {
            this.clearTail(g, md[i].p);
            g.p[md[i].p] = {
              t: [md[i].l],
              l: tailInitial,
              s: 0,
              e: 0,
              p: 0,
              f: 1
            };
            g.l[g.p[md[i].p].t[0][0]][g.p[md[i].p].t[0][1]][1] = md[i].p + 3;
          }
        } else if (md[i].t == 'f') {
          // FOOD!
          if (g.l[md[i].fy][md[i].fx][1] != 0) {
            if (is_final)
              this.foodEaten(-1);
          } else {
            g.l[md[i].fy][md[i].fx][1] = 2;
            g.food.push([md[i].fy, md[i].fx, md[i].ft]);
          }
        }
      }
      var w = g.l[0].length;
      var h = g.l.length;
      var offset = Math.floor(g.f / this.moveInterval) % g.p.length;
      for (var i = 0; i < g.p.length; i++) {
        var pi = (i + offset) % g.p.length;
        if (g.p[pi].p) {
          if (g.p[pi].e <= 0) {
            g.p[pi].e = 0;
            g.p[pi].f = 0;
          }
          if (g.p[pi].f) {
            g.p[pi].e = Math.max(0,
                g.p[pi].e - 1.0 / this.powers[g.p[pi].p].duration);
          } else {
            g.p[pi].e = Math.min(1,
                g.p[pi].e + 1.0 / this.powers[g.p[pi].p].recharge);
          }
        } else {
          g.p[pi].e = 0;
        }

        // Determine move frequency for current worm.
        var moveInterval = this.moveInterval;
        // When speeding move interval is reduced.
        if (g.p[pi].p == 1 && g.p[pi].f)
          moveInterval--;
        g.p[pi].m = (g.f % moveInterval == moveInterval - 1) ? 1 : 0;

        // Allow freezing in place when using freeze powerup.
        if (g.p[pi].p == 4 && g.p[pi].f)
          g.p[pi].m = 0;

        if (g.p[pi].m == 0)
          continue;

        if (!g.p[pi].s) {
          var next = [(g.p[pi].t[0][0] + this.moveVectors[g.p[pi].t[0][3]][0] + h) % h,
                      (g.p[pi].t[0][1] + this.moveVectors[g.p[pi].t[0][3]][1] + w) % w,
                      1, // Level 1 by default.
                      g.p[pi].t[0][3]];
          // If burrowed, next position is underground.
          if (g.p[pi].p == 2 && g.p[pi].f)
            next[2] = 0;
          if (g.l[next[0]][next[1]][next[2]] == 2) {
            g.l[next[0]][next[1]][1] = 0;
            g.p[pi].l += tailInc;
            for (var j = 0; j < g.food.length; j++) {
              if (g.food[j][0] == next[0] && g.food[j][1] == next[1]) {
                // Lose energy if picking up a different power.
                if (g.food[j][2] && g.p[pi].p != g.food[j][2]) {
                  g.p[pi].e = 0;
                  g.p[pi].p = g.food[j][2];
                  g.p[pi].f = 0;
                }
                g.food.splice(j, 1);
                j--;
              }
            }
            if (is_final) {
              this.foodEaten(pi);
            }
          }
          if (g.l[next[0]][next[1]][next[2]]) {
            // If the worm is about to crash and has the freeze power then it
            // should activate it automatically.
            if (g.p[pi].p == 4 && g.p[pi].e > this.powers[4].activation) {
              g.p[pi].f = 1;
              g.p[pi].e -= this.powers[4].activation;
              continue;
            }
            g.p[pi].s = 1;
            g.p[pi].l = 0;
          } else {
            g.p[pi].t.splice(0, 0, next);
            g.l[next[0]][next[1]][next[2]] = pi + 3;
          }
        }
        if (g.p[pi].t.length && (g.p[pi].s ||
                                g.p[pi].t.length > g.p[pi].l)) {
          var tail = g.p[pi].t.pop();
          g.l[tail[0]][tail[1]][tail[2]] = 0;
        }
      }
      g.f++;
    },

    // End goal is 100 or three times as long as second longest worm.
    getEndGoal: function() {
      var l1 = 0;
      var l2 = 0;
      for (var i = 0; i < this.state_.p.length; i++) {
        if (this.state_.p[i].t) {
          var l = this.state_.p[i].t.length;
          if (l > l1) {
            l2 = l1;
            l1 = l;
          } else if (l > l2)
            l2 = l;
        }
      }
      return Math.max(100, 3 * l2);
    },
  };

  return {
    Game: Game,
  };
}();

if (typeof exports == 'object' && exports) {
  exports.Game = wormy.Game;
  exports.util = {
      bind: bind,
      clone: clone,
  };
}
