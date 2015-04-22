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
      ordered: true
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
      logToConsole("Received message of connection "+message.webRTCConnection);
      var tmp;
      for (var i = 0; i < connections.length; i++) {
        tmp = connections[i];
        if (tmp.id === message.webRTCConnection) {
          logToConsole("Found existing connection "+message.webRTCConnection);
          connection = tmp;
        }
      }
    }
    // handle remotely invoked RTC connection
    if ((message.sdp || message.candidate) && !connection) {
      logToConsole("Create new remotely invoked webRTC (ID:"+message.webRTCConnection+")");
      connection = new WebRTCConnection(message.peerOrigin, message.portOrigin, message.webRTCConnection);
    }
    // handle sdp message
    if (message.sdp) {
      logToConsole("Processing sdp message",message.sdp);
      connection.pc.setRemoteDescription(new RTCSessionDescription(message.sdp), function () {
        // if we received an offer, we need to answer
        if (connection.pc.remoteDescription.type == 'offer') {
          logToConsole("Processed remote description from "+connection._remotePeer+":"+connection._remotePort+"- creating Answer");
          connection.pc.createAnswer(connection.localDescriptionCreated.bind(connection), logError);
        }
      }, logError);
    }
    // handle candidate message
    else if (message.candidate) {
      logToConsole("Processing ice candidate ",message.candidate);
      connection.pc.addIceCandidate(new RTCIceCandidate(message.candidate));
    }
    // handle websocket init message
    else if (message.peer) {
      logToConsole("Successfully established connection to WebSocket Server on local address "+message.peer+":"+message.port);
      _localPeer = message.peer;
      _localPort = message.port;
      _resolvePromise({address: _localPeer, port: _localPort});
    } else if (message.error) {
      logToConsole("websocket server responded with error "+message.error);
      if (connection) {
        connection._connectionError("WebRTC signaling server responded with error "+message.error);
        connection.pc.close();
        removeConnection(connection.id);
      }
    } else {
      logToConsole("Signaling channel: Received unsupported message type");
    }
  };

  // Single WebRTCConnection
  function WebRTCConnection(peer, port, id) {
    this._remotePeer = peer;
    this._remotePort = port;
    this._dataChannel = null;
    this._messageBuffers = {};
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
      logToConsole("callback localDescriptionCreated - sending to "+this._remotePeer+":"+this._remotePort+" conn_id("+this.id+")");
      this.pc.setLocalDescription(desc, function () {
        window.stillepost.signalingChannel.websocket.send(JSON.stringify({
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
      logToConsole('onDataChannelCreated:', channel);

      channel.onopen = function () {
        logToConsole('Data channel opened');
        this._connectionReady();
      }.bind(this);

      channel.onerror = function (error) {
        logToConsole("Data channel error ", error);
        this._connectionError("WebRTC DataChannel error");
        window.stillepost.onion.onionRouting.peerDisconnected(this._remotePeer, this._remotePort);
        removeConnection(this.id);
      }.bind(this);

      channel.onmessage = function(event) {
        if (event.data) {
          var data = JSON.parse(event.data);
          if(data.chunkCount === 1) {
              logToConsole("Received message from " + this._remotePeer + ":" + this._remotePort + " message: ", data);
              window.stillepost.onion.messageHandler.handleMessage(JSON.parse(data.msg), this._remotePeer, this._remotePort, this);
          }
          else{
              if(this._messageBuffers[data.msgId] === undefined){
                  var buffer = { messagesReceived: 1, messageBuffer:[]};
                  buffer.messageBuffer[data.chunkNumber] = data.msg;
                  this._messageBuffers[data.msgId] = buffer;
              }
              else{
                  var buffer = this._messageBuffers[data.msgId];
                  buffer.messagesReceived += 1;
                  buffer.messageBuffer[data.chunkNumber] = data.msg;
                  if(buffer.messagesReceived === data.chunkCount){
                     var messageAsString = '';
                     for (var i = 1; i <= data.chunkCount; i++){
                         messageAsString += buffer.messageBuffer[i];
                     }
                     delete buffer;
                     window.stillepost.onion.messageHandler.handleMessage(JSON.parse(messageAsString), this._remotePeer, this._remotePort, this);
                  }
              }
          }
        }
      }.bind(this);

      channel.onclose = function() {
        logToConsole("data channel close");
        this._connectionError("WebRTC DataChannel was closed");
        window.stillepost.onion.onionRouting.peerDisconnected(this._remotePeer, this._remotePort);
        removeConnection(this.id);
      }.bind(this);
    };

    logToConsole("Start RTCPeerConnection");
    this.pc = new RTCPeerConnection(iceServers);

    // send any ice candidates to the other peer
    this.pc.onicecandidate = function (evt) {
      logToConsole("onicecandidate triggered - sending candidate to "+this._remotePeer+":"+this._remotePort+" conn_id("+this.id+")");
      if (evt.candidate)
        window.stillepost.signalingChannel.websocket.send(JSON.stringify({
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
      logToConsole("event  onnegotiationneeded");
      this.pc.createOffer(this.localDescriptionCreated.bind(this), logError, mediaConstraints);
    }.bind(this);

    this.pc.ondatachannel = function (event) {
      logToConsole('ondatachannel event triggered ', event.channel);
      this._dataChannel = event.channel;
      this.onDataChannelCreated(this._dataChannel);
    }.bind(this);

    this.pc.oniceconnectionstatechange = function() {
      if (this.pc.iceConnectionState === 'disconnected') {
        logToConsole("current iceConnectionState: ",this.pc.iceConnectionState);
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
      if (this._dataChannel.readyState === "closed") {
        throw Error('Could not send message - dataChannel is closed');
      } else {
          var message = JSON.stringify(data),
              messageLength = message.length,
              chunkSize = window.stillepost.interfaces.config.chunkSize; //15KB

          if(messageLength > chunkSize){
            var chunkCount = Math.ceil(messageLength / chunkSize),
                msgId = window.stillepost.cryptoUtils.generateRandomInt32();
            for(var i = 0; i < chunkCount; i++){
                var messageObject = { chunkNumber: i+1, chunkCount: chunkCount, msgId: msgId, msg: message.slice(i*chunkSize,chunkSize*i + chunkSize)};
                if(i === chunkCount - 1)
                    messageObject.padding = createPadding(chunkSize - (messageLength - i*chunkSize));
                sendMessageObject(this._dataChannel, messageObject);
            }
          }
          else {
            var messageObject = { chunkNumber: 1, chunkCount: 1, msg: message, padding: createPadding(chunkSize-messageLength)};
            sendMessageObject(this._dataChannel, messageObject);
          }
      }
    }.bind(this));
  };

  WebRTCConnection.prototype.close = function() {
    if (this._dataChannel.readyState !== 'closed' && this.pc.signalingState !== 'closed') {
      this.pc.close();
    }
  };

  WebRTCConnection.prototype.getRemoteSocket = function() {
    return {address: this._remotePeer, port: this._remotePort};
  };

  function sendMessageObject(dataChannel, messageObject){
      if(dataChannel.bufferedAmount > 10000000) { //10MB
        setTimeout(function() { sendMessageObject(dataChannel, messageObject); }, 200); //200ms
      }
      else {
        dataChannel.send(JSON.stringify(messageObject));
      }
  }

  function createPadding(length){
//      var padding = "",
//          symbols = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
//
//      for(var i = 0; i < length; i++){
//          padding += symbols.charAt(Math.floor(Math.random() * symbols.length));
//      }
//      return padding;
      return "";
  }

  function removeConnection(connectionId) {
    var tmp;
    for (var i = 0; i < connections.length; i++) {
      tmp = connections[i];
      if (tmp.id === connectionId) {
        logToConsole("Removing webrtc connection "+connectionId);
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
        logToConsole("Error while parsing parameter port of type string to int type");
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
    logToConsole("error: ",error);
  }

  // cleanup
  public.cleanUp = function() {
    var conn = null;
    for (var i=0; i < connections.length; i++) {
      conn = connections[i];
      conn.close();
    }
  };

  return public;
})();
