window.stillepost = window.stillepost || {};
window.stillepost.onion = window.stillepost.onion || {};

// object containing all exit node logic
window.stillepost.onion.clientConnection = (function() {
  var public = {},

  _clientConPublicKey = null,
  _clientConPrivateKey = null,

  clientConnections = {},
  onion = window.stillepost.onion.onionRouting,
  cu = window.stillepost.cryptoUtils;

  public.init = function() {
    onion = window.stillepost.onion.onionRouting;
    cu = window.stillepost.cryptoUtils;
  };

  var connectionState = {
    ready: 'ready',
    init: 'init',
    closed: 'closed',
    renew: 'renew'
  },

  messageTypes = {
    msg: 'msg',
    ack: 'ack'
  };

  // interface function to create a connection to a remote client by connecting two chains
  // returns a connection object
  public.createClientConnection = function (address, port, chainId, pubKey, isOrderedAndReliable) {
    if (!(address && port && chainId && pubKey))
      throw 'Invalid parameters in createClientConnection';
    var connectionId = cu.generateNonce(),
      clientConnection = createConnectionObj(chainId, {address: address, port: port}, connectionId, null, pubKey, connectionState.init, isOrderedAndReliable),

      initPromise = cu.generateAESKey().then(function (key) {
        clientConnection.aesKey = key;
        return cu.wrapAESKey(key, JSON.parse(pubKey)).then(function (wrappedKey) {
          var iv = cu.generateNonce(),
            pubInfo = onion.getPublicChainInformation(),
            dataToEncrypt = {
              connectionId: ab2str(connectionId),
              chainId: pubInfo.chainId,
              socket: pubInfo.socket,
              publicKey: _clientConPublicKey,
              isOrderedAndReliable: isOrderedAndReliable
            };
          return cu.encryptAES(JSON.stringify(dataToEncrypt), key, iv).then(function (encData) {
            var initMessage = {
              message: {data: encData, keyData: wrappedKey, iv: ab2str(iv)},
              chainId: chainId,
              socket: {address: address, port: port}
            };
            return onion.sendMessage(onion.commandNames.clientMessage, initMessage);
          });
        });
      });

    // Promise which resolves when a successful response is received from the remote client, otherwise the promise is rejected
    var resolveProm,rejectProm,
      answerPromise = onion.createChain().then(function() {
        return initPromise.then(function() {
          return new Promise(function(resolve, reject) {
            resolveProm = resolve;
            rejectProm = reject;
          });
        });
      });
    // Setting timeout for connection establishment
    setTimeout(function() {
      rejectProm("Connection could not be established: Timeout");
    }, stillepost.onion.interfaces.config.clientMessageInitTimeout);

    clientConnection.send = function (message, successCallback, errorCallback) {
      return answerPromise.then(function () {
        return sendClientMessage(message, clientConnection, successCallback, errorCallback);
      }).catch(function (err) {
        console.log('Error while sending message: ', err);
        clientConnection.onerror(err);
      });
    };
    // event callback, which is called upon receiving the answer from the other client. It is expected that this callback is overwritten
    // by the caller of the createClientConnection function
    clientConnection.processMessage = function (messageObj, seqNum) {
      cu.decryptAES(messageObj.data, clientConnection.aesKey, str2ab(messageObj.iv), messageObj.connectionData).then(function (decData) {
        var messageData = JSON.parse(decData),
          jsonData = messageData.content;
        console.log('Decrypted client message: ',jsonData);

        if (clientConnection.connectionState === connectionState.init)
        {
          console.log('Check initialize client connection with data ', jsonData.chainConnectionId, ab2str(clientConnection.connectionId));
          // check if init successful
          if (jsonData.connectionState === connectionState.ready && jsonData.chainConnectionId === ab2str(clientConnection.connectionId)) {
            console.log('ClientMessage init successful');
            clientConnection.connectionState = connectionState.ready;
            clientConnection.connectionNonce = str2ab(messageData.connectionNonce);
            resolveProm();
          } else {
            console.log('Failed to initialize client connection with data ', jsonData.chainConnectionId, ab2str(clientConnection.connectionId));
            rejectProm('Failed to initialize client connection');
          }
        }

        // if connection already initialized
        handleClientMessage(clientConnection, jsonData, seqNum);
      }).catch(function (err) {
        clientConnection.onerror(err);
      });
    };
    clientConnections[ab2str(connectionId)] = clientConnection;
    return clientConnection;
  };

  function handleClientMessage(connection, message, seqNum) {
    // check if remote client closed the connection
    if (message.connectionState === connectionState.closed) {
      connection.connectionState = connectionState.closed;
      delete clientConnections[ab2str(connection.connectionId)];
      connection.onclose();
    }
    // check if remote chain was rebuild - update pubInfo of remote client in this case
    else if (message.connectionState === connectionState.renew) {
      console.log('received renew message with parameters: ',connection, message, seqNum);
      connection.chainId = message.pubInfo.chainId;
      connection.socket = message.pubInfo.socket;
      sendAckMessage(connection, seqNum);
      if (connection.curReceiverSeqNum === seqNum)
        connection.curReceiverSeqNum++;
    }
    else if (connection.isOrderedAndReliable) {
      sendAckMessage(connection, seqNum);
      handleOrderedReception(connection, seqNum, message);
    }
    else
      connection.onmessage(message);
  }

  function handleOrderedReception(connection, seqNum, message) {
    connection.receiveBuffer[seqNum] = message;
    while(connection.curReceiverSeqNum === seqNum && connection.receiveBuffer[seqNum]) {
      connection.onmessage(connection.receiveBuffer[seqNum]);
      delete connection.receiveBuffer[seqNum];
      connection.curReceiverSeqNum++;
      seqNum++;
    }
  }

  function createConnectionObj(chainId, socket, connectionId, aesKey, publicKey, connectionStateValue, isOrderedAndReliable) {
    var connection =  {
      seqNum: 1,
      curReceiverSeqNum: 1,
      chainId: chainId,
      socket: socket,
      connectionId: connectionId,
      aesKey: aesKey,
      publicKey: publicKey,
      connectionState: connectionStateValue,
      sendBuffer: {},
      receiveBuffer: {},
      isOrderedAndReliable: isOrderedAndReliable || false,
      send: function (messageContent, successCallback, errorCallback) {
        return sendClientMessage(messageContent, connection, successCallback, errorCallback);
      },
      onerror: function (err) { console.log('Error in client connection', err); },
      onmessage: function (message) { console.log('onmessage: ', message); },
      onclose: function() { console.log('connection onclose triggered')},
      processMessage: function (messageObj, seqNum) {
        cu.decryptAES(messageObj.data, connection.aesKey, str2ab(messageObj.iv), messageObj.connectionData).then(function(decData) {
          var jsonData = JSON.parse(decData);
          if (abEqual(str2ab(jsonData.connectionNonce), connection.connectionNonce))
            handleClientMessage(connection, jsonData.content, seqNum);
          else {
            var errorMsg = 'Received invalid nonce';
            console.warn(errorMsg, jsonData.connectionNonce, connection.connectionNonce);
            connection.error(errorMsg)
          }
        }).catch(function (err) {
          connection.onerror(err);
        });
      },
      close: function() { closeConnection(connection);}
    };
    return connection;
  }

  function handleAckMessage(connection, seqNum) {
    var messageObject = connection.sendBuffer[seqNum];
    if (messageObject) {
      if (messageObject.success)
        messageObject.success();
      delete connection.sendBuffer[seqNum];
    }
  }

  public.processClientMessage = function(decChainData) {
    console.log("decrypted data: ", decChainData);
    var jsonData = decChainData;

    // Check if message is initial message - if not, decrypt connectionData
    if (jsonData.connectionData) {
      console.log('received message from existing connection to remote client - trying to decrypt connectionData',jsonData);
      return cu.decryptRSA(jsonData.connectionData, _clientConPrivateKey).then(function(decConnectionData) {
        var jsonConnectionData = JSON.parse(decConnectionData),
          clientCon = clientConnections[jsonConnectionData.connectionId];
        // received response from other client
        if (clientCon) {
          console.log('received response from client: ',jsonConnectionData);

          if (jsonConnectionData.type === messageTypes.ack && clientCon.isOrderedAndReliable) {
            handleAckMessage(clientCon, jsonConnectionData.seqNum);
          } else
            clientCon.processMessage(jsonData, jsonConnectionData.seqNum);
        }
      });
    } else {
      // received initial message from other client
      console.log('received initial message from remote client',jsonData);

      cu.unwrapAESKey(jsonData.keyData, _clientConPrivateKey).then(function(key) {
        return cu.decryptAES(jsonData.data, key, str2ab(jsonData.iv)).then(function(decryptedMessage) {
          var decMsgJson = JSON.parse(decryptedMessage),
            connection = createConnectionObj(decMsgJson.chainId, decMsgJson.socket, str2ab(decMsgJson.connectionId), key,
              decMsgJson.publicKey, connectionState.ready, decMsgJson.isOrderedAndReliable),

          // connection with this id already exists - return error
          con = clientConnections[decMsgJson.connectionId];
          console.log('decrypted initial message: ',decMsgJson);
          if (con) {
            sendEncryptedMessage({connectionState: onion.commandNames.error, errorMessage: 'ConnectionId already used'}, connection);
          } else {
            clientConnections[decMsgJson.connectionId] = connection;
            // sending ack-message to init request
            var connectionNonce = cu.generateNonce(),
              ackMsg = {connectionState: connectionState.ready, chainConnectionId: decMsgJson.connectionId, connectionNonce: ab2str(connectionNonce)};
            connection.connectionNonce = connectionNonce;
            console.log('Sending ack message to init request ', ackMsg);
            sendEncryptedMessage(ackMsg, connection);
            window.stillepost.onion.interfaces.onClientConnection(connection);
          }
        }, function(err) {
          console.log('Error while decrypting AES key',err);
        });
      }).catch(function(err) {
        console.log('Error while processing client connection',err);
      });
    }

  };

  function closeConnection(connection) {
    connection.send({connectionState: connectionState.closed}).then(function() {
      connection.connectionState = connectionState.closed;
      delete clientConnections[ab2str(connection.connectionId)];
      connection.onclose();
    });
  }

  function handleClientMessageTimeout(connection, seqNum) {
    var msg = connection.sendBuffer[seqNum];
    // no ack message was received previously
    if (msg) {
      if (++msg.count <= stillepost.onion.interfaces.config.maxRetransmissionCount) {
        // retransmit message
        sendClientMessage(msg.message, connection, msg.success, msg.error, seqNum);
      } else {
        if (msg.error)
          msg.error(Error('Could not transfer message - Maximum amount of retransmission reached'));
        for (var key in connection.sendBuffer) {
          if (connection.sendBuffer.hasOwnProperty(key) && key > seqNum) {
            var curMsg = connection.sendBuffer[key];
            if (curMsg.error)
              curMsg.error();
          }
        }
        connection.sendBuffer = null;
        connection.receiveBuffer = null;
        connection.connectionState = connectionState.closed;
        delete clientConnections[ab2str(connection.connectionId)];
      }
    }
  }

  function sendClientMessage(messageContent, connection, successCallback, errorCallback, sequenceNumber) {
    if (connection.connectionState === connectionState.ready) {
      var seqNum = sequenceNumber;
      if (connection.isOrderedAndReliable) {
        if (!sequenceNumber) {
          seqNum = connection.seqNum++;
          connection.sendBuffer[seqNum] = {
            message: messageContent,
            success: successCallback,
            error: errorCallback,
            count: 0
          };
        }

        setTimeout(wrapFunction(handleClientMessageTimeout, this, [connection, seqNum]), stillepost.onion.interfaces.config.clientMessageTimeout);
      } else
        seqNum = connection.seqNum++;

      sendEncryptedMessage(messageContent, connection, seqNum);
    } else {
      connection.onerror('Connection not in ready state. Current State: '+connection.connectionState);
    }
  }

  function sendAckMessage(connection, seqNum) {
    if (connection.connectionState === connectionState.ready) {
      return cu.encryptRSA(JSON.stringify({
        connectionId: ab2str(connection.connectionId),
        seqNum: seqNum,
        type: messageTypes.ack
      }), connection.publicKey).then(function (encConnectionData) {

        var dataLength = Math.random()*195 + 5,
          iv = cu.generateNonce();
        var msg = {message: {data: ab2str(cu.generateRandomBytes(dataLength)), connectionData: encConnectionData, iv: ab2str(iv)}, chainId: connection.chainId, socket: connection.socket};
        return onion.sendMessage(onion.commandNames.clientMessage, msg);
      });
    }
  }

  function sendEncryptedMessage(messageContent, connection, seqNum) {
    if (connection.connectionState === connectionState.ready) {
      var iv = cu.generateNonce();
      return cu.encryptRSA(JSON.stringify({connectionId: ab2str(connection.connectionId), seqNum: seqNum, type: messageTypes.msg}), connection.publicKey).then(function (encConnectionData) {
        return cu.encryptAES(JSON.stringify({content: messageContent, connectionNonce: ab2str(connection.connectionNonce)}), connection.aesKey, iv, encConnectionData).then(function (encData) {
          var msg = {message: {data: encData, connectionData: encConnectionData, iv: ab2str(iv)}, chainId: connection.chainId, socket: connection.socket};
          return onion.sendMessage(onion.commandNames.clientMessage, msg);
        });
      });
    }
    else {
      connection.onerror('Connection not in ready state. Current State: '+connection.connectionState);
    }
  }

  public.onRenewChain = function(pubInfo) {
    for (var connectionId in clientConnections) {
      if (clientConnections.hasOwnProperty(connectionId)) {
        var connection = clientConnections[connectionId];
        console.log('sending renew chain message with pubInfo ', connection, pubInfo);

        var seqNum = connection.seqNum++,
          msgContent = {connectionState: connectionState.renew, pubInfo: pubInfo};
        connection.sendBuffer[seqNum] = {
          message: msgContent,
          count: 0
        };
        setTimeout(wrapFunction(handleClientMessageTimeout, this, [connection, seqNum]), stillepost.onion.interfaces.config.clientMessageTimeout);
        sendEncryptedMessage(msgContent, connection, seqNum);
      }
    }
  };

  public.onClientConnection = function(connection) {
    console.log('onclientMessage called with connection: ', connection);
    connection.onmessage = function(message) {
      console.log('overwritten onmessage: ',message);
    }
  };

  public.setupClientConnections = function(keyPair) {
    _clientConPrivateKey = keyPair.privateKey;
    _clientConPublicKey = keyPair.publicKey;
  };

  return public;
})();
