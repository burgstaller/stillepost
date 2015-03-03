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
    closed: 'closed'
  };

  // interface function to create a connection to a remote client by connecting two chains
  // returns a connection object
  public.createClientConnection = function (address, port, chainId, pubKey) {
    if (!(address && port && chainId && pubKey && onion.getPublicChainInformation().chainId))
      throw 'Invalid parameters in createClientConnection';
    var connectionId = cu.generateNonce(),
      clientConnection = createConnectionObj(chainId, {address: address, port: port}, connectionId, null, pubKey, connectionState.init),

      initPromise = cu.generateAESKey().then(function (key) {
        clientConnection.aesKey = key;
        return cu.wrapAESKey(key, JSON.parse(pubKey)).then(function (wrappedKey) {
          var iv = cu.generateNonce(),
            pubInfo = onion.getPublicChainInformation(),
            dataToEncrypt = {
              connectionId: connectionId,
              chainId: pubInfo.chainId,
              socket: pubInfo.socket,
              publicKey: _clientConPublicKey
            };
          return cu.encryptAES(JSON.stringify(dataToEncrypt), key, iv).then(function (encData) {
            var initMessage = {
              message: {data: encData, keyData: wrappedKey, iv: iv},
              chainId: chainId,
              socket: {address: address, port: port}
            };
            return onion.sendMessage("clientMessage", initMessage);
          });
        });
      });

    // Promise which resolves when a successful response is received from the remote client, otherwise the promise is rejected
    var resolveProm,rejectProm,
      answerPromise = initPromise.then(function() {
        return new Promise(function(resolve, reject) {
          resolveProm = resolve;
          rejectProm = reject;
        });
      });
    // Setting timeout for connection establishment
    setTimeout(function() {
      rejectProm("Connection could not be established: Timeout");
    }, 10000);

    clientConnection.send = function (message) {
      return answerPromise.then(function () {
        return sendClientMessage(message, clientConnection);
      }).catch(function (err) {
        console.log('Error while sending message: ', err);
        clientConnection.onerror(err);
      });
    };
      // event callback, which is called upon receiving the answer from the other client. It is expected that this callback is overwritten
      // by the caller of the createClientConnection function
    clientConnection.processMessage = function (messageObj) {
      cu.decryptAES(messageObj.data, clientConnection.aesKey, objToAb(messageObj.iv), messageObj.connectionData).then(function (decData) {
        var jsonData = JSON.parse(decData);

        // if connection already initialized - trigger onmessage
        if (handleConnectionStateUpdate(clientConnection, jsonData).connectionState === connectionState.ready) {
          clientConnection.onmessage(jsonData);
        }
        // check if init successful
        else if (jsonData.connectionState === connectionState.ready && JSON.stringify(jsonData.chainConnectionId) === JSON.stringify(clientConnection.connectionId)) {
          clientConnection.connectionState = connectionState.ready;
          resolveProm();
        } else {
          var errorMsg = jsonData.errorMessage ? jsonData.errorMessage : "Unknown error";
          rejectProm(errorMsg);
        }
      }).catch(function (err) {
        clientConnection.onerror(err);
      });
    };
    clientConnections[ab2str32(connectionId)] = clientConnection;
    return clientConnection;
  };

  function createConnectionObj(chainId, socket, connectionId, aesKey, publicKey, connectionStateValue) {
    var connection =  {
      seqNum: 1,
      chainId: chainId,
      socket: socket,
      connectionId: connectionId,
      aesKey: aesKey,
      publicKey: publicKey,
      connectionState: connectionStateValue,
      send: function (messageContent) {
        return sendClientMessage(messageContent, connection);
      },
      onerror: function (err) { console.log('Error in client connection', err); },
      onmessage: function (message) { console.log('onmessage: ', message); },
      onclose: function() { console.log('connection onclose triggered')},
      processMessage: function (messageObj) {
        cu.decryptAES(messageObj.data, connection.aesKey, objToAb(messageObj.iv), messageObj.connectionData).then(function(decData) {
          var jsonData = JSON.parse(decData);
          if (handleConnectionStateUpdate(connection, jsonData).connectionState === connectionState.ready) {
            connection.onmessage(jsonData);
          }
        }).catch(function (err) {
          connection.onerror(err);
        });
      },
      close: function() { closeConnection(connection);}
    };
    return connection;
  }

  function handleConnectionStateUpdate(connection, message) {
    // check if remote client closed the connection
    if (message.connectionState === connectionState.closed) {
      connection.connectionState = connectionState.closed;
      delete clientConnections[ab2str32(connection.connectionId)];
      connection.onclose();
    }

    return connection;
  }

  public.processClientMessage = function(decChainData) {
    console.log("decrypted data: ", decChainData);
    var jsonData = JSON.parse(decChainData);

    // Check if message is initial message - if not, decrypt connectionData
    if (jsonData.connectionData) {
      console.log('received message from existing connection to remote client - trying to decrypt connectionData',jsonData);
      return cu.decryptRSA(jsonData.connectionData, _clientConPrivateKey).then(function(decConnectionData) {
        var jsonConnectionData = JSON.parse(decConnectionData),
          clientCon = clientConnections[ab2str32(jsonConnectionData.connectionId)];
        // received response from other client
        if (clientCon) {
          console.log('received response from client: ',jsonData);
          clientCon.processMessage(jsonData);
        }
      });
    } else {
      // received initial message from other client
      console.log('received initial message from remote client',jsonData);

      cu.unwrapAESKey(jsonData.keyData, _clientConPrivateKey).then(function(key) {
        return cu.decryptAES(jsonData.data, key, objToAb(jsonData.iv)).then(function(decryptedMessage) {
          var decMsgJson = JSON.parse(decryptedMessage),
            connection = createConnectionObj(decMsgJson.chainId, decMsgJson.socket, objToAb(decMsgJson.connectionId), key,
              decMsgJson.publicKey, connectionState.ready),

          // connection with this id already exists - return error
          con = clientConnections[ab2str32(connection.connectionId)];
          if (con) {
            connection.send({connectionState: 'error', errorMessage: 'ConnectionId already used'});
          } else {
            clientConnections[ab2str32(connection.connectionId)] = connection;
            // sending ack-message to init request
            connection.send({connectionState: connectionState.ready, chainConnectionId: connection.connectionId});
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
      delete clientConnections[ab2str32(connection.connectionId)];
      connection.onclose();
    });
  }

  function sendClientMessage(messageContent, connection) {
    if (connection.connectionState === connectionState.ready) {
      var iv = cu.generateNonce();
      return cu.encryptRSA(JSON.stringify({connectionId: connection.connectionId, seqNum: connection.seqNum++}), connection.publicKey).then(function (encConnectionData) {
        return cu.encryptAES(JSON.stringify(messageContent), connection.aesKey, iv, encConnectionData).then(function (encData) {
          var msg = {message: {data: encData, connectionData: encConnectionData, iv: iv}, chainId: connection.chainId, socket: connection.socket};
          return onion.sendMessage('clientMessage', msg);
        });
      });
    } else {
      throw Error('Connection not in ready state. Current State: '+connection.connectionState);
    }
  }

  public.onClientConnection = function(connection) {
    console.log('onclientMessage called with connection: ', connection);
    connection.onmessage = function(message) {
      console.log('overwritten onmessage: ',message);
      connection.send({originalMessage: message, type:'echo'});
    }
  };

  public.setupClientConnections = function(keyPair) {
    _clientConPrivateKey = keyPair.privateKey;
    _clientConPublicKey = keyPair.publicKey;
  };

  return public;
})();
