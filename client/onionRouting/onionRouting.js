window.stillepost = window.stillepost || {};
window.stillepost.onion = window.stillepost.onion || {};
window.stillepost.onion.onionRouting = (function() {
  var public = {},
    cu = window.stillepost.cryptoUtils,
    webrtc = window.stillepost.webrtc,
    intermediateNode = window.stillepost.onion.intermediateNode,
    exitNode = window.stillepost.onion.exitNode,
    clientConnection = window.stillepost.onion.clientConnection,
    chainSize = 3,
    _masterChainCreated = null,
    _masterChainError = null,
    _isMasterChainCreated = false,
    _createChainPromise = null,
    _uuid = null,
    // current amount of tries to connect to the directory server
    _curDirectoryTryCount = 0,
    // current amount of tries to create a chain
    _curCreateChainTryCount = 0,
    _localSocket = {},
    _heartBeat = null,

  //Id of the chain in which this node is the master
  chainIdMaster = null,
  masterSeqNumRead = 1,
  masterSeqNumWrite = 1,
  masterHash = null,

  //sym keys of all nodes of the chain in which this node is the master
  masterChain = null,

  //map of all node-neighbours with socket and key info
  // a chain consists of following information:
  //  - node socket ... the socket of the next node in the chain,
  //  - AES-Key ... the key with which data is en- and decrypted (shared with the creator of the chain),
  //  - chainId .. the chainId for the next node in the chain. On receiving the message, the next node needs this chainId in order to be able to get the chain information.
  chainMap = {},

  // This nonce is contained in the build message in order to check successful chain build-up. The client sends this nonce to the exit node,
  // which then returns it to the client (both ways are of course encrypted in layers). The client then verifies the nonce in the received message with this nonce
  _masterChainNonce = null,
  _entryNodeSocket = null,
  _exitNodeSocket = null,
  _pubChainId = null,
  _chainNonce = null,
  _nextMessageId = 0,
  _messageBuffer = {},

  // Different error types passed to onerror event
  errorTypes = {
    // Critical error. Onion chain could not be established. Automatic recovery has failed.
    chainError: 'chainError',
    // All error types below are recovered automatically, if possible. If automatic recovery fails, a 'chainError' will be triggered.
    // Error while building the chain.
    buildError: 'buildError',
    // Error while processing a message.
    messageError: 'messageError',
    // A node in the chain is no longer available.
    nodeError: 'nodeError'
  },

  // Different notification types passed to onnotification event
  notificationTypes =  {
    // renew notification - triggered each time after the nodes' chain was successfully rebuild
    renew: 'renew'
  },

  // CommandNames are used to differ between types of messages.
  commandNames = {
    build: 'build',
    aajax: 'aajax',
    clientMessage: 'clientMessage',
    error: 'error',
    close: 'close'
  },

  // Node types are used in the chainMap and chainIdHash. They allow to differ between the different link directions:
  // encrypt => exit node to master node direction (message is encrypted)
  // decrypt => master node to exit node direction (message is decrypted - outermost layer of onion message is peeled)
  // exit => exit node requires special logic
  linkType = {
    encrypt: 'encrypt',
    decrypt: 'decrypt',
    exit: 'exit',

    // Since the link direction is concatenated to the chainId hash, the exit node linkType needs special consideration.
    getLinkTypeEncryptDefault: function(mode) {
      if (!mode || mode === linkType.exit)
        return linkType.encrypt;
      return mode;
    },
    getLinkTypeDecryptDefault: function(mode) {
      if (!mode || mode === linkType.exit)
        return linkType.decrypt;
      return mode;
    }
  },

  // Paths to the worker files
  worker = {
    encrypt: 'onionRouting/encryptionWorker.js',
    decrypt: 'onionRouting/decryptionWorker.js'
  },

  aajaxMap = {
    curId: 0,
    map: {},
    pop: function(id) {
      var obj = this.map[id];
      delete this.map[id];
      return obj;
    },
    put: function(data) {
      var id = this.curId++;
      this.map[id] = data;
      return id;
    }
  },

  /**
   *  Generate RSA keypair and send public key to directory server.
   *  This function needs to be called initially.
   *  The message to the directory server contains:
   *    - Address, Port ... our local public socket information
   *    - Public key ... the generated public key, which is valid for the current session
   */
   initOnionSetup = function() {
    cu.getGeneratedPublicKey().then(function(pubKey) {
      logToConsole("Generated pubKey: "+pubKey);
      // webrtc.connected is a Promise which is resolved upon successfully establishing a connection to the websocket server.
      // The Promise passes information about our local public socket, which we send along with the public key to the directory-server.
      webrtc.connected.then(function(local)
      {
        var entry = {address: local.address, port: local.port};
        _localSocket.address = entry.address;
        _localSocket.port = entry.port;
        entry.key = pubKey;
        var registerAtDirectory = function()
        {
          logToConsole("Registering at directory server as ", entry);
          var xhr = new XMLHttpRequest();
          xhr.onload = function () {
            var response = JSON.parse(this.responseText);
            logToConsole("Directory server responded register request with: ", response);
            if (response.msg === "OK") {
              _uuid = response.data;
              logToConsole("Successfully registered at directory server with uuid " + response.data);
              _heartBeat = setInterval(sendHeartbeat, stillepost.interfaces.config.heartbeatInterval);
              document.dispatchEvent(new CustomEvent("chainReady"));
            } else
              public.onerror(errorTypes.chainError, {message: "Directory-Server did not respond with OK while registering, but with: "+response.msg})
          };
          xhr.onerror = function (e) {
            logToConsole("Try: " + (++_curDirectoryTryCount) + ": Failed to register at directory server", e.target);
            if (_curDirectoryTryCount < stillepost.interfaces.config.maxDirectoryTryCount)
              registerAtDirectory();
            else
              public.onerror(errorTypes.chainError, {message: 'Could not connect to directory server', error: e.target});
          };
          xhr.open("post", stillepost.interfaces.config.directoryServerUrl + "/node", true);
          xhr.send(JSON.stringify(entry));
        };
        registerAtDirectory();
      });

    }).catch(function(err) {
      public.onerror(errorTypes.chainError, {message: 'Error generating public RSA Key', error: err});
    });
  },

  sendHeartbeat = function(){
      var xhr = new XMLHttpRequest();
      xhr.onload = function () {
          var response = JSON.parse(this.responseText);
          logToConsole("onion: sendHeartbeat SUCCESS");
      };
      xhr.onerror = function(e) {
          public.onerror(errorTypes.chainError, {message: 'Directory server sendHeartbeat FAILURE', error: e.target})
      };
      xhr.open("put", stillepost.interfaces.config.directoryServerUrl + "/node/" + _uuid, true);
      xhr.send();
  },

  /**
   *  Choose a set of nodes in the given nodeList at random. This function is used to select random chain nodes.
   *  The amount of selected nodes is specified by the chainSize member.
   * @param nodeList ... the nodeList retrieved from the directory-server
   * @returns {Array} ... the selected nodes
   */
  chooseNodes = function(nodeList) {
    var nodes = [],
      indexArray = [],
      len = nodeList.length-1;
    if (len < chainSize) {
      throw "Retrieved node count less than the required chainSize";
    }
    while(nodes.length < chainSize) {
      var index = parseInt(Math.random() * (len+1)), found = false;
      // we need to make sure, that we dsend a message to a on't select oneself as a node
      if (nodeList[index].socket.address !== _localSocket.address || nodeList[index].socket.port !== _localSocket.port) {
        // Since we need to ensure, that we select a specific node only once, we store already selected nodes in an array
        // and each time check, if the random node was already selected (== is in the array).
        for (var i=0; i < indexArray.length; i++) {
          if (indexArray[i] === index) {
            found = true;
            break;
          }
        }
        if (!found) {
          indexArray.push(index);
          nodes.push(nodeList[index]);
        }
      }
    }
    return nodes;
  },

  /**
   * This function requests list of nodes from the directory-server and chooses a set of chain nodes at random
   * (Amount of selected nodes according to chainSize member).
   * @returns {Promise} .. the Promise, which is resolved after node selection (selected list of node is passed as parameter).
   */
  retrieveNodes = function() {
    return new Promise(function(resolve,reject) {
      var xhr = new XMLHttpRequest();
      xhr.onload = function () {
        var msg = JSON.parse(this.responseText);
        if (msg.msg === "OK") {
          var nodeList = msg.data;
          logToConsole("Received nodelist of length: "+nodeList.length);
          logToConsole(nodeList);
          try {
            nodeList = chooseNodes(nodeList);
            resolve(nodeList);
          } catch(e) {
            reject(e);
          }
        } else {
          reject("Directory-Server did not respond with OK while retrieving nodes, but with: "+msg.msg);
        }
      };
      xhr.onerror = function(e) {
        var errorMsg = e.target.statusText ? e.target.statusText : "Failed to load nodes from directory server";
        reject(errorMsg);
      };
      xhr.open("get", stillepost.interfaces.config.directoryServerUrl + "/node/" + _uuid, true);
      xhr.send();
    });
  },

  // build onion layers of chain build information
  // {commandName: 'build', keyData:E_pn1(sym_key1),
  //      chainData:E_sym_key1(E_pn2(sym_key2) || n2Socket || E_sym_key2(E_pn3(sym_key) || E_pn3(..same same)))}
  createBuildMessage = function(keys, nodes, exitNodeData, chainIds) {

    var buildLayer = function(key, pubKey, dataToEncrypt) {
        var parsedPubKey = pubKey;
        if (typeof pubKey === "string")
          parsedPubKey = JSON.parse(pubKey);
        return cu.wrapAESKey(key, parsedPubKey).then(function(keyData) {
          var iv = cu.generateNonce();
          logToConsole("encrypting data: "+dataToEncrypt);
          return cu.encryptAES(dataToEncrypt, key, iv, commandNames.build).then(function(encData) {
            return {keyData: keyData, chainData:encData, iv:ab2str(iv)};
          });
        });
    },

    exitNodeLayer = function() {
      return buildLayer(keys[0], nodes[0].key, JSON.stringify({data: exitNodeData, chainId: ab2str(chainIds[chainIds.length-1])}));
    },

    entryNodeLayer = function(data) {
      var entryNodeData = {keyData: data.keyData, chainData: data.chainData, iv: data.iv};
      return buildLayer(keys[chainSize-1], nodes[chainSize-1].key,
        JSON.stringify({nodeSocket: nodes[chainSize-2].socket, data: entryNodeData, chainIdIn: ab2str(chainIds[0]), chainIdOut: ab2str(chainIds[1])}));
    },

    intermediateNodeLayer = function(data) {
      var intermediateData = {keyData: data.keyData, chainData: data.chainData, iv: data.iv};
      return buildLayer(keys[data.nodeIndex], nodes[data.nodeIndex].key,
        JSON.stringify({nodeSocket: nodes[data.nodeIndex-1].socket, data: intermediateData, chainIdIn: ab2str(chainIds[data.nodeIndex]),
        chainIdOut: ab2str(chainIds[data.nodeIndex+1])}));
    },

    currentNodeIndex = 1,
    returnPromise = Promise.resolve();

    returnPromise = returnPromise.then(exitNodeLayer);

    for (; currentNodeIndex < chainSize-1; currentNodeIndex++) {
      returnPromise = returnPromise.then(
        (function(currentNodeIndex) {
          return function(data) {
            data.nodeIndex = currentNodeIndex;
            return intermediateNodeLayer(data);
          }
        })(currentNodeIndex)
      );
    }
    returnPromise = returnPromise.then(entryNodeLayer);

    return returnPromise;
  },

  //requests list of nodes, creates layered 'create' request and sends it to the first node in the chain.
  // Member _masterChainCreate is the Promise, which needs to be resolved on receiving acknowledge-Message from exit node
  createChain = function() {
    return retrieveNodes().then(function(nodes) {
      if (nodes.length < chainSize) {
        throw "Retrieved node count less than the required chainSize";
      }
      logToConsole("Nodes: ",nodes);
      //generate new AES-keys
      return cu.getGeneratedAESKeys(chainSize).then(function(keys) {
        logToConsole("AES-keys: ", keys);
        masterChain = keys;

        var chainIds = [], i;
        // Generate secure random chainIds
        for (i = 0; i < chainSize; i++) {
          chainIds.push(cu.generateNonce());
        }
        chainIdMaster = chainIds[0];
        // pre-compute expected chainId hash
        return cu.hash(cu.abConcat(chainIdMaster, masterSeqNumRead, linkType.encrypt)).then(function(digest) {
          masterHash = digest;

          // Create a nonce used to check successful chain build-up. The generated nonce is compared to the nonce in the answer of the exit node
          _masterChainNonce = cu.generateNonce();
          var dataExitNode = {padding: "ensure that this data is the same size as the chainData for other sockets", nonce: ab2str(_masterChainNonce),
            pubChainId: _pubChainId};
          return createBuildMessage(keys, nodes, dataExitNode, chainIds).then(function(data) {
            _entryNodeSocket = nodes[chainSize-1].socket;
            _exitNodeSocket = nodes[0].socket;
            var command = {commandName: commandNames.build, keyData: data.keyData, chainData: data.chainData, iv: data.iv};
            logToConsole("created command: ", command);

            var con = new webrtc.createConnection(_entryNodeSocket.address, _entryNodeSocket.port),
              promise = new Promise(function(resolve,reject) {
                _masterChainCreated = resolve;
                _masterChainError = reject;
                setTimeout(function() {
                  if (!_isMasterChainCreated) {
                    reject("Create chain Timeout reached");
                  }
                }, stillepost.interfaces.config.createChainTimeout);
              });
            con.send(command).catch(function(err) {
              _masterChainError(err);
            });
            return promise;
          });
        });
      });
    });
  },

  /**
   * Generates a random 32 bit Integer, which is used as a unique identifier for a chain.
   * @returns chainId ... the randomly generated chainId
   */
  createChainId = function() {
    var chainId = cu.generateRandomInt32();
    // need to make sure it is unique
    if (chainMap[chainId]) {
      return createChainId();
    }
    return chainId;
  },

  /**
   * Send a message over the onion chain.
   * {E_symNode1(E_symNode2(E_symNode3(message), iv), iv), iv}
   *
   * @param commandName ... the commandName of the message
   * @param message ... the message to send over the chain
   */
  sendChainMessage = function(commandName, message) {
    var messageObject = null,
      message  = JSON.stringify(message),
      messageLength = message.length,
      chunkSize = window.stillepost.interfaces.config.chunkSize,
      msgEncryptionOverheadBytes = 200;

    // take account of encryption overhead in comparison
    if (messageLength > chunkSize - msgEncryptionOverheadBytes) {
      var messageId = _nextMessageId++,
        chunkCount = Math.ceil(messageLength / chunkSize),
        promises = [];
      for (var i = 0; i < chunkCount; i++) {
        messageObject = { id: messageId, chunkNumber: i, chunkCount: chunkCount, msg: message.slice(i*chunkSize,chunkSize*i + chunkSize)};
        if(i === chunkCount - 1)
          messageObject.padding = cu.generateRandomBytes(chunkSize - (messageLength - i*chunkSize));
        promises.push(sendMessageChunk(commandName, JSON.stringify(messageObject)));
      }
      return Promise.all(promises);
    } else {
      messageObject = { id: _nextMessageId++, chunkNumber: 0, chunkCount: 1, msg: message, padding: ab2str(cu.generateRandomBytes(chunkSize-msgEncryptionOverheadBytes-messageLength))};
      return sendMessageChunk(commandName, JSON.stringify(messageObject));
    }
  },

  sendMessageChunk = function(commandName, message) {
    var iv = cu.generateNonce();
    return cu.encryptAES(JSON.stringify({content: message, nonce: ab2str(_chainNonce)}), masterChain[0], iv, commandName).then(function(encData) {
      var iv2 = cu.generateNonce();
      return cu.encryptAES(JSON.stringify({chainData: encData, iv: ab2str(iv)}), masterChain[1], iv2, commandName).then(function(encData) {
        iv = cu.generateNonce();
        return cu.encryptAES(JSON.stringify({chainData: encData, iv: ab2str(iv2)}), masterChain[2], iv, commandName).then(function(encData) {
          return cu.hashArrayObjects([cu.abConcat(chainIdMaster, masterSeqNumWrite, linkType.decrypt),
            JSON.stringify({seqNum: masterSeqNumWrite++, chainId: chainIdMaster, data: encData})]).then(function(digestArray) {
            var con = webrtc.createConnection(_entryNodeSocket.address, _entryNodeSocket.port),
              msg = {commandName: commandName, chainData: encData, iv: ab2str(iv), chainId: digestArray[0], checksum: digestArray[1]};
            return con.send(msg).then(function() {
              logToConsole("Successfully sent message to entry node ",msg);
            });
          });
        })
      });
    });
  },

  unwrapMessage = function(message) {
    var data = null;
    return cu.decryptAES(message.chainData, masterChain[2], str2ab(message.iv), message.commandName).then(function (decDataNode1) {
      data = JSON.parse(decDataNode1);
      return cu.decryptAES(data.chainData, masterChain[1], str2ab(data.iv), message.commandName).then(function (decDataNode2) {
        data = JSON.parse(decDataNode2);
        return cu.decryptAES(data.chainData, masterChain[0], str2ab(data.iv), message.commandName).then(function (decDataExitNode) {
          return decDataExitNode;
        });
      });
    });
  },

  masterNodeMessageHandler = {

    // Handle ack message (return message from exit node as answer to build message)
    // Schematic representation of layered build-ack message
    // E_aesNode1( E_aesNode2( E_aesExitNode(confirmData), IV_exitNode ), IV_node2), IV_node1
    build: function(message) {
      return unwrapMessage(message).then(function(decData) {
        var data = JSON.parse(decData);
        logToConsole("Received message from exit node: ", data);
        if (abEqual(str2ab(data.nonce), _masterChainNonce)) {
          logToConsole('Successfully build chain with public information: ', _exitNodeSocket, data.pubChainId);
          _pubChainId = data.pubChainId;
          _chainNonce = str2ab(data.chainNonce);
          _masterChainCreated();
          _isMasterChainCreated = true;
          if (_curCreateChainTryCount > 0) {
            public.onnotification(notificationTypes.renew, {message: 'Renewed chain', data: public.getPublicChainInformation()});
            clientConnection.onRenewChain(public.getPublicChainInformation(), stillepost.interfaces.config.autoReconnect);
          }
          _curCreateChainTryCount = 0;
        } else {
          _masterChainError("Received invalid nonce from exit node");
        }
      }).catch(function(err) {
        var error = {message: 'Error decrypting build command response at chainMaster: ', error: err};
        _masterChainError(error);
        public.onerror(errorTypes.messageError, error)
      });
    },

    /**
     * Handle the received response of commandName 'message'
     * @param message
     */
    message: function(message) {
      return unwrapMessage(message).then(function (decData) {
        handleChunks(JSON.parse(decData), function(data) {logToConsole(data);});
      }).catch(function(err) {
        public.onerror(errorTypes.messageError, {message: 'error decrypting data', error: err});
      });
    },

    /**
     * Handle the received response of commandName 'clientMessage'
     * @param message
     */
    clientMessage: function(message) {
      return unwrapMessage(message).then(function (decData) {
        handleChunks(JSON.parse(decData), clientConnection.processClientMessage);
      }).catch(function(err) {
        public.onerror(errorTypes.messageError, {message: 'error decrypting data', error: err});
      });
    },

    error: function(message, webRTCConnection) {
      logToConsole("Received error commandMessage - destroying chain ",message.errorMessage);
      _masterChainError(message.errorMessage.message);
      if (_isMasterChainCreated) {
        _curCreateChainTryCount = 1;
        closeSingleWebRTCConnection(webRTCConnection);
        resetMasterChain();
        public.onerror(errorTypes.nodeError, {message: message.errorMessage.message, error: message.errorMessage.error});
        public.createChain();
      }
    },

    aajax: function(message) {
      return unwrapMessage(message).then(function (decData) {
        handleChunks(JSON.parse(decData), function(jsonData) {
          var aajaxObject = aajaxMap.pop(jsonData.id);
          if (aajaxObject) {
            if (jsonData.success) {
              if (aajaxObject.success)
                aajaxObject.success(jsonData.data, jsonData.textStatus, null);
              aajaxObject.resolve({data: jsonData.data, textStatus: jsonData.textStatus});
            } else {
              if (aajaxObject.error)
                aajaxObject.error(null, jsonData.textStatus, jsonData.errorThrown);
              aajaxObject.reject({message: 'Request timed out.', type: 'timeout'});
            }
          } else {
            public.onerror(errorTypes.messageError, {message: 'aajax object with id '+jsonData.id+" not found", error: Error()})
          }
        });
      }).catch(function(err) {
        public.onerror(errorTypes.messageError, {message: 'error decrypting data', error: err});
      });
    }
  };

  function handleChunks(msg, successCallback) {
    logToConsole('handle chunk: ',msg);
    if (msg.chunkCount > 1) {
      var msgBuf = _messageBuffer[msg.id];
      if (!msgBuf) {
        msgBuf = {};
        _messageBuffer[msg.id] = msgBuf;
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
        logToConsole('current chunk count: ',msgBuf.chunkCount);
      }
    } else if (msg.chunkCount === 1 && successCallback) {
      successCallback(JSON.parse(msg.msg));
    }
  }

  function sendError(errorMessage, errorObj, connection, chainId, seqNumWrite, mode) {
    logToConsole(errorMessage, errorObj, connection, chainId);
    if (chainId && seqNumWrite) {
      return cu.hash(cu.abConcat(chainId, seqNumWrite, linkType.getLinkTypeEncryptDefault(mode))).then(function(digest) {
        var errorMsg = {
          commandName: commandNames.error,
          chainId: digest,
          errorMessage: {
            message: errorMessage,
            error: errorObj || {}
          }
        };
        return connection.send(errorMsg);
      }).catch(function(err) {
        logToConsole('Caught error in sendError',err);
        closeSingleWebRTCConnection(connection);
      });
    } else {
      closeSingleWebRTCConnection(connection);
    }
  }

  function updateMasterHash(message, webRTCConnection) {
    return new Promise(function(resolve, reject) {
      cu.hashArrayObjects([JSON.stringify({seqNum: masterSeqNumRead, chainId: chainIdMaster, data: message.chainData}),
        cu.abConcat(chainIdMaster, ++masterSeqNumRead, linkType.encrypt)]).then(function(digestArray) {
        if (message.checksum !== digestArray[0])
          reject('Invalid checksum');
        masterHash = digestArray[1];
        resolve({message: message, webRTCConnection: webRTCConnection, master: true});
      }).catch(function(err) {
        reject(err);
      });
    });
  }

  function encWorkerListener(workerMessage, webRTCConnection, iv, node, message) {
    // Try to compute chainID-hash for next node
    cu.hashArrayObjects([cu.abConcat(node.chainIdOut, node.seqNumWrite, linkType.getLinkTypeEncryptDefault(node.type)),
      JSON.stringify({seqNum: node.seqNumWrite++, chainId: node.chainIdOut, data: workerMessage.data.data})]).then(function(digestArray) {
      var con = null;
      if (workerMessage.data.success) {
        con = webrtc.createConnection(node.socket.address, node.socket.port);
        var command = {commandName: message.commandName, chainId: digestArray[0], iv: ab2str(iv), chainData: workerMessage.data.data, checksum: digestArray[1]};
        logToConsole('Sending command to next node',command);
        return con.send(command);
      } else {
        con = webrtc.createConnection(node.socket.address, node.socket.port);
        //in encryption (or exit node) case send error to next node in chain
        return con.send({commandName: commandNames.error, chainId: digestArray[0], errorMessage: {message: "Error while forwarding message at intermediate node", error: workerMessage.data.data}});
      }
    }).catch(function (error){
      //error callback for hash operation
      logToConsole('Error in encWorkerListener: ', error);
      closeSingleWebRTCConnection(webRTCConnection);
    });
  }

  function resetMasterChain() {
    _createChainPromise = null;
    _isMasterChainCreated = false;
    chainIdMaster = null;
    masterHash = null;
    masterSeqNumRead = 1;
    masterSeqNumWrite = 1;
    _exitNodeSocket = null;
    _pubChainId = null;
    _masterChainNonce = null;
  }

  function sendMessage(commandName, message) {
    // init chain
    if (!_isMasterChainCreated) {
      if (!_createChainPromise) {
        _createChainPromise = createChain();
      }
      return _createChainPromise.then(function () {
        logToConsole("created Chain");
        _isMasterChainCreated = true;
        return sendChainMessage(commandName, message);
      }).catch(function(err) {
        logToConsole('sendMessage createChain error recovery',err);
        chainErrorRecovery(err, wrapFunction(sendMessage,this,[commandName, message]));
      });
    } else {
      // send message over chain
      return sendChainMessage(commandName, message).catch(function(err) {
        logToConsole('sendMessage createChain error recovery',err);
        chainErrorRecovery(err, wrapFunction(sendMessage,this,[commandName, message]));
      });
    }
  }

  function chainErrorRecovery(err, callback) {
    logToConsole("error creating chain: ",err);
    public.onerror(errorTypes.buildError, {message: 'Error while creating chain', error: err});

    resetMasterChain();
    if (_curCreateChainTryCount++ < stillepost.interfaces.config.maxCreateChainTryCount) {
      var delay = (_curCreateChainTryCount^2) * 100,
        callbackFunction = callback ? callback : public.createChain;
      delay = delay > stillepost.interfaces.config.maxCreateChainInterval ? stillepost.interfaces.config.maxCreateChainInterval : delay;
      setTimeout(wrapFunction(function(callbackFunction) {
          callbackFunction();
      }, this, [callbackFunction]), delay);
    } else {
      public.onerror(errorTypes.chainError,{message: 'Maximum amount of chain build attempts reached'});
    }
  }

  public.createChain = function() {
    if (!_createChainPromise)
      _createChainPromise = createChain().catch(function(err) {
        return chainErrorRecovery(err);
      });
    return _createChainPromise;
  };

  public.getPublicChainInformation = function() {
    return {socket: _exitNodeSocket, chainId: _pubChainId};
  };

  public.onerror = function(type, errorThrown) {
    stillepost.interfaces.onionlayer.onerror(type, errorThrown);
  };

  public.onnotification = function(type, notification) {
    stillepost.interfaces.onionlayer.onnotification(type, notification);
  };

  public.init = function() {
    cu = window.stillepost.cryptoUtils;
    webrtc = window.stillepost.webrtc;
    exitNode = window.stillepost.onion.exitNode;
    intermediateNode = window.stillepost.onion.intermediateNode;
    clientConnection = window.stillepost.onion.clientConnection;
    initOnionSetup();
  };

  public.getNodeConnectionCount = function(remoteAddress, remotePort) {
    var count = 0;
    if (_entryNodeSocket && remoteAddress === _entryNodeSocket.socket && remotePort === _entryNodeSocket.port)
      count++;
    for (var key in chainMap) {
      if (chainMap.hasOwnProperty(key) && chainMap[key].socket.address === remoteAddress &&
        chainMap[key].socket.port === remotePort) {
        count++;
      }
    }
    return count;
  };

  function closeSingleWebRTCConnection(connection) {
    if (connection && public.getNodeConnectionCount(connection.getRemoteSocket().address, connection.getRemoteSocket().port) <= 1) {
      connection.close();
    }
  }

  public.closeSingleWebRTCConnection = closeSingleWebRTCConnection;

  public.peerDisconnected = function(remoteAddress, remotePort) {
    logToConsole("peer disconnected");
    if (_entryNodeSocket && _entryNodeSocket.address === remoteAddress && _entryNodeSocket.port === remotePort) {
      if (_isMasterChainCreated) {
        public.onerror(errorTypes.nodeError, {message: 'Entry node disconnected'});
        _curCreateChainTryCount = 1;
        resetMasterChain();
        public.createChain();
      }
    }
    // find all chains that use this peer and propagate error message in each chain
    for (var key in chainMap) {
      if (chainMap.hasOwnProperty(key) && chainMap[key].socket.address === remoteAddress &&
          chainMap[key].socket.port === remotePort) {
        for (var innerKey in chainMap) {
          if (chainMap.hasOwnProperty(innerKey) && chainMap[key] && chainMap[innerKey].chainIdIn == chainMap[key].chainIdOut) {
            var mapEntry = chainMap[innerKey],
              con = webrtc.createConnection(mapEntry.socket.address, mapEntry.socket.port);
            logToConsole("Propagating peer disconnected error message to next node ",mapEntry);
              sendError("Connection closed", null, con, mapEntry.chainIdOut, mapEntry.seqNumWrite, mapEntry.type).catch(function(err) {
                logToConsole('Could not propagate error message',err);
              });
            delete chainMap[innerKey];
          }
        }
        delete chainMap[key];
      }
    }
  };

  public.closeChain = function() {
    logToConsole('Onion layer close chain called - reseting chain information and sending close message');
    if (_isMasterChainCreated) {
      return sendMessage(commandNames.close, _pubChainId).then(function() {
        resetMasterChain();
      });
    }
  };

  public.cleanUp = function() {
    public.closeChain();
    var xhr = new XMLHttpRequest(),
      message = {socket: _localSocket, id: _uuid};
    xhr.onload = function () {
      var response = JSON.parse(this.responseText);
      if (response.msg === "OK") {
        logToConsole("Successfully logged out from directory server");
      }
    };
    xhr.onerror = function(e) {
      public.onerror({message: "Failed to logout from directory server ", error: e.target});
    };
    xhr.open("post", stillepost.interfaces.config.directoryServerUrl + "/logout", true);
    xhr.send(JSON.stringify(message));
    clearInterval(_heartBeat);
  };

  public.aajax = function(request) {
    return new Promise(function(resolve,reject) {
      var requestObject = {};

      requestObject.accepts = request.accepts;
      requestObject.contents = request.contents;
      requestObject.contentType = request.contentType;
      requestObject.converters = request.converters;
      requestObject.data = request.data;
      requestObject.dataType = request.dataType;
      requestObject.headers = request.headers;
      requestObject.mimeType = request.mimeType;
      requestObject.processData = request.processData;
      requestObject.responseType = request.responseType;
      requestObject.scriptCharset = request.scriptCharset;
      requestObject.type = request.type;
      requestObject.url = request.url;

      Object.keys(requestObject).forEach(function(item) {
        if(!requestObject[item]) {
          delete requestObject[item];
        }
      });

      var id = aajaxMap.put({success: request.success, error: request.error, resolve: resolve, reject: reject});
      requestObject.id = id;

      sendMessage(commandNames.aajax, requestObject);

      setTimeout(function() {
        var obj = aajaxMap.pop(id);
        if (obj && obj.error) {
          obj.error(null, 'timeout', 'Request timed out.');
          reject({message: 'Request timed out.', type: 'timeout'});
        }
      }, stillepost.interfaces.config.aFileDownTimeout);
    });
  };

  public.chainMap = chainMap;

  public.encWorkerListener = encWorkerListener;

  public.sendError = sendError;

  public.localSocket = _localSocket;

  public.masterNodeMessageHandler = masterNodeMessageHandler;

  public.updateMasterHash = updateMasterHash;

  public.commandNames = commandNames;

  public.linkType = linkType;

  public.worker = worker;

  public.isMasterNode = function(chainIdHash) {
    return chainIdHash && masterHash && masterHash === chainIdHash;
  };

  //interface function to generically send a new message over the master chain
  public.sendMessage = function(messageType, message) {
    return sendMessage(messageType, message);
  };

  return public;
})();