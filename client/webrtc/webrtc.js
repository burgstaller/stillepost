window.stillepost = window.stillepost || {};

window.stillepost.webrtc = (function() {
  var public = {},
    iceServers = {
      iceServers: [{
        url: 'stun:stun.l.google.com:19302'
      }]
    },
    optionalRtpDataChannels = {
      optional: [{
        RtpDataChannels: true
      }]
    },
    dataChannelOptions = {
      reliable: false
    },
    // list of all open webRTC connections
    connections = [],
    // local websockt information
    _localPeer, _localPort,
    _resolvePromise,
    // todo: handle reject
    _connected = new Promise(function(resolve, reject) {
      _resolvePromise = resolve;
    });

  public.connected = _connected;

  public.connections = connections;

  // This function is called by SignalingChannel.js on receiving a new signaling message
  public.handleSignalingMessage = function(message) {
    var connection = null;
    // check if message is part of an already created connection
    if (message.webRTCConnection) {
      console.log("Received message of connection "+message.webRTCConnection);
      var tmp;
      for (var i = 0; i < connections.length; i++) {
        tmp = connections[i];
        if (tmp.id === message.webRTCConnection) {
          console.log("Found existing connection "+message.webRTCConnection);
          connection = tmp;
        }
      }
    }
    // handle remotely invoked RTC connection
    if ((message.sdp || message.candidate) && !connection) {
      console.log("Create new remotely invoked webRTC (ID:"+message.webRTCConnection+")");
      connection = new WebRTCConnection(message.peerOrigin, message.portOrigin, message.webRTCConnection);
    }
    // handle sdp message
    if (message.sdp) {
      console.log("Processing sdp message",message.sdp);
      connection.pc.setRemoteDescription(new RTCSessionDescription(message.sdp), function () {
        // if we received an offer, we need to answer
        if (connection.pc.remoteDescription.type == 'offer') {
          console.log("Processed remote description from "+connection._remotePeer+":"+connection._remotePort+"- creating Answer");
          connection.pc.createAnswer(connection.localDescriptionCreated.bind(connection), logError);
        }
      }, logError);
    }
    // handle candidate message
    else if (message.candidate) {
      console.log("Processing ice candidate ",message.candidate);
      connection.pc.addIceCandidate(new RTCIceCandidate(message.candidate));
    }
    // handle websocket init message
    else if (message.peer) {
      console.log("Successfully established connection to WebSocket Server on local address "+message.peer+":"+message.port);
      _localPeer = message.peer;
      _localPort = message.port;
      _resolvePromise({address: _localPeer, port: _localPort});
    } else if (message.error) {
      console.log("websocket server responded with error "+message.error);
      if (connection) {
        connection._connectionError("WebRTC signaling server responded with error "+message.error);
        connection.pc.close();
        removeConnection(connection.id);
      }
    } else {
      console.log("Signaling channel: Received unsupported message type");
    }
  };

  // Single WebRTCConnection
  function WebRTCConnection(peer, port, id) {
    this._remotePeer = peer;
    this._remotePort = port;
    this._dataChannel = null;
    this._promise = new Promise(function(resolv,reject) {
      this._connectionReady = resolv;
      this._connectionError = reject;
    }.bind(this));
    this.pc = null;
    // we need a way to identify a connection
    if (id) {
      this.id = id;
    } else {
      this.id = crypto.getRandomValues(new Uint32Array(1))[0];
    }

    this.localDescriptionCreated = function (desc) {
      console.log("callback localDescriptionCreated - sending to "+this._remotePeer+":"+this._remotePort+" conn_id("+this.id+")");
      this.pc.setLocalDescription(desc, function () {
        window.stillepost.signalingChannel.send(JSON.stringify({
          'peerOrigin': _localPeer,
          'portOrigin': _localPort,
          'peer': this._remotePeer,
          'port': this._remotePort,
          'webRTCConnection': this.id,
          'sdp': this.pc.localDescription
        }));
      }.bind(this), logError);
    };

    this.onDataChannelCreated = function(channel) {
      console.log('onDataChannelCreated:', channel);

      channel.onopen = function () {
        console.log('Data channel opened');
        this._connectionReady();
      }.bind(this);

      channel.onerror = function (error) {
        console.log("Data channel error ", error);
        this._connectionError("WebRTC DataChannel error");
        window.stillepost.onion.peerDisconnected(this._remotePeer, this._remotePort);
        removeConnection(this.id);
      }.bind(this);

      channel.onmessage = function(event) {
        if (event.data) {
          var data = JSON.parse(event.data);
          console.log("Received message from " + this._remotePeer + ":" + this._remotePort + " message: ", data);
          window.stillepost.onion.handleMessage(data, this._remotePeer, this._remotePort, this);
        }
      }.bind(this);

      channel.onclose = function() {
        console.log("data channel close");
        this._connectionError("WebRTC DataChannel was closed");
        window.stillepost.onion.peerDisconnected(this._remotePeer, this._remotePort);
        removeConnection(this.id);
      }.bind(this);
    };

    console.log("Start RTCPeerConnection");
    this.pc = new RTCPeerConnection(iceServers);

    // send any ice candidates to the other peer
    this.pc.onicecandidate = function (evt) {
      console.log("onicecandidate triggered - sending candidate to "+this._remotePeer+":"+this._remotePort+" conn_id("+this.id+")");
      if (evt.candidate)
        window.stillepost.signalingChannel.send(JSON.stringify({
          'peerOrigin': _localPeer,
          'portOrigin': _localPort,
          'peer':this._remotePeer,
          'port':this._remotePort,
          'webRTCConnection': this.id,
          'candidate': evt.candidate
        }));
    }.bind(this);

    // let the 'negotiationneeded' event trigger offer generation
    this.pc.onnegotiationneeded = function () {
      console.log("event  onnegotiationneeded");
      this.pc.createOffer(this.localDescriptionCreated.bind(this), logError, mediaConstraints);
    }.bind(this);

    this.pc.ondatachannel = function (event) {
      console.log('ondatachannel event triggered ', event.channel);
      this._dataChannel = event.channel;
      this.onDataChannelCreated(this._dataChannel);
    }.bind(this);

    this.pc.oniceconnectionstatechange = function() {
      if (this.pc.iceConnectionState === 'disconnected') {
        console.log("current iceConnectionState: ",this.pc.iceConnectionState);
      }
    }.bind(this);

    connections.push(this);
  }

  WebRTCConnection.prototype.createOffer = function() {
    this.pc.createOffer(this.localDescriptionCreated.bind(this), logError, mediaConstraints);
  };

  WebRTCConnection.prototype.createDataChannel = function() {
    this._dataChannel = this.pc.createDataChannel('RTCDataChannel', dataChannelOptions);
    this.onDataChannelCreated(this._dataChannel);
    return this._dataChannel;
  };

  WebRTCConnection.prototype.send = function(data) {
    return this._promise.then(function() {
      return new Promise(function (resolve, reject) {
        if (this._dataChannel.readyState === "closed") {
          reject();
        } else {
          this._dataChannel.send(JSON.stringify(data));
          resolve();
        }
      }.bind(this));
    }.bind(this));
  };

  function removeConnection(connectionId) {
    var tmp;
    for (var i = 0; i < connections.length; i++) {
      tmp = connections[i];
      if (tmp.id === connectionId) {
        console.log("Removing webrtc connection "+connectionId);
        connections.splice(i,1);
      }
    }
  }

  public.createConnection = function(peer, port) {
    // parse port to integer
    var parsedPort = port;
    if (typeof port === "string") {
      try {
        parsedPort = parseInt(port);
      }
      catch(err) {
        console.log("Error while parsing parameter port of type string to int type");
      }
    }

    // check if connection already exists and return it
    var conn = null;
    for (var i = 0; i < connections.length; i++) {
      conn = connections[i];
      if (conn._remotePeer === peer && conn._remotePort === port) {
        return conn;
      }
    }

    // if connection does not yet exist create a new one
    var connection = new WebRTCConnection(peer, parsedPort);
    connection.createDataChannel();
    // firefox apparently doesn't trigger onnegotiationneeded event - need to manually create offer
    if (webrtcDetectedBrowser === "firefox") {
      connection.createOffer();
    }
    return connection;
  };

  function logError(error) {
    console.log("error: ",error);
  }

  window.onbeforeunload = function() {
    var conn = null;
    for (var i=0; i < connections.length; i++) {
      conn = connections[i];
      conn.pc.close();
    }
  };

  return public;
})();
