window.stillepost = window.stillepost || {};
window.stillepost.onion = window.stillepost.onion || {};

// object containing all intermediate node logic
window.stillepost.onion.intermediateNode = (function() {
  var public = {},
    onion = window.stillepost.onion.onionRouting,
    cu = window.stillepost.cryptoUtils,
    webrtc = window.stillepost.webrtc;

  public.init = function() {
    onion = window.stillepost.onion.onionRouting;
    cu = window.stillepost.cryptoUtils;
    webrtc = window.stillepost.webrtc;
  };

  public.build = function(message, content, unwrappedKey, remoteAddress, remotePort, webRTCConnection) {
    logToConsole("Sending build command to next node: ", content.nodeSocket);
    content.chainIdIn = str2ab(content.chainIdIn);
    content.chainIdOut = str2ab(content.chainIdOut);
    cu.hashArrayObjects([cu.abConcat(content.chainIdIn, 1, onion.linkType.decrypt), cu.abConcat(content.chainIdOut, 1, onion.linkType.encrypt)]).then(function(digestArray) {
      // add entries to chainMap - which maps a chainId to a specific chain
      // entry for master -> exitNode direction
      onion.chainMap[digestArray[0]] = {socket: content.nodeSocket, key: unwrappedKey, chainIdIn: content.chainIdIn, seqNumRead: 1,
        chainIdOut: content.chainIdOut, seqNumWrite: 1, type: onion.linkType.decrypt};
      // entry for exitNode -> master direction
      onion.chainMap[digestArray[1]] = {
        socket: {address: remoteAddress, port: remotePort},
        key: unwrappedKey,
        chainIdIn: content.chainIdOut,
        seqNumRead: 1,
        chainIdOut: content.chainIdIn,
        seqNumWrite: 1,
        type: onion.linkType.encrypt
      };

      var buildMessage = {
        commandName: onion.commandNames.build,
        iv: content.data.iv,
        keyData: content.data.keyData,
        chainData: content.data.chainData
      };
      logToConsole("Command to send: ", buildMessage);
      // Create webrtc connection with next node in the chain and send the data
      var con = webrtc.createConnection(content.nodeSocket.address, content.nodeSocket.port);
      con.send(buildMessage).catch(function (err) {
        // if an error occurred while trying to send message to next node, we return an error message to the previous node
        onion.sendError("Error while sending build message to next node " +
        content.nodeSocket.address + ":" + content.nodeSocket.port, err, webRTCConnection, content.chainIdIn, 1, onion.linkType.encrypt);
      });
    });
  };

  /**
   * Entry or intermediate node logic: Encrypt and forward message.
   * This logic represents the back-traversal of the message response from exit node to chain master node
   * Schematic representation of the message, which is generated.
   * message = {chainData: E_aesNode(message.chainData, message.iv), iv: <newly generated nonce>]
   * @param message ... the message JSON object received via webRTC
   * @param webRTCConnection
   * @param node
   */
  public.wrapMessage = function(message, node, webRTCConnection) {
    var iv = cu.generateNonce(),
      dataToEncrypt = {chainData: message.chainData, iv: message.iv};
    logToConsole("Encrypting and forwarding data to next node: ",node);
    logToConsole(dataToEncrypt);

    var encWorker = new Worker(onion.worker.encrypt);
    encWorker.postMessage({iv:iv, key:node.key, data:JSON.stringify(dataToEncrypt), additionalData: message.commandName});

    encWorker.onmessage = function(workerMessage){
      onion.encWorkerListener(workerMessage, webRTCConnection, iv, node, message);
    };
  };

  public.message = function(message, node, webRTCConnection) {
    var iv = str2ab(message.iv),

      decWorker = new Worker(onion.worker.decrypt);
    decWorker.postMessage({iv:iv, key:node.key, data:message.chainData, additionalData: message.commandName});

    decWorker.onmessage = function(workerMessage) {

      var hashErrorCallback = function (error){
        //error callback for hash operation
        logToConsole('error in decWorkerListener: ', error);
        onion.closeSingleWebRTCConnection(webRTCConnection);
      };

      if (workerMessage.data.success) {
        workerMessage.data.data = JSON.parse(workerMessage.data.data);
        // Try to compute Hash for next node
        cu.hashArrayObjects([cu.abConcat(node.chainIdOut, node.seqNumWrite, node.type),
          JSON.stringify({seqNum: node.seqNumWrite++, chainId: node.chainIdOut, data: workerMessage.data.data.chainData})]).then(function(digestArray) {
          var con = webrtc.createConnection(node.socket.address, node.socket.port),
            command = {
              commandName: message.commandName,
              chainId: digestArray[0],
              iv: workerMessage.data.data.iv,
              chainData: workerMessage.data.data.chainData,
              checksum: digestArray[1]
            };
          logToConsole('Forwarding message to next node in exit node direction');
          con.send(command).catch(function (err) {
            return webRTCConnection.send({commandName: onion.commandNames.error, chainId: digestArray[0], errorMessage: {message: "Error while sending message to next node", error: err}});
          });
        }).catch(hashErrorCallback);
      } else {
        // Try to compute Hash for next node
        cu.hash(cu.abConcat(node.chainIdOut, node.seqNumWrite, node.type)).then(function(digest) {
          //in decryption case send error to previous node in chain
          return webRTCConnection.send({commandName: onion.commandNames.error, chainId: digest, errorMessage: {message: "Error while forwarding message at intermediate node", error: workerMessage.data.data}});
        }).catch(hashErrorCallback);
      }
    };
  };

  public.close = function(message, node) {
    var iv = str2ab(message.iv),
      decWorker = new Worker(onion.worker.decrypt);
    decWorker.postMessage({iv:iv, key:node.key, data:message.chainData, additionalData: message.commandName});

    decWorker.onmessage = function(workerMessage) {
      if (workerMessage.data.success) {
        workerMessage.data.data = JSON.parse(workerMessage.data.data);
        cu.hashArrayObjects([cu.abConcat(node.chainIdOut, node.seqNumWrite, node.type),
          JSON.stringify({
            seqNum: node.seqNumWrite++,
            chainId: node.chainIdOut,
            data: workerMessage.data.data.chainData
          })]).then(function (digestArray) {
          var con = webrtc.createConnection(node.socket.address, node.socket.port),
            command = {
              commandName: message.commandName,
              chainId: digestArray[0],
              iv: workerMessage.data.data.iv,
              chainData: workerMessage.data.data.chainData,
              checksum: digestArray[1]
            };
          logToConsole('Forwarding close message to next node in exit node direction');
          con.send(command).catch(function (err) {
            logToConsole('Error while sending close message to next node');
          });
        });
      }
    };
  };

  return public;
})();