window.RtcHelper = function() {
  /**
   * Enum for RtcHelper readystate following websocket readystate:
   * https://developer.mozilla.org/en-US/docs/Web/API/WebSocket#Ready_state_constants
   * @enum {number}
   */
  var ReadyState = {
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3
  };
  
  /**
   * Adds a listener that will remove itself the first time it is fired thus
   * only being fired once.
   * @param {Object} obj The object to add the listener on.
   * @param {String} type The event type to listen for.
   * @param {function(...[*])} fn The function to call when the event fires.
   */
  var addOneShotListener = function(obj, type, fn) {
    var listener = function() {
      obj.removeEventListener(type, listener);
      fn(arguments);
    };
    obj.addEventListener(type, listener);
  };

  var EventSource = function(eventTypes) {
    this.listeners_ = {};
    for (var i = 0; i < eventTypes.length; i++) {
      if (!this.listeners_[eventTypes[i]])
        this.listeners_[eventTypes[i]] = [];
    }  
  };
  
  EventSource.prototype.addEventListener = function(type, fn) {
    this.listeners_[type].push(fn);
  };
  
  EventSource.prototype.dispatchEvent = function(type, args) {
    for (var i = 0; i < this.listeners_[type].length; i++) {
      this.listeners_[type][i].apply(
          /* this */ null, /* args */ Array.prototype.slice.call(arguments, 1));
    }
  };
  
  EventSource.prototype.removeEventListener = function(type, callback) {
    for (var i = this.listeners_[type].length - 1; i >= 0; i--) {
      if (this.listeners_[type][i] === callback) {
        this.listeners_[type].splice(i, 1);
      }
    }
  };

  var defaultHost = 'http://www.dynprojects.com/dp/rtc/';
  
  var getUrlFromId = function(id, host) {
    return (host || defaultHost) + '?id=' + id;
  };
  
  /**
   * Create a new Rtc Server using signalling via |host|.
   * @param {String} host The address of the host signalling server.
   **/
  var Server = function(host) {
    EventSource.apply(this, [['connection', 'error', 'open', 'close']]);
    this.host_ = host || defaultHost;
    this.id_ = undefined;
    this.lastClient_ = 0;
    this.readyState_ = ReadyState.CONNECTING;
    this.initialize_();
    this.connecting_ = {};
  };
  
  Server.prototype.__proto__ = EventSource.prototype;
  
  Server.prototype.id = function() {
    return this.id_;
  };

  Server.prototype.url = function() {
    return getUrlFromId(this.host_, this.id_);
  };
  
  Server.prototype.initialize_ = function() {
    var self = this;
    var request = new XMLHttpRequest();
    request.open('POST', this.host_, true);
    request.setRequestHeader("Content-type","application/x-www-form-urlencoded");
    request.responseType = 'json';
    addOneShotListener(request, 'loadend', function(e) {
      if (request.status == 200) {
        var r = request.response;
        if (r.result == 'error') {
          self.readyState_ = ReadyState.CLOSED;
          self.dispatchEvent('error', r.code, r.reason);
          return;
        }
        self.id_ = r.id;
        self.readyState_ = ReadyState.OPEN;
        self.dispatchEvent('open');
        self.waitForConnections_();
      } else {
        self.dispatchEvent('error', request.status);
      }
    });
    request.send('host=new');
  };
  
  Server.prototype.waitForConnections_ = function() {
    var request = new XMLHttpRequest();
    this.request_ = request;
    request.open('POST', this.host_, true);
    request.setRequestHeader("Content-type","application/x-www-form-urlencoded");
    request.responseType = 'json';
    addOneShotListener(request, 'loadend', this.onResponse_.bind(this, request));
    request.send('host='+this.id_+'&last_client='+this.lastClient_);
  };
  
  Server.prototype.onResponse_ = function(request, e) {
    if (request.status == 200) {
      var r = request.response;
      if (r.result == 'error') {
        this.readyState_ = ReadyState.CLOSED;
        this.dispatchEvent('error', r.code, r.reason);
        return;
      }
      if (r.result == 'success') {
        var clients = r.clients;
        for (var i = 0; i < clients.length; i++) {
          this.lastClient_ = clients[i].client_id;
          this.connecting_[clients[i].client_id] = {
              'accepted': false,
              'clientId': clients[i].client_id,
              'offer': new RTCSessionDescription(JSON.parse(clients[i].offer)),
              'offerCandidates': [],
              'answerCandidates': []};
          this.dispatchEvent('connection', clients[i].client_id);
          if (!this.connecting_[clients[i].client_id].accepted)
            delete this.connecting_[clients[i].client_id];
        }
      }
    }
    if (this.readyState_ == ReadyState.OPEN)
      this.waitForConnections_();
  };

  Server.prototype.accept = function(clientId, peerConnection) {
    var self = this;
    var details = this.connecting_[clientId];
    details.accepted = true;
    details.pc = peerConnection;
    
    peerConnection.setRemoteDescription(details.offer);
    peerConnection.createAnswer(function(desc) {
      peerConnection.setLocalDescription(desc);
      details.answer = desc;
      self.sendClientResponse_(clientId, ['answer='+encodeURIComponent(JSON.stringify(details.answer))]);
    }, function() { console.log('Failed to create answer'); });
    peerConnection.onicecandidate = function(e) {
      if (!e.candidate)
        return;
      details.answerCandidates.push(e.candidate);
      self.sendClientResponse_(clientId, ['answer_candidates='+encodeURIComponent(JSON.stringify(details.answerCandidates))]);
    }
    this.waitForClientCandidates_(clientId);
  };
  
  Server.prototype.sendClientResponse_ = function(clientId, args) {
    var details = this.connecting_[clientId];
    if (!details)
      return;
    var request = new XMLHttpRequest();
    request.open('POST', this.host_, true);
    request.setRequestHeader("Content-type","application/x-www-form-urlencoded");
    args.push('client='+clientId);
    request.send(args.join('&'));
  };
  
  Server.prototype.waitForClientCandidates_ = function(clientId) {
    var details = this.connecting_[clientId];
    if (!details)
      return;
    var request = details.request = new XMLHttpRequest();
    request.open('POST', this.host_, true);
    request.setRequestHeader("Content-type","application/x-www-form-urlencoded");
    request.responseType = 'json';
    addOneShotListener(request, 'loadend', this.onClientCandidates_.bind(this, clientId, request));
    request.send('client='+clientId+'&wait_offer_candidates='+(JSON.stringify(details.offerCandidates).length));
  };
  
  Server.prototype.onClientCandidates_ = function(clientId, request, e) {
    var details = this.connecting_[clientId];
    if (!details)
      return;
    details.request = null;
    if (request.status == 200) {
      var r = request.response;
      if (r.result == 'error' && r.resultCode == 404) {
        // Client no longer exists.
        delete this.connecting_[clientId];
      } else if (r.result == 'success') {
        var cands = JSON.parse(r.client.offer_candidates);
        for (var i = details.offerCandidates.length; i < cands.length; i++) {
          var candidate = new RTCIceCandidate(cands[i]);
          details.pc.addIceCandidate(candidate);
          details.offerCandidates.push(candidate);
        }
      }
    }
    this.waitForClientCandidates_(clientId);
  };
  
  Server.prototype.onConnected = function(clientId) {
    this.closeClient_(clientId);
  };

  Server.prototype.closeClient_ = function(clientId) {
    var details = this.connecting_[clientId];
    if (!details)
      return;
    delete this.connecting_[clientId];
    details.pc.onicecandidate = null;
    if (details.request)
      details.request.abort();
  }

  Server.prototype.close = function() {
    this.readyState_ = ReadyState.CLOSING;
    if (this.request_)
      this.request_.abort();
    for (var i in this.connecting_) {
      this.closeClient_(i);
    }
    this.readyState_ = ReadyState.CLOSED;
    this.dispatchEvent('close');
  };
  
  var Client = function(peerConnection) {
    EventSource.apply(this, [['error']]);
    this.details_ = {
      'offer': '',
      'answer': '',
      'offerCandidates': [],
      'answerCandidates': []};
    this.readyState_ = ReadyState.CONNECTING;
    this.pc_ = peerConnection;
    this.pc_.onicecandidate = this.onIceCandidate.bind(this);
  };
  
  Client.prototype.__proto__ = EventSource.prototype;
  
  Client.prototype.connect = function(url, offer) {    
    this.host_ = url;
    var request = new XMLHttpRequest();
    request.open('POST', this.host_, true);
    request.setRequestHeader("Content-type","application/x-www-form-urlencoded");
    request.responseType = 'json';
    var self = this;
    addOneShotListener(request, 'loadend', function(e) {
      if (request.status == 200) {
        var r = request.response;
        if (r.result == 'error') {
          self.close();
          self.dispatchEvent('error', r.code, r.reason);
          return;
        }
        self.id_ = r.id;
        self.readyState_ = ReadyState.OPEN;
        self.waitForDetails_();
      } else {
        self.close();
        self.dispatchEvent('error', request.status);
      }
    });
    request.send('client=new&offer='+encodeURIComponent(JSON.stringify(offer)));
  };
  
  Client.prototype.waitForDetails_ = function() {
    if (this.readyState_ != ReadyState.OPEN)
      return;
    var request = this.request_ = new XMLHttpRequest();
    request.open('POST', this.host_, true);
    request.setRequestHeader("Content-type","application/x-www-form-urlencoded");
    request.responseType = 'json';
    addOneShotListener(request, 'loadend', this.onDetails_.bind(this, request));
    if (!this.details_.answer)
      request.send('client='+this.id_+'&wait_answer=0');
    else
      request.send('client='+this.id_+'&wait_answer_candidates='+JSON.stringify(this.details_.answerCandidates).length);
  };
  
  Client.prototype.onDetails_ = function(request) {
    this.request_ = null;
    if (request.status == 200) {
      var r = request.response;
      if (r.result == 'error') {
        this.close();
        this.dispatchEvent('error', r.code, r.reason);
        return;
      }
      if (r.result == 'success') {
        if (r.client.answer) {
          this.pc_.setRemoteDescription(this.details_.answer = new RTCSessionDescription(JSON.parse(r.client.answer)));
          this.sendIceCandidates_();
        }
        if (r.client.answer_candidates) {
          var cands = JSON.parse(r.client.answer_candidates);
          for (var i = this.details_.answerCandidates.length; i < cands.length; i++) {
            var candidate = new RTCIceCandidate(cands[i]);
            this.pc_.addIceCandidate(candidate);
            this.details_.answerCandidates.push(candidate);
          }
        }
      }
    }
    this.waitForDetails_();
  };
  
  Client.prototype.onIceCandidate = function(e) {
    if (!e.candidate)
      return;
    this.details_.offerCandidates.push(e.candidate);
    this.sendIceCandidates_();
  };
  
  Client.prototype.sendIceCandidates_ = function() {
    if (this.id_ && this.details_.answer && this.details_.offerCandidates.length) {
      var request = new XMLHttpRequest();
      request.open('POST', this.host_, true);
      request.setRequestHeader("Content-type","application/x-www-form-urlencoded");
      request.send('client='+this.id_+'&offer_candidates='+encodeURIComponent(JSON.stringify(this.details_.offerCandidates)));
    }
  };
  
  Client.prototype.close = function() {
    this.readyState_ = ReadyState.CLOSED;
    if (this.request_)
      this.request_.abort();
  };
  
  var FragmentedChannel = function(channel, maxPacketSize) {
    EventSource.apply(this, [['open', 'message', 'close', 'error']]);
    this.maxPacketSize_ = maxPacketSize || 1024;
    this.channel_ = channel;
    this.buffer_ = '';
    this.outBuffer_ = '';
    this.messageLength_ = 0;
    channel.addEventListener('open', this.onOpen_.bind(this));
    channel.addEventListener('close', this.onClose_.bind(this));
    channel.addEventListener('message', this.onMessage_.bind(this));
    channel.addEventListener('error', this.onError_.bind(this));
  };
  
  FragmentedChannel.prototype.__proto__ = EventSource.prototype;
  
  FragmentedChannel.prototype.onOpen_ = function(e) {
    this.dispatchEvent('open', e);
  };
  
  FragmentedChannel.prototype.onClose_ = function(e) {
    this.dispatchEvent('close', e);
  };

  FragmentedChannel.prototype.onError_ = function(e) {
    this.dispatchEvent('error', e);
  };
  
  FragmentedChannel.prototype.onMessage_ = function(e) {
    this.buffer_ += e.data;
    while (this.buffer_.length >= this.messageLength_) {
      if (this.messageLength_ == 0) {
        var match = this.buffer_.match(/^[0-9]+\|/);
        if (!match)
          return;
        this.messageLength_ = parseInt(match[0].substr(0, match[0].length - 1));
        this.buffer_ = this.buffer_.substr(match[0].length);
      }
      if (this.buffer_.length >= this.messageLength_) {
        var message = this.buffer_.substr(0, this.messageLength_);
        this.buffer_ = this.buffer_.substr(this.messageLength_);
        this.messageLength_ = 0;
        this.dispatchEvent('message', {'data': message});
      }
    }
  };
  
  FragmentedChannel.prototype.send = function(msg) {
    this.outBuffer_ += msg.length + '|' + msg;
    if (!this.sending_)
      this.sendData_();
  };

  FragmentedChannel.prototype.sendData_ = function() {
    while (this.outBuffer_.length > 0) {
      try {
        this.channel_.send(this.outBuffer_.substr(0, this.maxPacketSize_));
      } catch (e) {
        break;
      }
      this.outBuffer_ = this.outBuffer_.substr(this.maxPacketSize_);
    }
    if (this.outBuffer_.length > 0) {
      this.sending_ = setTimeout(this.sendData_.bind(this), 25);
    } else {
      this.sending_ = null;
    }
  };
  
  FragmentedChannel.prototype.close = function() {
    this.channel_.close();
  };
  
  var LocalSocket = function(other) {
    EventSource.apply(this, [['open', 'message', 'close', 'error']]);
    if (other) {
      this.otherSocket_ = other;
      this.otherSocket_.otherSocket_ = this;
      var self = this;
      // The open event should wait until the user has had a chance to
      // register listeners for open on both ends of the connection.
      setTimeout(function() {
        self.otherSocket_.dispatchEvent('open');
        self.dispatchEvent('open');
      }, 0);
    }
    this.readyState_ = 1;
  };

  LocalSocket.prototype.__proto__ = EventSource.prototype;

  LocalSocket.prototype.send = function(data) {
    var self = this;
    setTimeout(function() {
      self.otherSocket_.dispatchEvent('message', {'data': data});
    }, 0);
  };
  
  LocalSocket.prototype.close = function(data) {
    this.otherSocket_.dispatchEvent('close');
    this.otherSocket_.readyState_ = 3;
    this.readyState_ = 3;
  };

  // Public objects
  return {
    'getUrlFromId': getUrlFromId,
    'ReadyState': ReadyState,
    'Server': Server,
    'Client': Client,
    'FragmentedChannel': FragmentedChannel,
    'LocalSocket': LocalSocket};
}();
