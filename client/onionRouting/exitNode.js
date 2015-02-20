window.stillepost = window.stillepost || {};
window.stillepost.onion = window.stillepost.onion || {};

// object containing all exit node logic
window.stillepost.onion.exitNode = (function() {
  var public = {},

  // map of h(chainId || seqNum) -> pubChainId
  exitNodeMap = {},
  onion = window.stillepost.onion.onionRouting,
  cu = window.stillepost.cryptoUtils,
  webrtc = window.stillepost.webrtc;

  public.init = function() {
    onion = window.stillepost.onion.onionRouting;
    cu = window.stillepost.cryptoUtils;
    webrtc = window.stillepost.webrtc;
  };

  public.build = function(message, content, unwrappedKey, remoteAddress, remotePort, webRTCConnection) {
    console.log("Received build message as exit node ", content);
    content.chainId = objToAb(content.chainId);
    cu.hashArrayObjects([cu.uInt32Concat(content.chainId, 1), cu.uInt32Concat(content.chainId, 1)]).then(function(digestArray) {

      var mapEntry = {socket: {address: remoteAddress, port: remotePort}, key: unwrappedKey, chainIdIn: content.chainId, chainIdOut: content.chainId,
        seqNumRead: 1, seqNumWrite: 2, type: "exit"};

      // Add chainMap entry, since the current node works as exit node in this chain, we only store the mapping for the "previous" node in the chain.
      onion.chainMap[digestArray[0]] = mapEntry;

      var pubChainId = cu.generateRandomInt32();
      while (exitNodeMap[pubChainId]) {
        pubChainId = cu.generateRandomInt32();
      }
      exitNodeMap[pubChainId] = mapEntry;
      content.data.pubChainId = pubChainId;

      // In order to acknowledge a successful chain build-up we return a build-command message, which contains the encrypted nonce signifying a successful build-up
      var iv = cu.generateNonce();
      return cu.encryptAES(JSON.stringify(content.data), unwrappedKey, iv, message.commandName).then(function (encData) {
        var command = {commandName: 'build', chainId: digestArray[1], iv: iv, chainData: encData};
        console.log("Exit node sending ack command: ", command);
        return webRTCConnection.send(command);
      });
    }).catch(function (err) {
      console.log("Error at exit node", err);
      onion.sendError("Error handling data on exit node " + onion.localSocket.address + ":" + onion.localSocket.port,
        err, webRTCConnection, content.chainId, 1);
    });

  };

  public.message = function(message, node, webRTCConnection) {
    processMessage(message, node, webRTCConnection, function(data) {
      var encryptionIV = cu.generateNonce(),
        encWorker = new Worker('onionRouting/encryptionWorker.js');
      console.log("Received message through chain ", data);

      encWorker.postMessage({iv:encryptionIV, key: node.key, data: JSON.stringify(data), additionalData: message.commandName});
      encWorker.onmessage = function(workerMessage) {
        onion.encWorkerListener(workerMessage, webRTCConnection, encryptionIV, node, message);
      };
    });
  };

  function processMessage(message, node, webRTCConnection, successCallback) {
    var iv = objToAb(message.iv),
      decWorker = new Worker('onionRouting/decryptionWorker.js');

    decWorker.postMessage({iv:iv, key:node.key, data:message.chainData, additionalData: message.commandName});

    decWorker.onmessage = function(workerMessage){
      if (workerMessage.data.success) {
        // handle the received message as exit node
        if (successCallback)
          successCallback(JSON.parse(workerMessage.data.data));
      } else {
        onion.sendError("Error while forwarding message at intermediate node", workerMessage.data.data, webRTCConnection, node.chainIdOut, node.seqNumWrite);
      }
    };
  }

  public.forwardClientMessage = function(message, node, webRTCConnection) {
    var encryptionIV = cu.generateNonce(),
      encWorker = new Worker('onionRouting/encryptionWorker.js');
    console.log("Forwarding client message through chain ", node, message.chainData);

    encWorker.postMessage({iv:encryptionIV, key: node.key, data: JSON.stringify(message.chainData), additionalData: message.commandName});
    encWorker.onmessage = function(workerMessage) {
      onion.encWorkerListener(workerMessage, webRTCConnection, encryptionIV, node, message);
    };
  };

  public.clientMessage = function(message, node, webRTCConnection) {
    processMessage(message, node, webRTCConnection, function (data) {
      console.log('Decrypted client message data: ', data);
      // check if this node is the exit node of both chains
      if (data.socket.address === onion.localSocket.address && data.socket.port === onion.localSocket.port) {
        var pubEntry = exitNodeMap[data.message.connectionId];
        if (pubEntry) {
          console.log('clientMessage: Found exitNodeMap entry', pubEntry);
          public.forwardClientMessage(message, pubEntry, webRTCConnection);
        }
      } else {
        var con = webrtc.createConnection(data.socket.address, data.socket.port);
        con.send({commandName: message.commandName, chainData: data.message, chainId: data.chainId}).catch(function(err) {
          onion.sendError('Error: Could not send message to remote exit node', err, webRTCConnection, node.chainIdIn, node.seqNumWrite);
        });
      }
    });
  };

  public.exitNodeMap = exitNodeMap;

  return public;
})();