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
    directoryServerUrl = "http://127.0.0.1:42111",
    _masterChainCreated = null,
    _masterChainError = null,
    _isMasterChainCreated = false,
    _createChainPromise = null,
    _uuid = null,
    // current amount of tries to connect to the directory server
    _curDirectoryTryCount = 0,
    // maximum amount of tries to connect to the directory server
    _maxDirectoryTryCount = 3,
    _localSocket = {},

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

  /**
   *  Generate RSA keypair and send public key to directory server.
   *  This function needs to be called initially.
   *  The message to the directory server contains:
   *    - Address, Port ... our local public socket information
   *    - Public key ... the generated public key, which is valid for the current session
   */
  initOnionSetup = function() {
    cu.getGeneratedPublicKey().then(function(pubKey) {
      console.log("Generated pubKey: "+pubKey);
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
          console.log("Registering at directory server as ", entry);
          var xhr = new XMLHttpRequest();
          xhr.onload = function () {
            var response = JSON.parse(this.responseText);
            console.log("Directory server responded register request with: ", response);
            if (response.msg === "OK") {
              _uuid = response.data;
              console.log("Successfully registered at directory server with uuid " + response.data);
            }
          };
          xhr.onerror = function (e) {
            console.log("Try: " + (++_curDirectoryTryCount) + ": Failed to register at directory server", e.target);
            if (_curDirectoryTryCount < _maxDirectoryTryCount)
              registerAtDirectory();
          };
          xhr.open("post", directoryServerUrl + "/register", true);
          xhr.send(JSON.stringify(entry));
        };
        registerAtDirectory();
      });

    }).catch(function(err) {
      console.log("Error generating public RSA Key", err);
    });
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
          console.log("Received nodelist of length: "+nodeList.length);
          console.log(nodeList);
          try {
            nodeList = chooseNodes(nodeList);
            resolve(nodeList);
          } catch(e) {
            reject(e);
          }
        } else {
          reject("Server did no responded with OK "+msg.msg);
        }
      };
      xhr.onerror = function(e) {
        console.log("Failed to load nodes from directory server" + e.target.status);
        reject(e.target);
      };
      xhr.open("get", directoryServerUrl + "/nodelist/" + _uuid, true);
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
          console.log("keyData: " + keyData);
          var iv = cu.generateNonce();
          console.log("encrypting data: "+dataToEncrypt);
          return cu.encryptAES(dataToEncrypt, key, iv, 'build').then(function(encData) {
            return {keyData: keyData, chainData:encData, iv:iv};
          });
        });
    },

    exitNodeLayer = function() {
      return buildLayer(keys[0], nodes[0].key, JSON.stringify({data: exitNodeData, chainId: chainIds[chainIds.length-1]}));
    },

    entryNodeLayer = function(data) {
      var entryNodeData = {keyData: data.keyData, chainData: data.chainData, iv: data.iv};
      return buildLayer(keys[chainSize-1], nodes[chainSize-1].key,
        JSON.stringify({nodeSocket: nodes[chainSize-2].socket, data: entryNodeData, chainIdIn: chainIds[0], chainIdOut: chainIds[1]}));
    },

    intermediateNodeLayer = function(data) {
      var intermediateData = {keyData: data.keyData, chainData: data.chainData, iv: data.iv};
      return buildLayer(keys[data.nodeIndex], nodes[data.nodeIndex].key,
        JSON.stringify({nodeSocket: nodes[data.nodeIndex-1].socket, data: intermediateData, chainIdIn: chainIds[data.nodeIndex],
        chainIdOut: chainIds[data.nodeIndex+1]}));
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
  createChain = function(){
    return retrieveNodes().then(function(nodes) {
      if (nodes.length < chainSize) {
        throw "Retrieved node count less than the required chainSize";
      }
      console.log("Nodes: ",nodes);
      //generate new AES-keys
      return cu.getGeneratedAESKeys(chainSize).then(function(keys) {
        console.log("AES-keys: ", keys);
        masterChain = keys;

        var chainIds = [], i;
        // Generate secure random chainIds
        for (i = 0; i < chainSize; i++) {
          chainIds.push(cu.generateNonce());
        }
        chainIdMaster = chainIds[0];
        // pre-compute expected chainId hash
        cu.hash(cu.uInt32Concat(chainIdMaster, masterSeqNumRead)).then(function(digest) {
          masterHash = digest;
        }, function(err) {
          throw err;
        });

        // Create a nonce used to check successful chain build-up. The generated nonce is compared to the nonce in the answer of the exit node
        _masterChainNonce = cu.generateNonce();
        var dataExitNode = {padding: "ensure that this data is the same size as the chainData for other sockets", nonce: _masterChainNonce};
        return createBuildMessage(keys, nodes, dataExitNode, chainIds).then(function(data) {

          _entryNodeSocket = nodes[chainSize-1].socket;
          _exitNodeSocket = nodes[0].socket;
          var command = {commandName: 'build', keyData: data.keyData, chainData: data.chainData, iv: data.iv};
          console.log("created command: ", command);

          var con = new webrtc.createConnection(_entryNodeSocket.address, _entryNodeSocket.port),
            promise = new Promise(function(resolve,reject) {
              _masterChainCreated = resolve;
              _masterChainError = reject;
              setTimeout(7000,function() {
                if (!_isMasterChainCreated) {
                  reject("Create chain Timeout");
                }
              });
            });
          con.send(command).catch(function(err) {
            _masterChainError(err);
          });
          return promise;
        }, function (err) {
          console.log("Error while building layers", err);
        });
      }, function(err) {
        console.log("Error while generating AES keys",err);
      });
    }, function(err) {
      console.log('Error building chain',err);
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
    var iv = cu.generateNonce();
    return cu.encryptAES(JSON.stringify(message), masterChain[0], iv, commandName).then(function(encData) {
      var iv2 = cu.generateNonce();
      return cu.encryptAES(JSON.stringify({chainData: encData, iv: iv}), masterChain[1], iv2, commandName).then(function(encData) {
        iv = cu.generateNonce();
        return cu.encryptAES(JSON.stringify({chainData: encData, iv: iv2}), masterChain[2], iv, commandName).then(function(encData) {
          return cu.hashArrayObjects([cu.uInt32Concat(chainIdMaster, masterSeqNumWrite),
            JSON.stringify({seqNum: masterSeqNumWrite++, chainId: chainIdMaster, data: encData})]).then(function(digestArray) {
            var con = webrtc.createConnection(_entryNodeSocket.address, _entryNodeSocket.port),
              msg = {commandName: commandName, chainData: encData, iv: iv, chainId: digestArray[0], checksum: digestArray[1]};
            return con.send(msg).then(function() {
              console.log("Successfully sent message to entry node ",msg);
            });
          });
        })
      });
    }, function(err) {
      console.log("Error sending message over the chain: ",err);
    });
  },

  unwrapMessage = function(message) {
    var data = null;
    return cu.decryptAES(message.chainData, masterChain[2], objToAb(message.iv), message.commandName).then(function (decDataNode1) {
      data = JSON.parse(decDataNode1);
      return cu.decryptAES(data.chainData, masterChain[1], objToAb(data.iv), message.commandName).then(function (decDataNode2) {
        data = JSON.parse(decDataNode2);
        return cu.decryptAES(data.chainData, masterChain[0], objToAb(data.iv), message.commandName).then(function (decDataExitNode) {
          return decDataExitNode;
        });
      });
    });
  },

  // Handle ack message (return message from exit node as answer to build message)
  // Schematic representation of layered build-ack message
  // E_aesNode1( E_aesNode2( E_aesExitNode(confirmData), IV_exitNode ), IV_node2), IV_node1
  handleBuildResponse = function(message) {
    return unwrapMessage(message).then(function(decData) {
      var data = JSON.parse(decData);
      console.log("Received message from exit node: ", data);
      if (abEqual(objToAb(data.nonce), _masterChainNonce)) {
        console.log('Successfully build chain with public information: ', _exitNodeSocket, data.pubChainId);
        _pubChainId = data.pubChainId;
        _masterChainCreated();
        _isMasterChainCreated = true;
      } else {
        _masterChainError("Received invalid nonce from exit node");
      }
    }).catch(function(err) {
      console.log("Error decrypting build command response at chainMaster: ",err);
      _masterChainError(err);
    });
  },

  masterNodeMessageHandler = {
    /**
     * Handle the received response of commandName 'message'
     * @param message
     */
    message: function(message) {
      return unwrapMessage(message).then(function (decData) {
        console.log("decrypted data: ", decData);
        var jsonData = JSON.parse(decData);
        console.log("parsed decrypted data: ", jsonData);
      }).catch(function(err) {
        console.log("error decrypting data",err);
      });
    },

    /**
     * Handle the received response of commandName 'clientMessage'
     * @param message
     */
    clientMessage: function(message) {
      return unwrapMessage(message).then(function (decData) {
        clientConnection.processClientMessage(decData);
      }).catch(function(err) {
        console.log("error decrypting data",err);
      });
    }
  };

  function sendMessage(commandName, message) {
    // init chain
    if (!_isMasterChainCreated) {
      if (!_createChainPromise) {
        _createChainPromise = createChain();
      }
      _createChainPromise.then(function () {
        console.log("created Chain");
        _isMasterChainCreated = true;
        return sendChainMessage(commandName, message);
      }).catch(function(err) {
        // todo: handle error
        console.log("error creating chain: ",err);
        resetMasterChain();
      });
    } else {
      // send message over chain
      return sendChainMessage(commandName, message);
    }
  }

  function sendError(errorMessage, errorObj, connection, chainId, seqNumWrite) {
    console.log(errorMessage, errorObj, connection, chainId);
    if (chainId && seqNumWrite) {
      return cu.hash(cu.uInt32Concat(chainId, seqNumWrite)).then(function(digest) {
        var errorMsg = {
          commandName: 'error',
          chainId: digest,
          errorMessage: {
            message: errorMessage,
            error: errorObj || {}
          }
        };
        return connection.send(errorMsg);
      }).catch(function(err) {
        console.log('Caught error in sendError',err);
        connection.close();
      });
    } else if (connection) {
      connection.close();
    }
  }

  function updateMasterHash(message, webRTCConnection) {
    return new Promise(function(resolve, reject) {
      cu.hashArrayObjects([JSON.stringify({seqNum: masterSeqNumRead, chainId: chainIdMaster, data: message.chainData}),
        cu.uInt32Concat(chainIdMaster, ++masterSeqNumRead)]).then(function(digestArray) {
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
    cu.hashArrayObjects([cu.uInt32Concat(node.chainIdOut, node.seqNumWrite),
      JSON.stringify({seqNum: node.seqNumWrite++, chainId: node.chainIdOut, data: workerMessage.data.data})]).then(function(digestArray) {
      var con = null;
      if (workerMessage.data.success) {
        con = webrtc.createConnection(node.socket.address, node.socket.port);
        var command = {commandName: message.commandName, chainId: digestArray[0], iv: iv, chainData: workerMessage.data.data, checksum: digestArray[1]};
        console.log('Sending command to next node',command);
        return con.send(command);
      } else {
        con = webrtc.createConnection(node.socket.address, node.socket.port);
        //in encryption (or exit node) case send error to next node in chain
        return con.send({commandName: "error", chainId: digestArray[0], errorMessage: {message: "Error while forwarding message at intermediate node", error: workerMessage.data.data}});
      }
    }).catch(function (error){
      //error callback for hash operation
      console.log('Error in encWorkerListener: ', error);
      webRTCConnection.close();
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

  public.createChain = function() {
    if (!_createChainPromise)
      _createChainPromise = createChain();
    return _createChainPromise;
  };

  public.getPublicChainInformation = function() {
    return {socket: _exitNodeSocket, chainId: _pubChainId};
  };

  public.init = function() {
    cu = window.stillepost.cryptoUtils;
    webrtc = window.stillepost.webrtc;
    exitNode = window.stillepost.onion.exitNode;
    intermediateNode = window.stillepost.onion.intermediateNode;
    clientConnection = window.stillepost.onion.clientConnection;
  };

  public.chainMap = chainMap;

  public.encWorkerListener = encWorkerListener;

  public.peerDisconnected = function(remoteAddress, remotePort) {
    console.log("peer disconnected");
    if (_entryNodeSocket && _entryNodeSocket.address === remoteAddress && _entryNodeSocket.port === remotePort) {
      console.log("Removing chain as master");
      resetMasterChain();
    }
    // find all chains that use this peer and propagate error message in each chain
    for (var key in chainMap) {
      if (chainMap.hasOwnProperty(key) && chainMap[key].socket.address === remoteAddress &&
          chainMap[key].socket.port === remotePort) {
        for (var innerKey in chainMap) {
          if (chainMap.hasOwnProperty(innerKey) && chainMap[innerKey].chainIdIn == chainMap[key].chainIdOut) {
            var mapEntry = chainMap[innerKey],
              con = webrtc.createConnection(mapEntry.socket.address, mapEntry.socket.port);
            console.log("Propagating peer disconnected error message to next node ",mapEntry);
              sendError("Connection closed", null, con, mapEntry.chainIdOut, mapEntry.seqNumWrite).then(function() {
                con.close();
              }).catch(function(err) {
                console.log('Could not propagate error message',err);
              });
            delete chainMap[innerKey];
          }
        }
        delete chainMap[key];
      }
    }
  };

  public.sendError = sendError;

  public.localSocket = _localSocket;

  public.masterNodeMessageHandler = masterNodeMessageHandler;

  public.updateMasterHash = updateMasterHash;

  public.getMasterHash = function() {return masterHash;};

  public.resetMasterChain = resetMasterChain;

  public.chainError = function (err) {_masterChainError(err);};

  public.handleBuildResponse = handleBuildResponse;

  public.cleanUp = function() {
    resetMasterChain();
    var xhr = new XMLHttpRequest(),
      message = {socket: _localSocket, id: _uuid};
    xhr.onload = function () {
      var response = JSON.parse(this.responseText);
      console.log("Directory server responded logout request with: ", response);
      if (response.msg === "OK") {
        console.log("Successfully logged out from directory server");
      }
    };
    xhr.onerror = function(e) {
      console.log("Failed to logout from directory server ", e.target);
    };
    xhr.open("post", directoryServerUrl + "/logout", true);
    xhr.send(JSON.stringify(message));
    if (_beforeUnload)
      _beforeUnload();
  };

  // cleanup when browser or tab is closed
  // todo: remove if no longer necessary
  var _beforeUnload = window.onbeforeunload;
  window.onbeforeunload = function() {
    public.cleanUp();
    if (_beforeUnload)
      _beforeUnload();
  };

  //interface function to generically send a new message over the master chain
  public.sendMessage = function(messageType, message) {
    return sendMessage(messageType, message);
  };

  initOnionSetup();

  return public;
})();