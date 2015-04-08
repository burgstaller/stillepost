window.stillepost = window.stillepost || {};
window.stillepost.onion = window.stillepost.onion || {};

// object containing all exit node logic
window.stillepost.onion.exitNode = (function() {
  var public = {},

  // map of h(chainId || seqNum) -> pubChainId
  exitNodeMap = {},
  messageBuffer = {},
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
        seqNumRead: 1, seqNumWrite: 2, type: onion.linkType.exit, nonce: chainNonce};

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
      var encryptionIV = cu.generateNonce(),
        encWorker = new Worker(onion.worker.encrypt);
      console.log("Received message through chain ", data);

      encWorker.postMessage({iv:encryptionIV, key: node.key, data: JSON.stringify(data), additionalData: message.commandName});
      encWorker.onmessage = function(workerMessage) {
        onion.encWorkerListener(workerMessage, webRTCConnection, encryptionIV, node, message);
      };
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
    // messageObject = { chunkNumber: ++i, chunkCount: chunkCount, msg: message.slice(i*chunkSize,chunkSize*i + chunkSize)};
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

  public.forwardClientMessage = function(message, node, webRTCConnection) {
    var encryptionIV = cu.generateNonce(),
      encWorker = new Worker(onion.worker.encrypt);
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
        var encryptionIV = cu.generateNonce(),
          encWorker = new Worker(onion.worker.encrypt),
          parsedData = typeof data === 'string' ? data : ab2str(new Uint8Array(data));
        encWorker.postMessage({iv:encryptionIV, key: node.key, data: JSON.stringify({id: decryptedRequest.id, data: parsedData, textStatus: textStatus, success:true}), additionalData: message.commandName});
        encWorker.onmessage = function(workerMessage) {
          onion.encWorkerListener(workerMessage, webRTCConnection, encryptionIV, node, message);
        };
      };

      decryptedRequest.error = function(jqXHR, textStatus, errorThrown) {
        console.log('ajax error called with status '+textStatus, errorThrown);
        var encryptionIV = cu.generateNonce(),
          encWorker = new Worker(onion.worker.encrypt);

        encWorker.postMessage({iv:encryptionIV, key: node.key, data: JSON.stringify({id: decryptedRequest.id, errorThrown: errorThrown, textStatus: textStatus,
          success:false}), additionalData: message.commandName});
        encWorker.onmessage = function(workerMessage) {
          onion.encWorkerListener(workerMessage, webRTCConnection, encryptionIV, node, message);
        };
      };

      $.ajax(decryptedRequest);
    });
  };

  public.exitNodeMap = exitNodeMap;

  return public;
})();
