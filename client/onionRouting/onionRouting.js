window.stillepost = window.stillepost || {};
window.stillepost.onion = (function() {
  var public = {},
    cu = window.stillepost.cryptoUtils,
    webrtc = window.stillepost.webrtc,
    chainSize = 3,
    directoryServerUrl = "http://127.0.0.1:42111",
    _masterChainCreated = null,
    _masterChainError = null,
    _isMasterChainCreated = false,
    _createChainPromise = null,
    _uuid = null,
    _localSocket = {},

  //Id of the chain in which this node is the master
  chainIdMaster = null,

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
        _localSocket = entry;
        entry.key = pubKey;
        console.log("Registering at directory server as ",entry);
        var xhr = new XMLHttpRequest();
        xhr.onload = function () {
          var response = JSON.parse(this.responseText);
          console.log("Directory server responded register request with: ", response);
          if (response.msg === "OK") {
            _uuid = response.data;
            console.log("Successfully registered at directory server with uuid " + response.data);
          }
        };
        xhr.onerror = function(e) {
          // todo: error handling
          console.log("Failed to register at directory server"+ e.target.status);
        };
        xhr.open("post", directoryServerUrl + "/register", true);
        xhr.send(JSON.stringify(entry));
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
      // we need to make sure, that we don't select oneself as a node
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
            reject("Could not create node List");
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

  createLayer = function(key, pubKey, data, socket) {
    var parsedPubKey = pubKey;
    if (typeof pubKey === "string")
      parsedPubKey = JSON.parse(pubKey);
    return cu.wrapAESKey(key, parsedPubKey).then(function(keyData) {
      console.log("keyData: " + keyData);
      var iv = cu.generateNonce(),
        dataToEncrypt = null;
      console.log("generated IV: ",iv);
      if (socket) {
        // create intermediate node layer
        dataToEncrypt = JSON.stringify({nodeSocket: socket, data: data});
      } else {
        // create exit node layer
        dataToEncrypt = JSON.stringify({data: data});
      }
      console.log("encrypting data: "+dataToEncrypt);
      return cu.encryptAES(dataToEncrypt, key, iv).then(function(encData) {
        return {keyData: keyData, chainData:encData, iv:iv};
      });
    });
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

        // build onion layers of chain build information
        // {commandName: 'build', keyData:E_pn1(sym_key1),
        //      chainData:E_sym_key1(E_pn2(sym_key2) || n2Socket || E_sym_key2(E_pn3(sym_key) || E_pn3(..same same)))}

        // build innermost layer - exit node
        console.log("creating node layer: ",nodes[0]);

        // Create a nonce used to check successful chain build-up. The generated nonce is compared to the nonce in the answer of the exit node
        _masterChainNonce = cu.generateNonce();
        var dataExitNode = {padding: "ensure that this data is the same size as the chainData for other sockets", nonce: _masterChainNonce};
        return createLayer(keys[0], nodes[0].key, dataExitNode).then(function(layerDataExit) {
          // build second innermost layer - node2
          // This is the encrypted Exit Node Data which is again encrypted
          var intermediateData = {keyData: layerDataExit.keyData, chainData: layerDataExit.chainData, iv: layerDataExit.iv};
          console.log("created exit node layer",intermediateData);
          return createLayer(keys[1], nodes[1].key, intermediateData, nodes[0].socket).then(function(layerDataIntermediate) {

            // build third layer - entry node
            var entryNodeData = {keyData: layerDataIntermediate.keyData, chainData: layerDataIntermediate.chainData, iv: layerDataIntermediate.iv};
            return createLayer(keys[2], nodes[2].key, entryNodeData, nodes[1].socket).then(function(layerDataEntry) {
              chainIdMaster = createChainId();
              _entryNodeSocket = nodes[2].socket;
              var command = {commandName: 'build', keyData: layerDataEntry.keyData, chainData: layerDataEntry.chainData, iv: layerDataEntry.iv,
                chainId: chainIdMaster};
              console.log("created command: ", command);

              var con = new webrtc.createConnection(nodes[2].socket.address, nodes[2].socket.port),
                promise = new Promise(function(resolve,reject) {
                  _masterChainCreated = resolve;
                  _masterChainError = reject;
                  setTimeout(30000,function() {
                    if (!_isMasterChainCreated) {
                      reject("Create chain Timeout");
                    }
                  });
                });
              con.send(command).catch(function(err) {
                _masterChainError(err);
              });
              return promise;
            });
          });
        }, function (err) {
          console.log("Error while building layers", err);
        });
      }, function(err) {
        console.log("Error while generating AES keys",err);
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
  sendMessage = function(commandName, message) {
    var iv = cu.generateNonce();
    cu.encryptAES(JSON.stringify(message), masterChain[0], iv).then(function(encData) {
      var iv2 = cu.generateNonce();
      return cu.encryptAES(JSON.stringify({chainData: encData, iv: iv}), masterChain[1], iv2).then(function(encData) {
        iv = cu.generateNonce();
        return cu.encryptAES(JSON.stringify({chainData: encData, iv: iv2}), masterChain[2], iv).then(function(encData) {
          var con = webrtc.createConnection(_entryNodeSocket.address, _entryNodeSocket.port),
            msg = {commandName: commandName, chainData: encData, iv: iv, chainId: chainIdMaster};
          return con.send(msg).then(function() {
            console.log("Successfully sent message to entry node ",msg);
          });
        })
      });
    }).catch(function(err) {
      console.log("Error sending message over the chain: ",err);
    });
  },

  unwrapMessage = function(message) {
    var data = null;
    return cu.decryptAES(message.chainData, masterChain[2], objToAb(message.iv)).then(function (decDataNode1) {
      data = JSON.parse(decDataNode1);
      return cu.decryptAES(data.chainData, masterChain[1], objToAb(data.iv)).then(function (decDataNode2) {
        data = JSON.parse(decDataNode2);
        return cu.decryptAES(data.chainData, masterChain[0], objToAb(data.iv)).then(function (decDataExitNode) {
          return decDataExitNode;
        });
      });
    });
  },

  // Handle ack message (return message from exit node as answer to build message)
  // Schematic representation of layered build-ack message
  // E_aesNode1( E_aesNode2( E_aesExitNode(confirmData), IV_exitNode ), IV_node2), IV_node1
  handleBuildResponse = function(message) {
    unwrapMessage(message).then(function(decData) {
      var data = JSON.parse(decData);
      console.log("Received message from exit node: ", data);
      if (abEqual(objToAb(data.nonce), _masterChainNonce)) {
        _masterChainCreated();
      } else {
        _masterChainError("Received invalid nonce from exit node");
      }
    }).catch(function(err) {
      console.log("Error decrypting build command response at chainMaster: ",err);
      _masterChainError(err);
    });
  },

  /**
   * Handle the received response of commandName 'message'
   * @param content
   */
  handleMessageResponse = function(message) {
    unwrapMessage(message).then(function(decData) {
      console.log("decrypted data: ",decData);
    }).catch(function(err) {
      console.log("error decrypting data",err);
    });

  };

  public.sendMessageToRemoteChain = function(message, address, port, chainId) {
    var msg = {message: message, chainId: chainId, socket: {address: address, port: port}};
    sendOrCreateChainMessage("remoteMessage", msg);
  };

  //interface function to generically send a new message over the master chain
  public.sendMessage = function(message) {
    sendOrCreateChainMessage("message",message);
  };

  function sendOrCreateChainMessage(commandName, message) {
    // init chain
    if (!_isMasterChainCreated) {
      if (!_createChainPromise) {
        _createChainPromise = createChain();
      }
      _createChainPromise.then(function () {
        console.log("created Chain");
        _isMasterChainCreated = true;
        sendMessage(commandName, message);
      }).catch(function(err) {
        // todo: handle error
        console.log("error creating chain: ",err);
        resetMasterChain();
      });
    } else {
      // send message over chain
      sendMessage(commandName, message);
    }
  }

  function sendError(errorMessage, errorObj, connection, chainId) {
    var errorMsg = {
      commandName: 'error',
      chainId: chainId,
      errorMessage: {
        message: errorMessage,
        error: {}
      }
    };
    if (chainId)
      errorMsg.chainId = chainId;
    if (errorObj)
      errorMessage.errorMessage.error = errorObj;
    return connection.send(errorMsg);
  }

  var messageHandler = {
    build: function(message, remoteAddress, remotePort, webRTCConnection) {
      // if the message contains key data it is sent in the direction of chain master -> exit node
      if (message.keyData) {
        cu.unwrapAESKey(message.keyData).then(function (unwrappedKey) {
          return cu.decryptAES(message.chainData, unwrappedKey, objToAb(message.iv)).then(function (decData) {
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
          sendError("Error decrypting data on chain node " + _localSocket.address + ":" + _localSocket.port,
            err, webRTCConnection, message.chainId);
        });
      }
      // we received ack message as master of the chain - validate content
      else if (message.chainId === chainIdMaster) {
        handleBuildResponse(message);
      } else {
        // intermediate node logic: Encrypt and forward build message response.
        intermediateNode.wrapMessage(message);
      }
    },

    error: function(message) {
      if (message.chainId == chainIdMaster) {
        console.log("Received error commandMessage - destroying chain ",message.errorMessage.error);
        _masterChainError(message.errorMessage.message);
        resetMasterChain();
      } else {
        // we are not an endpoint node and need to forward the error message
        var node = chainMap[message.chainId];
        if (node && node.socket.address) {
          var con = webrtc.createConnection(node.socket.address, node.socket.port);
          con.send({commandName: "error", chainId: node.chainId, errorMessage: message.errorMessage}).then(function() {
            con.pc.close();
          });
        } else {
          console.log("Received error commandMessage ",message.errorMessage.message);
        }
      }
    },

    message: function(message, remoteAddress, remotePort, webRTCConnection) {
      if (message.chainId == chainIdMaster) {
        handleMessageResponse(message);
      } else {
        var node = chainMap[message.chainId];
        if (node) {
          if (node.type === "decrypt") {
            var iv = objToAb(message.iv);
            cu.decryptAES(message.chainData, node.key, iv).then(function (decData) {
              // check if this node is an exit node
              if (node.socket.address === remoteAddress && node.socket.port === remotePort) {
                exitNode[message.commandName](message, node, decData, webRTCConnection);
              } else {
                intermediateNode[message.commandName](message, decData, node);
              }
            }).catch(function (err) {
              console.log("Error while decrypting: ", err);
              sendError("Error while processing message at node " +
                _localSocket.address + ":" + _localSocket.port, err, webRTCConnection, message.chainId);
            });
          } else {
            intermediateNode.wrapMessage(message);
          }
        } else {
          sendError("Received invalid chainId", null, webRTCConnection, message.chainId);
        }
      }
    },

    remoteMessage: function(messageParam, remoteAddress, remotePort, webRTCConnection) {
      messageHandler.message(messageParam, remoteAddress, remotePort, webRTCConnection);
    }
  };

  // object containing all intermediate node logic
  var intermediateNode = {
    build: function(message, content, unwrappedKey, remoteAddress, remotePort, webRTCConnection) {
      console.log("Sending build command to next node: ", content.nodeSocket);
      var chainId = createChainId();
      // add entries to chainMap - which maps a chainId to a specific chain
      chainMap[message.chainId] = {socket: content.nodeSocket, key: unwrappedKey, chainId: chainId, type: "decrypt"};
      chainMap[chainId] = {
        socket: {address: remoteAddress, port: remotePort},
        key: unwrappedKey,
        chainId: message.chainId,
        type: "encrypt"
      };
      var buildMessage = {
        commandName: 'build',
        chainId: chainId,
        iv: objToAb(content.data.iv),
        keyData: content.data.keyData,
        chainData: content.data.chainData
      };
      console.log("Command to send: ", buildMessage);
      // Create webrtc connection with next node in the chain and send the data
      var con = webrtc.createConnection(content.nodeSocket.address, content.nodeSocket.port);
      con.send(buildMessage).catch(function (err) {
        // if an error occurred while trying to send message to next node, we return an error message to the previous node
        sendError("Error while sending build message to next node " +
          content.nodeSocket.address + ":" + content.nodeSocket.port, err, webRTCConnection, message.chainId);
      });
    },

    /**
     * Entry or intermediate node logic: Encrypt and forward message.
     * This logic represents the back-traversal of the message response from exit node to chain master node
     * Schematic representation of the message, which is generated.
     * message = {chainData: E_aesNode(message.chainData, message.iv), iv: <newly generated nonce>]
     * @param message ... the message JSON object received via webRTC
     */
    wrapMessage: function(message) {
      // Retrieve the chainMap entry which contains the AES-Key, Socket information of next node, the chainId for the chain node connection
      var node = chainMap[message.chainId],
        iv = cu.generateNonce(),
        dataToEncrypt = {chainData: message.chainData, iv: message.iv};
      console.log("Encrypting and forwarding data to next node: ",node);
      console.log(dataToEncrypt);
      cu.encryptAES(JSON.stringify(dataToEncrypt), node.key, iv).then(function(encData) {
        var con = webrtc.createConnection(node.socket.address, node.socket.port),
          command = {commandName: message.commandName, chainId: node.chainId, iv: iv, chainData: encData};
        return con.send(command);
      }).catch(function(err) {
        // Send error to next node
        var con = webrtc.createConnection(node.socket.address, node.socket.port);
        con.send({commandName: "error", chainId: node.chainId, errorMessage: {message: "Error while encrypting data with AES at intermediate node", error: err}});
      });
    },

    message: function(message, decData, node) {
      var data = JSON.parse(decData);
      var con = webrtc.createConnection(node.socket.address, node.socket.port),
        msg = {commandName: message.commandName, chainData: data.chainData, iv: data.iv, chainId: node.chainId};
      console.log("Sending message to next node: ", {node: node.socket, message: msg});
      return con.send(msg);
    },

    remoteMessage: function(message, decData, node) {
      intermediateNode.message(message, decData, node);
    }
  };

  // object containing all exit node logic
  var exitNode = {
    build: function(message, decryptedJson, unwrappedKey, remoteAddress, remotePort, webRTCConnection) {
      console.log("Received build message as exit node ", decryptedJson);
      // Add chainMap entry, since the current node works as exit node in this chain, we only store the mapping for the "previous" node in the chain.
      chainMap[message.chainId] = {socket: {address: remoteAddress, port: remotePort}, key: unwrappedKey, type: "decrypt"};
      // In order to acknowledge a successful chain build-up we return a build-command message, which contains the encrypted nonce signifying a successful build-up
      var iv = cu.generateNonce();
      cu.encryptAES(JSON.stringify(decryptedJson.data), unwrappedKey, iv).then(function (encData) {
        var command = {commandName: 'build', chainId: message.chainId, iv: iv, chainData: encData};
        console.log("Exit node sending ack command: ", command);
        return webRTCConnection.send(command);
      }).catch(function (err) {
        console.log("Error encrypting data", err);
        sendError("Error encrypting data on exit node " + _localSocket.address + ":" + _localSocket.port,
          err, webRTCConnection, message.chainId);
      });
    },

    message: function(message, node, content, webRTCConnection) {
      console.log("Received message through chain ",content);
      var iv = cu.generateNonce();
      cu.encryptAES("successfully responded to message with content"+JSON.stringify(content), node.key, iv).then(function(encData) {
        var msg = {commandName: message.commandName, chainId: message.chainId, chainData: encData, iv: iv};
        console.log("Sending message: ",msg);
        webRTCConnection.send(msg);
      });
    },

    remoteMessage: function(message, node, content, webRTCConnection) {
      console.log("Received remote message through chain ",content);
      var iv = cu.generateNonce();
      cu.encryptAES("successfully responded to remote message with content"+JSON.stringify(content), node.key, iv).then(function(encData) {
        var msg = {commandName: message.commandName, chainId: message.chainId, chainData: encData, iv: iv};
        console.log("Sending message: ",msg);
        webRTCConnection.send(msg);
      });
    }
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
    console.log("Handle message: ",message);
    var fn = messageHandler[message.commandName];
    if (typeof fn === 'function') {
      fn(message, remoteAddress, remotePort, webRTCConnection);
    } else {
      // handle invalid message commandName
      console.log("Error: Invalid message commandName");
      sendError("Invalid commandName", null, webRTCConnection, message.chainId);
    }
  };

  function resetMasterChain() {
    _createChainPromise = null;
    _isMasterChainCreated = false;
    chainIdMaster = null;
  }

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
          if (chainMap.hasOwnProperty(innerKey) && chainMap[innerKey].chainId == key) {
            var mapEntry = chainMap[innerKey],
              con = webrtc.createConnection(mapEntry.socket.address, mapEntry.socket.port);
            console.log("Propagating peer disconnected error message to next node ",mapEntry);
              sendError("Connection closed", null, con, key).then(function() {
                con.pc.close();
              });
            delete chainMap[innerKey];
          }
        }
        delete chainMap[key];
      }
    }
  };

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

  initOnionSetup();

  return public;
})();