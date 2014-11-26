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
    _localPeer, _localPort;

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
      }.bind(this), logError);
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
    } else {
      console.log("Signaling channel: Received unsupported message type");
    }
  };

  // Single WebRTCConnection
  function WebRTCConnection(peer, port, id) {
    this._remotePeer = peer;
    this._remotePort = port;
    this._dataChannel = null;
    this.pc = null;
    // we need a way to identify a connection
    if (id) {
      this.id = id;
    } else {
      // todo: create unique id
      this.id = Math.random() * 100000;
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
        channel.send("this is the plz-work-message");
      };

      channel.onerror = function (error) {
        console.log("Data channel error ", error);
      };

      channel.onmessage = function(event) {
        console.log("Received message from " +this._remotePeer+":"+this._remotePort+" message: " + event.data);
      }.bind(this);

      channel.onclose = function() {
        console.log("data channel close");
      }
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
    this._dataChannel.send(data);
  };

  public.createConnection = function(peer, port) {
    var connection = new WebRTCConnection(peer, port);
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

  return public;
})();
