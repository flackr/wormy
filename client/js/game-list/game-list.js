window.GameList = function(){

  var defaultHost = 'http://www.dynprojects.com/dp/games/';

  var Game = function(details, host) {
    this.host_ = host || defaultHost;
    this.updateFrequency_ = 100000;
    this.id_ = 0;
    this.update(details);
  };

  Game.prototype.fields_ = {
    'connection': {
        'required': true,
        'static': true},
    'name': {'required': true},
    'players': {},
    'max_players': {},
  };

  Game.prototype.update = function(details) {
    var args = [];
    args.push('update=' + (this.id_ == 0 ? 'new' : this.id_));
    if (details) {
      for (var i in details) {
        if (this.fields_[i] && (this.id_ == 0 || !this.fields_[i].static)) {
          args.push(i+'='+encodeURIComponent(details[i]));
        }
      }
    }
    var request = new XMLHttpRequest();
    request.open("POST", this.host_, true);
    request.setRequestHeader("Content-type","application/x-www-form-urlencoded");
    request.responseType = 'json';
    request.addEventListener('loadend', this.onUpdate_.bind(this, request));
    request.send(args.join('&'));
    this.scheduledUpdate_ = setTimeout(this.update.bind(this), this.updateFrequency_);
  };

  Game.prototype.onUpdate_ = function(request) {
    if (request.status == 200) {
      if (request.response.result == 'success') {
        if (this.id_ == 0) {
          this.id_ = request.response.id;
        }
      }
    }
  };

  Game.prototype.close = function() {
    if (this.scheduledUpdate_)
      clearTimeout(this.scheduledUpdate_);
  };

  return {
    'Game': Game };
}();
