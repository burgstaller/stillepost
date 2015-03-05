window.stillepost = window.stillepost || {};
window.stillepost.onion = window.stillepost.onion || {};

// object containing all exit node logic
window.stillepost.onion.messageHandler = (function() {
  var public = {},

    onion = window.stillepost.onion.onionRouting,
    cu = window.stillepost.cryptoUtils,
    webrtc = window.stillepost.webrtc,
    intermediateNode = window.stillepost.onion.intermediateNode,
    exitNode = window.stillepost.onion.exitNode;

  public.build = function(message, remoteAddress, remotePort, webRTCConnection) {
    // if the message contains key data it is sent in the direction of chain master -> exit node
    if (message.keyData) {
      cu.unwrapAESKey(message.keyData).then(function (unwrappedKey) {
        return cu.decryptAES(message.chainData, unwrappedKey, objToAb(message.iv), 'build').then(function (decData) {
          var decryptedJson = JSON.parse(decData);
          console.log("Decrypted data: ", decryptedJson);
          if (decryptedJson.nodeSocket) {
            // send to next socket
            intermediateNode.build(message, decryptedJson, unwrappedKey, remoteAddress, remotePort, webRTCConnection);
          } else {
            // exit node logic - respond to build message
            exitNode.build(message, decryptedJson, unwrappedKey, remoteAddress, remotePort, webRTCConnection);
          }
        });
      }).catch(function (err) {
        console.log("Error decrypting data ", err);
        onion.sendError("Error decrypting data on chain node " + onion.localSocket.address + ":" + onion.localSocket.port,
          err, webRTCConnection);
      });
    }
    else {
      updateChainMap(message, webRTCConnection).then(function(result) {
        if (!result.node) {
          // we received ack message as master of the chain - validate content
          onion.masterNodeMessageHandler.build(result.message);
        } else {
          // intermediate node logic: Encrypt and forward build message response.
          intermediateNode.wrapMessage(result.message, result.node, result.webRTCConnection);
        }
      }).catch(function(err) {
        console.log('Error in updateChainMap while handling build message',err);
      });
    }
  };

  public.error = function(message, remoteAddress, remotePort, webRTCConnection) {
    if (onion.isMasterNode(message.chainId)) {
      onion.masterNodeMessageHandler.error(message, webRTCConnection);
    } else {
      // we are not an endpoint node and need to forward the error message
      var node = onion.chainMap[message.chainId];
      if (node && node.socket.address) {
        cu.hash(cu.abConcat(node.chainIdOut, node.seqNumWrite)).then(function(digest) {
          console.log('Forwarding error message to next node '+remoteAddress+":"+remotePort);
          var con = webrtc.createConnection(node.socket.address, node.socket.port);
          return con.send({commandName: "error", chainId: digest, errorMessage: message.errorMessage}).then(function() {
            onion.closeSingleWebRTCConnection(webRTCConnection);
            delete onion.chainMap[message.chainId];
          });
        }).catch(function(err) {
          console.log('Error forwarding error: ',err);
        });
      } else if (node) {
        console.log('Exit node deleting chainMap entry');
        delete onion.chainMap[message.chainId];
      } else {
        onion.closeSingleWebRTCConnection(webRTCConnection);
        console.log("Received error commandMessage without valid chainId from " + remoteAddress + ":" + remotePort , message.errorMessage.message);
      }
    }
  };

  public.message = function(message, remoteAddress, remotePort, webRTCConnection) {
    queue.add(wrapFunction(updateChainMap, this, [message, webRTCConnection]));
  };

  public.close = function(message, remoteAddress, remotePort, webRTCConnection) {
    var handleClose = function(message) {
      return new Promise(function(resolve, reject) {
        var node = onion.chainMap[message.chainId];
        if (node && node.type === 'decrypt') {
          intermediateNode.close(message, node);
        } else if (node && node.type === 'exit') {
          exitNode.close(message, node);
        } else if (node && node.type === 'encrypt') {
          intermediateNode.wrapMessage(message, node, null);
        }
        delete onion.chainMap[message.chainId];
        resolve(message);
      });
    };
    queue.add(wrapFunction(handleClose, this, [message]))
  };

  function messageCallback(message) {
    if (message && message.node) {
      if (message.node.type === "decrypt") {
        var fn = (typeof intermediateNode[message.message.commandName] === 'function') ?
          intermediateNode[message.message.commandName] : intermediateNode.message;
        fn(message.message, message.node, message.webRTCConnection);
      } else if (message.node.type === "exit") {
        exitNode[message.message.commandName](message.message, message.node, message.webRTCConnection);
      } else {
        intermediateNode.wrapMessage(message.message, message.node, message.webRTCConnection);
      }
    } else if(message.master) {
      onion.masterNodeMessageHandler[message.message.commandName](message.message);
    } else if (!(message.commandName === 'close')) {
      onion.sendError("Received invalid chainId", null, message.webRTCConnection);
    }
  }

  public.clientMessage = function(message, remoteAddress, remotePort, webRTCConnection) {
    var pubEntry = exitNode.exitNodeMap[message.chainId];
    // If pubEntry exists this node is a exit node and received a clientMessage from another exitNode
    if (pubEntry) {
      console.log('clientMessage: Found exitNodeMap entry', pubEntry);
      exitNode.forwardClientMessage(message, pubEntry, webRTCConnection);
    } else {
      public.message(message, remoteAddress, remotePort, webRTCConnection);
    }
  };

  public.init = function () {
    onion = window.stillepost.onion.onionRouting;
    cu = window.stillepost.cryptoUtils;
    webrtc = window.stillepost.webrtc;
    intermediateNode = window.stillepost.onion.intermediateNode;
    exitNode = window.stillepost.onion.exitNode;
  };

  /**
   * Interface function called by WebRTC to handle an incoming onion request.
   * A message type is identified by the "commandName" attribute.
   * A onion chain message corresponds to a JSON object, which contains at least following attributes:
   *  - commandName
   *  - chainId
   *  - chainData
   * Following commandNames are supported:
   *  - build ... command used for chain build-up
   *  - ajaxRequest ... command used to send an ajax-Request via the chain
   *  - connect ... command used to connect to a specific node via the chain (The exitNode of the chain initiates a webRTC connection to the specified node)
   *  - error ... command used to handle errors
   * @param message the message that was send via webrtc
   * @param remoteAddress Address of the remote peer who send the message
   * @param remotePort Port of the remote peer who send the message
   * @param webRTCConnection the WebRTC connection object to the origin of the message
   */
  public.handleMessage = function(message, remoteAddress, remotePort, webRTCConnection) {
    if (message && message.commandName) {
      var fn = window.stillepost.onion.messageHandler[message.commandName];
      if (typeof fn === 'function') {
        console.log("Handle message: ", message);
        fn(message, remoteAddress, remotePort, webRTCConnection);
      } else {
        window.stillepost.onion.messageHandler.message(message, remoteAddress, remotePort, webRTCConnection);
      }
    }
  };

  var queue = {
    entries: [],
    busy: false,
    error: function(err) {
      onion.sendError(err.errorMessage, err.errorObj, err.webRTCConnection);
      queue.shift();
    },
    add: function(func) {
      if (this.entries.length > 0 || this.busy)
        this.entries.push(func);
      else {
        this.busy = true;
        func().then(this.processMessage, queue.error);
      }
    },
    shift: function() {
      if (queue.entries.length > 0) {
        (queue.entries.shift())().then(this.processMessage, queue.error);
      } else {
        this.busy = false;
      }
    },
    processMessage: function(message) {
      messageCallback(message);
      queue.shift();
    }
  };

  function updateChainMap(message, webRTCConnection) {
    if (onion.isMasterNode(message.chainId)) {
      return onion.updateMasterHash(message, webRTCConnection);
    }
    return new Promise(function(resolve, reject) {
      var node = onion.chainMap[message.chainId];
      if (node) {
        var mode = node.type === 'exit' ? 'decrypt' : node.type;
        cu.hashArrayObjects([JSON.stringify({seqNum: node.seqNumRead, chainId: node.chainIdIn, data: message.chainData}),
          cu.abConcat(node.chainIdIn, ++node.seqNumRead, mode)]).then(function (digestArray) {
          if (digestArray[0] !== message.checksum)
            reject({errorMessage: 'Invalid checksum', webRTCConnection: webRTCConnection});
          onion.chainMap[digestArray[1]] = node;
          delete onion.chainMap[message.chainId];
          resolve({message: message, node: node, webRTCConnection: webRTCConnection});
        }).catch(function(err) {
          reject({errorMessage: err, webRTCConnection: webRTCConnection, errorObj: Error()});
        });
      } else {
        reject({errorMessage: "Received invalid chainId", webRTCConnection: webRTCConnection, errorObj: Error()});
      }
    });
  }

  return public;
})();