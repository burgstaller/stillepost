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

  // interface function to create a connection to a remote client by connecting two chains
  // returns a connection object
  public.createClientConnection = function (address, port, chainId, pubKey) {
    if (!(address && port && chainId && pubKey && onion.getPublicChainInformation().chainId))
      return null;
    var connectionId = cu.generateRandomInt32(),
      aesKey = null,
      initPromise = cu.generateAESKey().then(function (key) {
        aesKey = key;
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
    }, 7000);

    var clientConnection = {
      initialized: false,
      send: function (message) {
        return answerPromise.then(function () {
          var iv = cu.generateNonce();
          return cu.encryptAES(JSON.stringify(message), aesKey, iv).then(function (encData) {
            var msg = {
              message: {data: encData, connectionId: connectionId, iv: iv},
              chainId: chainId,
              socket: {address: address, port: port}
            };
            return onion.sendMessage("clientMessage", msg);
          });
        }).catch(function (err) {
          console.log('Error while sending message: ', err);
          clientConnection.onerror(err);
        });
      },
      onerror: function (err) {
        console.log('Error in client connection', err);
      },

      onmessage: function (message) {
        console.log('onmessage: ', message);
      },
      // event callback, which is called upon receiving the answer from the other client. It is expected that this callback is overwritten
      // by the caller of the createClientConnection function
      processMessage: function (messageObj) {
        cu.decryptAES(messageObj.data, aesKey, objToAb(messageObj.iv)).then(function (decData) {
          var jsonData = JSON.parse(decData);
          if (clientConnection.initialized) {
            clientConnection.onmessage(jsonData);
          }
          else if (jsonData.chainConnectionId === connectionId) {
            clientConnection.initialized = true;
            resolveProm();
          }
          else
            rejectProm("Received invalid initialization response from other client");

        }).catch(function (err) {
          clientConnection.onerror(err);
        });
      }
    };
    clientConnection.aesKey = aesKey;
    clientConnections[connectionId] = clientConnection;
    return clientConnection;
  };

  public.processClientMessage = function(decData) {
    console.log("decrypted data: ", decData);
    var jsonData = JSON.parse(decData);
    var clientCon = clientConnections[jsonData.connectionId];
    // received response from other client
    if (clientCon) {
      console.log('received response from client: ',jsonData);
      clientCon.processMessage(jsonData);
    }
    // received initial message from other client
    else {
      console.log('received message from another client',jsonData);

      cu.unwrapAESKey(jsonData.keyData, _clientConPrivateKey).then(function(key) {
        return cu.decryptAES(jsonData.data, key, objToAb(jsonData.iv)).then(function(decryptedMessage) {
          var decMsgJson = JSON.parse(decryptedMessage);
          var connection = {
            send: function(messageContent) {
              var iv = cu.generateNonce();

              cu.encryptAES(JSON.stringify(messageContent), connection.aesKey, iv).then(function(encData) {
                var msg = {message: {data: encData, connectionId: decMsgJson.connectionId, iv: iv}, chainId: decMsgJson.chainId, socket: decMsgJson.socket};
                onion.sendMessage('clientMessage', msg);
              });

            },
            onmessage: function(message) {
              console.log('onmessage: ',message);
            },
            onerror: function(err) {
              console.log('Error in client connection',err);
            },
            processMessage: function(messageObj) {
              cu.decryptAES(messageObj.data, connection.aesKey, objToAb(messageObj.iv)).then(function(decData) {
                connection.onmessage(JSON.parse(decData));
              }).catch(function(err) {
                connection.onerror(err);
              });
            }
          };
          connection.aesKey = key;
          connection.publicKey = decMsgJson.publicKey;
          clientConnections[decMsgJson.connectionId] = connection;
          connection.send({chainConnectionId: decMsgJson.connectionId});
          window.stillepost.onion.interfaces.onClientConnection(connection);
        });
      }).catch(function(err) {
        console.log('Received client connection with invalid key',err);
      });
    }
  };

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
