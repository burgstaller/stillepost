window.stillepost = window.stillepost || {};
window.stillepost.onion = window.stillepost.onion || {};

// object containing all exit node logic
window.stillepost.onion.exitNode = (function() {
  var public = {},

  // map of h(chainId || seqNum) -> pubChainId
  exitNodeMap = {},
  messageBuffer = {},
  _activeWebWorkers = 0,
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
    content.chainId = str2ab(content.chainId);
    cu.hashArrayObjects([cu.abConcat(content.chainId, 1, onion.linkType.decrypt), cu.abConcat(content.chainId, 1, onion.linkType.encrypt)]).then(function(digestArray) {

      var chainNonce = cu.generateNonce(),
        mapEntry = {socket: {address: remoteAddress, port: remotePort}, key: unwrappedKey, chainIdIn: content.chainId, chainIdOut: content.chainId,
        seqNumRead: 1, seqNumWrite: 2, type: onion.linkType.exit, nonce: chainNonce, nextMessageId: 0};

      // Add chainMap entry, since the current node works as exit node in this chain, we only store the mapping for the "previous" node in the chain.
      onion.chainMap[digestArray[0]] = mapEntry;

      if (content.data.pubChainId)
        delete exitNodeMap[content.data.pubChainId];

      var pubChainId = cu.generateRandomInt32();
      while (exitNodeMap[pubChainId]) {
        pubChainId = cu.generateRandomInt32();
      }
      exitNodeMap[pubChainId] = mapEntry;
      content.data.pubChainId = pubChainId;

      // In order to acknowledge a successful chain build-up we return a build-command message, which contains the encrypted nonce signifying a successful build-up
      var iv = cu.generateNonce();
      content.data.chainNonce = ab2str(chainNonce);

      return cu.encryptAES(JSON.stringify(content.data), unwrappedKey, iv, message.commandName).then(function (encData) {
        return cu.hash(JSON.stringify({seqNum: 1, chainId: content.chainId, data: encData})).then(function(digest) {
          var command = {commandName: onion.commandNames.build, chainId: digestArray[1], iv: ab2str(iv), chainData: encData, checksum: digest};
          console.log("Exit node sending ack command: ", command);
          return webRTCConnection.send(command);
        });
      });
    }).catch(function (err) {
      console.log("Error at exit node", err);
      onion.sendError("Error handling data on exit node " + onion.localSocket.address + ":" + onion.localSocket.port,
        err, webRTCConnection, content.chainId, 1, onion.linkType.encrypt);
    });

  };

  public.message = function(message, node, webRTCConnection) {
    processMessage(message, node, webRTCConnection, function(data) {
      console.log("Received message through chain ", data);
      chunkMessage(data, node, webRTCConnection, message);
    });
  };

  function processMessage(message, node, webRTCConnection, successCallback) {
    var iv = str2ab(message.iv),
      decWorker = new Worker(onion.worker.decrypt);

    decWorker.postMessage({iv:iv, key:node.key, data:message.chainData, additionalData: message.commandName});

    decWorker.onmessage = function(workerMessage){
      if (workerMessage.data.success) {
        // handle the received message as exit node
        var msg = JSON.parse(workerMessage.data.data);
        console.log('exit node received msg chunk',msg);

        if (abEqual(str2ab(msg.nonce), node.nonce)) {
          handleChunks(JSON.parse(msg.content), successCallback);
        } else {
          console.warn('Dropped message - Received invalid nonce: ', msg.nonce, node.nonce);
          onion.sendError("Received invalid nonce", msg.nonce, webRTCConnection, node.chainIdOut, node.seqNumWrite, node.type);
        }
      } else {
        onion.sendError("Error while decrypting message at exit node", workerMessage.data.data, webRTCConnection, node.chainIdOut, node.seqNumWrite, node.type);
      }
    };
  }

  function handleChunks(msg, successCallback) {
    console.log('handle chunk: ',msg);
    if (msg.chunkCount > 1) {
      var msgBuf = messageBuffer[msg.id];
      if (!msgBuf) {
        msgBuf = {};
        messageBuffer[msg.id] = msgBuf;
        msgBuf.chunkCount = msg.chunkCount;
        msgBuf.buffer = new Array(msgBuf.chunkCount);
        msgBuf.curCount = 1;
        msgBuf.buffer[msg.chunkNumber] = msg.msg;
      } else {
        msgBuf.buffer[msg.chunkNumber] = msg.msg;
        if (++msgBuf.curCount === msgBuf.chunkCount) {
          msgBuf.buffer[msg.chunkNumber] = msg.msg;
          var assembledMsg = msgBuf.buffer.join('');
          successCallback(JSON.parse(assembledMsg));
        }
      }
    } else if (msg.chunkCount === 1 && successCallback) {
      successCallback(JSON.parse(msg.msg));
    }
  }

  function chunkMessage(content, node, webRTCConnection, messageObj) {
    var messageObject = null,
      message  = JSON.stringify(content),
      messageLength = message.length,
      chunkSize = window.stillepost.onion.interfaces.config.chunkSize,
      msgEncryptionOverheadBytes = 200;

    // take account of encryption overhead in comparison
    if (messageLength > chunkSize - msgEncryptionOverheadBytes) {
      var messageId = node.nextMessageId++,
        chunkCount = Math.ceil(messageLength / chunkSize);
      for (var i = 0; i < chunkCount; i++) {
        messageObject = { id: messageId, chunkNumber: i, chunkCount: chunkCount, msg: message.slice(i*chunkSize,chunkSize*i + chunkSize)};
        if(i === chunkCount - 1)
          messageObject.padding = cu.generateRandomBytes(chunkSize - (messageLength - i*chunkSize));
        encryptMessage(messageObject, node, webRTCConnection, messageObj);
      }
    } else {
      messageObject = { id: node.nextMessageId++, chunkNumber: 0, chunkCount: 1, msg: message, padding: ab2str(cu.generateRandomBytes(chunkSize-msgEncryptionOverheadBytes-messageLength))};
      encryptMessage(messageObject, node, webRTCConnection, messageObj);
    }
  }

  function encryptMessage(content, node, webRTCConnection, messageObj) {
    if (_activeWebWorkers > 25)
      setTimeout(wrapFunction(encryptMessage, this, [content, node, webRTCConnection, messageObj]), 2000);
    else {
      _activeWebWorkers++;
      var encryptionIV = cu.generateNonce(),
        encWorker = new Worker(onion.worker.encrypt);
      console.log("Forwarding message through chain ", node, content);
      encWorker.postMessage({iv: encryptionIV, key: node.key, data: JSON.stringify(content), additionalData: messageObj.commandName});
      encWorker.onmessage = function (workerMessage) {
        _activeWebWorkers--;
        onion.encWorkerListener(workerMessage, webRTCConnection, encryptionIV, node, messageObj);
      };
    }
  }

  public.forwardClientMessage = function(message, node, webRTCConnection) {
    chunkMessage(message.chainData, node, webRTCConnection, message);
  };

  public.clientMessage = function(message, node, webRTCConnection) {
    processMessage(message, node, webRTCConnection, function (data) {
      console.log('Decrypted client message data: ', data);
      // check if this node is the exit node of both chains
      if (data.socket.address === onion.localSocket.address && data.socket.port === onion.localSocket.port) {
        var pubEntry = exitNodeMap[data.chainId];
        if (pubEntry) {
          console.log('clientMessage: Found exitNodeMap entry', pubEntry);
          public.forwardClientMessage({commandName: message.commandName, chainData: data.message, chainId: data.chainId}, pubEntry, webRTCConnection);
        }
      } else {
        console.log('Sending clientMessage to remote exit Node');
        var con = webrtc.createConnection(data.socket.address, data.socket.port);
        con.send({commandName: message.commandName, chainData: data.message, chainId: data.chainId}).catch(function(err) {
          console.log('Could not connect to remote exit node');
          console.log(err)
        });
      }
    });
  };

  public.close = function(message, node) {
    var iv = str2ab(message.iv),
      decWorker = new Worker(onion.worker.decrypt);

    decWorker.postMessage({iv:iv, key:node.key, data:message.chainData, additionalData: message.commandName});

    decWorker.onmessage = function(workerMessage) {
      if (workerMessage.data.success) {
        var pubChainId = JSON.parse(workerMessage.data.data),
          encryptionIV = cu.generateNonce(),
          encWorker = new Worker(onion.worker.encrypt);

        console.log('Close chain at exit node - deleting entry with pubId '+pubChainId);
        delete exitNodeMap[pubChainId];

        encWorker.postMessage({iv:encryptionIV, key: node.key, data: 'closeAck', additionalData: message.commandName});
        encWorker.onmessage = function(workerMessage) {
          onion.encWorkerListener(workerMessage, null, encryptionIV, node, message);
        };
      }
    };
  };

  public.aajax = function(message, node, webRTCConnection) {
    processMessage(message, node, webRTCConnection, function (decryptedRequest) {

      decryptedRequest.success = function(data, textStatus, jqXHR) {
        console.log('ajax success called with status '+textStatus, data);
        var parsedData = typeof data === 'string' ? data : ab2str(new Uint8Array(data));
        chunkMessage({id: decryptedRequest.id, data: parsedData, textStatus: textStatus, success:true},
          node, webRTCConnection, message);
      };

      decryptedRequest.error = function(jqXHR, textStatus, errorThrown) {
        console.log('ajax error called with status '+textStatus, errorThrown);

        chunkMessage({id: decryptedRequest.id, errorThrown: errorThrown, textStatus: textStatus,
          success:false}, node, webRTCConnection, message);
      };

      $.ajax(decryptedRequest);
    });
  };

  public.exitNodeMap = exitNodeMap;

  return public;
})();
