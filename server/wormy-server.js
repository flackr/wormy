/**
 * Wormy multiplayer worm game.
 *
 * Author: Robert Flack (flackr@gmail.com)
 */

var port = 8000;
var master_server = 'http://www.dynprojects.com/dp/server/server.php';
var app = require('http').createServer(handler),
	io = require('socket.io').listen(app),
	fs = require('fs'),
	path = require('path'),
  xhr = require('xmlhttprequest');

io.set('log level', 1); // reduce logging.

var wormy = require('./client/wormy-common.js');
var levels = require('./wormy-levels.js');

app.listen(port);

function getContentType(filePath) {
	if (filePath.substr(filePath.length - 5) == '.html')
		return 'text/html';
	if (filePath.substr(filePath.length - 4) == '.css')
		return 'text/css';
	if (filePath.substr(filePath.length - 3) == '.js')
		return 'text/javascript';
	return 'text/plain';
}

function handler(req, res) {
  console.log('Incoming request for '+req.url);
  if (req.url == '/status') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(JSON.stringify(server.serverStatus()));
  }
	var filePath = 'client' + req.url;
	if (filePath == 'client/')
		filePath = 'client/index.html';
	path.exists(filePath, function(exists) {
		if (exists) {
			fs.readFile(filePath, function(error, content) {
				if (error) {
					res.writeHead(500);
					res.end();
				} else {
					res.writeHead(200, { 'Content-Type': getContentType(filePath) });
					res.end(content, 'utf-8');
				}
			});
		} else {
			res.writeHead(404);
			res.end();
		}
	});
}

function loadAjax(url, data, callback)
{
  var xmlhttp;
  data = data || '';
  xmlhttp=new xhr.XMLHttpRequest();

  xmlhttp.onreadystatechange=function() {
    if (xmlhttp.readyState==4 && xmlhttp.status==200) {
      if (callback)
        callback(xmlhttp.responseText);
    }
  }
  xmlhttp.open("POST", url, true);
  xmlhttp.setRequestHeader("Content-type", "application/x-www-form-urlencoded");
  xmlhttp.setRequestHeader("Content-length", data.length);
  xmlhttp.setRequestHeader("Connection", "close");
  xmlhttp.send(data);
}

wormy.Game.prototype.buffer = wormy.Game.prototype.buffer -
  Math.floor((wormy.Game.prototype.buffer - wormy.Game.prototype.playAt) / 2);
console.log('Buffer set to '+wormy.Game.prototype.buffer);

wormy.Server = function() {

  var maxPlayers = 16;
  var maxPlayerNameLength = 20;
  var idleFrames = 25 * 5; // 25 seconds considered idle.
  var coolDownFrames = 20; // 4 seconds between reconnects.

  var Server = function(io) {
    wormy.Game.apply(this);
    this.io = io;
    this.clients = [];
    this.worms = [];
    this.loadLevel(0);

    io.sockets.on('connection', wormy.util.bind(this, this.onConnection));
  }

  Server.prototype = {
    __proto__: wormy.Game.prototype,

    serverStatus: function() {
      var playerCount = 0;
      for (var i = 0; i < this.state_.p.length; i++) {
        if (this.state_.p[i].s != 2)
          playerCount++;
      }
      return {
        players: playerCount,
      };
    },

    step: function() {
      wormy.Game.prototype.step.call(this);
      if (this.frame % 10 == 0 && this.foodCount < this.computeMaxFood())
        this.spawnFood();
      if (this.frame % 20 == 0)
        this.disconnectIdleWorms();
    },

    computeMaxFood: function() {
      var aliveWorms = 0;
      for (var i = 0; i < this.state_.p.length; i++) {
        if (this.state_.p[i].s == 0)
          aliveWorms++;
      }
      if (aliveWorms <= 2)
        return 1;
      if (aliveWorms <= 5)
        return 2;
      return 3;
    },

    takeControl: function(playerNo, callback) {
      // Using extra data here to correlate player to socket.
      callback(playerNo);
    },

    isWinner: function(playerNo) {
      // A player wins when they are at least 100 long and 3 times longer than
      // the second longest snake.
      if (this.state_.p[playerNo].t.length >= this.getEndGoal())
        return true;
      return false;
    },

    spawnFood: function() {
      var l = this.findRun(1);
      if (l) {
        this.foodCount++;
        this.deliverDelayedCommand({
            t: 'f',
            fx: l[1],
            fy: l[0]});
      }
    },

    foodEaten: function(playerNo) {
      this.foodCount--;
      // Increase score maybe?
      if (playerNo >= 0 && this.isWinner(playerNo)) {
        this.loadLevel(this.level + 1);
      }
    },

    setPlayerIdle: function(playerNo, isIdle) {
      while (this.worms.length <= playerNo)
        this.worms.push({});
      this.worms[playerNo].idle = isIdle ? this.frame : undefined;
    },

    disconnectIdleWorms: function() {
      var accounted = [];
      for (var i = 0; i < this.clients.length; i++) {
        for (var j = 0; j < this.clients[i].worms.length; j++) {
          if (this.clients[i].worms[j] >= 0) {
            var pno = this.clients[i].worms[j];
            accounted.push(pno);
            if (this.worms.length > pno &&
                this.worms[pno].idle !== undefined) {
              if (this.state_.p[pno].s == 0)
                this.setPlayerIdle(pno, false);
              else if (this.frame - this.worms[pno].idle > idleFrames) {
                this.clients[i].worms[j] = -1;
                this.clients[i].s.emit('control', [-1, j]);
                this.deliverControlCommand({
                  t: 'q',
                  p: pno,
                });
                this.deliverDelayedCommand({
                  t: 'd',
                  p: pno,
                });
                this.setPlayerIdle(pno, false);
              }
            } else if (this.state_.p[pno].s != 0 &&
                       this.state_.p[pno].t.length == 0) {
              this.setPlayerIdle(pno, true);
            }
          }
        }
      }

      // Find dead snakes that aren't owned by any connection.
      for (var i = 0; i < this.state_.p.length; i++) {
        if (accounted.indexOf(i) == -1) {
          if (this.state_.p[i].s == 1) {
            console.log('WARNING: Snake '+i+' was not owned by anyone but not claimable.');
            this.deliverDelayedCommand({
              t: 'd',
              p: i,
            });
          }
        }
      }
    },

    resetClient: function(socket) {
      var players = [];
      for (var i = 0; i < this.clients.length; i++) {
        for (var j = 0; j < this.clients[i].worms.length; j++) {
          if (this.clients[i].worms[j] >= 0) {
            players.push([this.clients[i].worms[j],
                          this.clients[i].wormNames[j]]);
          }
        }
      }

      socket.emit('load', {
          f: this.frame,
          s: {
            base: this.baseGameState_,
            moves: this.moves_,
          },
          p: players,
        });
    },

    loadLevel: function(level) {
      this.level = level;
      this.foodCount = 0;
      this.stop();
      this.baseGameState_.l = levels.getLevel(level);
      for (var i = 0; i < this.baseGameState_.p.length; i++) {
        if (this.baseGameState_.p[i].s == 0)
          this.baseGameState_.p[i].s = 1;
        this.baseGameState_.p[i].t = [];
      }
      this.baseGameState_.food = [];
      this.state_ = wormy.util.clone(this.baseGameState_);
      this.moves_ = [];
      while (this.moves_.length < this.playAt + 1)
        this.moves_.push([]);
      for (var i = 0; i < this.clients.length; i++)
        this.resetClient(this.clients[i].s);
      this.spawnFood();
      this.start();
    },

    // Searches for a run of squares of length at random. Gives up after too
    // failed attempts.
    findRun: function(runLength) {
      for (var i = 0; i < 10; i++) {
        var d = Math.floor(Math.random()*this.moveVectors.length);
        var x = Math.floor(Math.random()*this.state_.l[0].length);
        var y = Math.floor(Math.random()*this.state_.l.length);
        var j = 0;
        var w = this.state_.l[0].length;
        var h = this.state_.l.length;
        for (j = 0; j < runLength; j++) {
          if (this.state_.l[(y + j*this.moveVectors[d][0] + h) % h]
                           [(x + j*this.moveVectors[d][1] + w) % w] != 0) break;
        }
        if (j == runLength) {
          return [y, x, d];
        }
      }
      return null;
    },

    createNewWormEvent: function() {
      var i;
      for (i = 0; i < this.state_.p.length; i++) {
        if (this.state_.p[i].s == 2 && this.state_.p[i].t.length == 0)
          break;
      }
      if (i >= maxPlayers) {
        console.log('INFO: Cannot create new player, player limit reached.');
        return false;
      }
      var loc = this.findRun(10);
      if (!loc) {
        console.log('WARNING: Failed to find spawn location for player.');
        return false;
      }
      return {
        t: 'a',
        p: i,
        c: 0, // This control property informs the player which worm they get.
        l: loc,
      }
    },

    clientIndex: function(socket) {
      for (var i = 0; i < this.clients.length; i++) {
        if (this.clients[i].s == socket)
          return i;
      }
      return -1;
    },

    deliverControlCommand: function(cmd) {
      for (var i = 0; i < this.clients.length; i++) {
        this.clients[i].s.emit('c', cmd);
      }
    },

    deliverDelayedCommand: function(cmd) {
      // Delayed events happen on this frame.
      var evt = {f:this.frame, d:cmd};
      this.addEvent(evt);
      for (var i = 0; i < this.clients.length; i++) {
        this.clients[i].s.emit('d', evt);
      }
    },

    deliverImmediateCommand: function(socket, evt) {
      if (this.addEvent(evt)) {
        for (var i = 0; i < this.clients.length; i++) {
          if (this.clients[i].s != socket)
            this.clients[i].s.emit('d', evt);
        }
      } else {
        // If the event doesn't get delivered then we have to tell the client
        // they're out of sync.
        console.log('WARNING: Lag or out of sync: ' + socket.handshake.address.address + ' sent event for f# ' + evt.f + ' on f# ' + this.frame);
        this.resetClient(socket);
      }
    },

    sendPing: function(clientIndex, ping) {
      var pingData = [];
      for (var j = 0; j < this.clients[clientIndex].worms.length; j++) {
        if (this.clients[clientIndex].worms[j] >= 0) {
          pingData.push([this.clients[clientIndex].worms[j], ping]);
        }
      }
      this.deliverControlCommand({
        t: 'p',
        d: pingData,
      });
    },

    onConnection: function(socket) {
      var addr = socket.handshake.address.address;
      console.log('INFO: Client connected from '+addr);

      // Send game state immediately.
      this.resetClient(socket);

      // And register for all new messages from here on.
      this.clients.push({s: socket, worms: [], wormNames: [], coolDown: []});
      var self = this;

      socket.on('start', function(data) {
        var localIndex = data[0];
        var i = self.clientIndex(socket);
        while (self.clients[i].worms.length <= localIndex)
          self.clients[i].worms.push(-1);
        while (self.clients[i].wormNames.length <= localIndex)
          self.clients[i].wormNames.push('');
        while (self.clients[i].coolDown.length <= localIndex)
          self.clients[i].coolDown.push(0);

        // Client is not allowed to spawn yet.
        if (self.clients[i].coolDown[localIndex] > self.frame)
          return;

        // The client can only control 1 worm per local index.
        if (self.clients[i].worms[localIndex] != -1) {
          console.log('WARNING: Client '+addr+' already controlling '+self.clients[i].worms[localIndex]+' as worm '+localIndex);
          socket.emit('control', [self.clients[i].worms[localIndex], localIndex]);
          return;
        }

        // Create addplayer message for current player.
        var evt = self.createNewWormEvent();
        if (evt) {
          socket.emit('control', [evt.p, localIndex]);
          self.deliverControlCommand({
            t: 'j',
            p: evt.p,
            n: data[1].substr(0, maxPlayerNameLength),
          });
          // Deliver message.
          self.deliverDelayedCommand(evt);
          // Save controlled worm.
          self.clients[i].worms[localIndex] = evt.p;
          self.clients[i].wormNames[localIndex] =
              data[1].substr(0, maxPlayerNameLength);
        } else {
          console.log('WARNING: Could not find location for '+addr+' worm '+localIndex);
        }
      });
      socket.on('d', function(data) {
        var i = self.clientIndex(socket);
        // Don't allow commands for other players.
        if (data.p && self.clients[i].worms.indexOf(data.p) == -1) {
          // At this point the client is probably out of sync.
          self.resetClient(socket);
          return;
        }
        if (data.t == 'r') {
          if (!self.state_.p[data.p] ||
              self.state_.p[data.p].s != 1 ||
              self.state_.p[data.p].t.length != 0)
            return;
          data.l = self.findRun(10);
          if (!data.l) return;
        } else if (data.t == 'd') {
          var j = data.p;
          if (j >= self.clients[i].worms.length)
            return;
          data.p = self.clients[i].worms[j];
          if (data.p < 0)
            return;
          self.clients[i].coolDown[j] = self.frame + coolDownFrames;
          // Track immediately that they no longer control this worm.
          self.clients[i].worms[j] = -1;
          self.deliverControlCommand({
            t: 'q',
            p: data.p,
          });
        }
        self.deliverDelayedCommand(data);
      });
      socket.on('i', function(evt) {
        var i = self.clientIndex(socket);
        // Don't allow commands for other players.
        if (evt.d.p && self.clients[i].worms.indexOf(evt.d.p) == -1) {
          // At this point the client is probably out of sync.
          self.resetClient(socket);
          return;
        }
        self.deliverImmediateCommand(socket, evt);
      });
      socket.on('frame-ping', function(data) {
        socket.emit('frame-pong', self.getPartialFrame());
      });
      socket.on('disconnect', function(data) {
        var i = self.clientIndex(socket);
        var wormlist = [];
        if (i >= 0)
          wormlist = self.clients.splice(i, 1)[0].worms;
        for (var i=0; i<wormlist.length; i++) {
          if (wormlist[i] >= 0) {
            self.deliverControlCommand({
              t: 'q',
              p: wormlist[i],
            });
            self.deliverDelayedCommand({t: 'd', p: wormlist[i]});
          }
        }
        console.log('INFO: Client '+addr+' disconnected, killing worms '+wormlist.join());
      });
      socket.on('oos', function(data) {
        console.log('WARNING: Lag or out of sync: ' + addr + ' received event for f# ' + data[1] + ' on f# ' + data[0]);
        self.resetClient(socket);
      });
      socket.on('lag', function(data) {
        var i = self.clientIndex(socket);
        var l = 'LAG: ' + addr + ' ping: ' + data[0] + ' ms';
        if (data.length > 1)
          l += ' offset: ' + data[1] + ' ms skew: ' + data[2] + '% speed: ' + data[3] + '% new speed: ' + data[4] + '%';
        console.log(l);
        self.sendPing(i, data[0]);
      });
    },
  };

  return Server;
}();

var server = new wormy.Server(io);
