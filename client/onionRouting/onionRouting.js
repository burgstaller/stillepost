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

    }).catch(function(err) {Read
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

  createBuildMessage = function(keys, nodes, exitNodeData, chainIds) {

    var buildLayer = function(key, pubKey, dataToEncrypt) {
        var parsedPubKey = pubKey;
        if (typeof pubKey === "string")
          parsedPubKey = JSON.parse(pubKey);
        return cu.wrapAESKey(key, parsedPubKey).then(function(keyData) {
          console.log("keyData: " + keyData);
          var iv = cu.generateNonce();
          console.log("encrypting data: "+dataToEncrypt);
          return cu.encryptAES(dataToEncrypt, key, iv).then(function(encData) {
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

        // build onion layers of chain build information
        // {commandName: 'build', keyData:E_pn1(sym_key1),
        //      chainData:E_sym_key1(E_pn2(sym_key2) || n2Socket || E_sym_key2(E_pn3(sym_key) || E_pn3(..same same)))}

        // build innermost layer - exit node
        console.log("creating node layer: ",nodes[0]);

        var chainIds = [], i;
        // The client node and exit node only need one increment. However, chainSize excludes the client node, therefore,
        // it is sufficient to generate chainSize*2 increments.
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
          var command = {commandName: 'build', keyData: data.keyData, chainData: data.chainData, iv: data.iv};
          console.log("created command: ", command);

          var con = new webrtc.createConnection(_entryNodeSocket.address, _entryNodeSocket.port),
            promise = new Promise(function(resolve,reject) {
              _masterChainCreated = resolve;
              _masterChainError = reject;
              setTimeout(10000,function() {
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
    cu.encryptAES(JSON.stringify(message), masterChain[0], iv).then(function(encData) {
      var iv2 = cu.generateNonce();
      return cu.encryptAES(JSON.stringify({chainData: encData, iv: iv}), masterChain[1], iv2).then(function(encData) {
        iv = cu.generateNonce();
        return cu.encryptAES(JSON.stringify({chainData: encData, iv: iv2}), masterChain[2], iv).then(function(encData) {
          return cu.hash(cu.uInt32Concat(chainIdMaster, masterSeqNumWrite)).then(function(digest) {
            masterSeqNumWrite += 1;
            var con = webrtc.createConnection(_entryNodeSocket.address, _entryNodeSocket.port),
              msg = {commandName: commandName, chainData: encData, iv: iv, chainId: digest};
            return con.send(msg).then(function() {
              console.log("Successfully sent message to entry node ",msg);
            });
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
    return unwrapMessage(message).then(function(decData) {
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
   * @param message
   */
  handleMessageResponse = function(message) {
    return unwrapMessage(message).then(function (decData) {
      console.log("decrypted data: ", decData);
    }).catch(function(err) {
      console.log("error decrypting data",err);
    });
  };

  public.sendMessageToRemoteChain = function(message, address, port, chainId) {
    var msg = {message: message, chainId: chainId, socket: {address: address, port: port}};
    sendMessage("remoteMessage", msg);
  };

  //interface function to generically send a new message over the master chain
  public.sendMessage = function(message) {
    sendMessage("message",message);
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
        sendChainMessage(commandName, message);
      }).catch(function(err) {
        // todo: handle error
        console.log("error creating chain: ",err);
        resetMasterChain();
      });
    } else {
      // send message over chain
      sendChainMessage(commandName, message);
    }
  }

  function sendError(errorMessage, errorObj, connection, chainId) {
    console.log(errorMessage);
    var node = chainMap[chainId];
    if (node && node.socket.address) {
      return cu.hash(cu.uInt32Concat(node.chainIdOut, node.seqNumWrite)).then(function(digest) {
        var errorMsg = {
          commandName: 'error',
          chainId: digest,
          errorMessage: {
            message: errorMessage,
            error: errorObj || {}
          }
        };
        return connection.send(errorMsg);
      });
    } else if (connection) {
      connection.close();
    }
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
            err, webRTCConnection);
        });
      }
      else {
        updateChainMap(message, webRTCConnection).then(function(result) {
          if (!result.node) {
            // we received ack message as master of the chain - validate content
            handleBuildResponse(result.message);
          } else {
            // intermediate node logic: Encrypt and forward build message response.
            intermediateNode.wrapMessage(result.message, result.node, result.webRTCConnection);
          }
        });
      }
    },

    error: function(message, remoteAddress, remotePort, webRTCConnection) {
      if (message.chainId && message.chainId == masterHash) {
        console.log("Received error commandMessage - destroying chain ",message.errorMessage.error);
        _masterChainError(message.errorMessage.message);
        resetMasterChain();
        webRTCConnection.close();
      } else {
        // we are not an endpoint node and need to forward the error message
        var node = chainMap[message.chainId];
        if (node && node.socket.address) {
          cu.hash(cu.uInt32Concat(node.chainIdOut, node.seqNumWrite)).then(function(digest) {
            var con = webrtc.createConnection(node.socket.address, node.socket.port);
            return con.send({commandName: "error", chainId: digest, errorMessage: message.errorMessage}).then(function() {
              webRTCConnection.close();
            });
          });
        } else {
          console.log("Received error commandMessage from " + remoteAddress.address + ":" + remotePort.port,message.errorMessage.message);
        }
      }
    },

    message: function(message, remoteAddress, remotePort, webRTCConnection) {
      if (message.chainId === masterHash) {
        handleMessageResponse(message);
      } else {
        queue.add(wrapFunction(updateChainMap, this, [message, webRTCConnection]));
      }
    },

    messageCallback: function(message) {
      if (message.node) {
        if (message.node.type === "decrypt") {
          intermediateNode[message.message.commandName](message.message, message.node, message.webRTCConnection);
        } else if (message-node.type === "exit") {
          exitNode[message.message.commandName](message.message, message.node, message.webRTCConnection);
        } else {
          intermediateNode.wrapMessage(message.message, message.node, message.webRTCConnection);
        }
      } else {
        sendError("Received invalid chainId", null, message.webRTCConnection);
      }
    },

    remoteMessage: function(messageParam, remoteAddress, remotePort, webRTCConnection) {
      messageHandler.message(messageParam, remoteAddress, remotePort, webRTCConnection);
    }
  };

  var queue = {
    entries: [],
    busy: false,
    add: function(func) {
      if (this.entries.length > 0 || this.busy)
        this.entries.push(func);
      else {
        this.busy = true;
        func().then(this.processMessage);
      }
    },
    shift: function() {
      if (queue.entries.length > 0) {
        (queue.entries.shift())().then(this.processMessage);
      } else {
        this.busy = false;
      }
    },
    processMessage: function(message) {
      messageHandler.messageCallback(message);
      queue.shift();
    }
  };

  // Function wrapping code.
  // fn - reference to function.
  // context - what you want "this" to be.
  // params - array of parameters to pass to function.
  var wrapFunction = function(fn, context, params) {
    return function() {
      return fn.apply(context, params);
    };
  };

  function updateMasterHash(message, webRTCConnection) {
    var promise = new Promise(function(resolve, reject) {
      masterSeqNumRead += 1;
      cu.hash(cu.uInt32Concat(chainIdMaster, masterSeqNumRead)).then(function(digest) {
        masterHash = digest;
        resolve({message: message, con: webRTCConnection});
      }).catch(function(err) {
        reject(err);
      });
    });
    return promise;
  }

  function updateChainMap(message, webRTCConnection) {
    if (message.chainId === masterHash) {
      return updateMasterHash(message, webRTCConnection);
    }
    return new Promise(function(resolve, reject) {
      var node = chainMap[message.chainId];
      if (node) {
        node.seqNumRead += 1;
        cu.hash(cu.uInt32Concat(node.chainIdIn, node.seqNumRead)).then(function (digest) {
          chainMap[digest] = node;
          delete chainMap[message.chainId];
          resolve({message: message, node: node, con: webRTCConnection});
        }).catch(function(err) {
          reject(err);
        });
      } else {
        reject("Received invalid chainId");
        sendError("Received invalid chainId", null, webRTCConnection);
      }
    });
  }


    function encWorkerListener(workerMessage, webRTCConnection, iv, node, message){
        if(workerMessage.data.success){
            //send enc. data to next node
            cu.hash(cu.uInt32Concat(node.chainIdOut, node.seqNumWrite++)).then(function(digest) {
                var con = webrtc.createConnection(node.socket.address, node.socket.port),
                    command = {commandName: message.commandName, chainId: digest, iv: iv, chainData: workerMessage.data.data};
                return con.send(command);
            }).catch(function (error){
                //error callback for hash operation
                // Send error to next node
                webRTCConnection.close();
            });
        }else{
            //error callback for encryption
            // Send error to next node
            cu.hash(cu.uInt32Concat(node.chainIdOut, node.seqNumWrite++)).then(function(digest) {
                var con = webrtc.createConnection(node.socket.address, node.socket.port);
                //in encryption (or exit node) case send error to next node in chain
                return con.send({commandName: "error", chainId: digest, errorMessage: {message: "Error while forwarding message at intermediate node", error: workerMessage.data.data}});
            }).catch(function (error){
                //error callback for hash operation
                // Send error to next node
                webRTCConnection.close();
            });
        }
    }



  function decWorkerListener(workerMessage, webRTCConnection, node, message){
    if(workerMessage.data.success){
      //send enc. data to next node
      cu.hash(cu.uInt32Concat(node.chainIdOut, node.seqNumWrite++)).then(function(digest) {
      workerMessage.data.data = JSON.parse(workerMessage.data.data);

        var con = webrtc.createConnection(node.socket.address, node.socket.port),
          command = {commandName: message.commandName, chainId: digest, iv:  workerMessage.data.data.iv, chainData: workerMessage.data.data.chainData};
        return con.send(command);
      }).catch(function (error){
        //error callback for hash operation
        // Send error to next node
        webRTCConnection.close();
      });
    }else{
      // Send error to next node
      cu.hash(cu.uInt32Concat(node.chainIdOut, node.seqNumWrite++)).then(function(digest) {
        var con = webrtc.createConnection(node.socket.address, node.socket.port);
        //in decryption case send error to previous node in chain
        return webRTCConnection.send({commandName: "error", chainId: digest, errorMessage: {message: "Error while forwarding message at intermediate node", error: workerMessage.data.data}});
      }).catch(function (error){
        //error callback for hash operation
        // Send error to next node
        webRTCConnection.close();
      });
    }
  }

  // object containing all intermediate node logic
  var intermediateNode = {
    build: function(message, content, unwrappedKey, remoteAddress, remotePort, webRTCConnection) {
      console.log("Sending build command to next node: ", content.nodeSocket);
      content.chainIdIn = objToAb(content.chainIdIn);
      content.chainIdOut = objToAb(content.chainIdOut);
      cu.hashArrayObjects([cu.uInt32Concat(content.chainIdIn, 1), cu.uInt32Concat(content.chainIdOut, 1)]).then(function(digestArray) {
        // add entries to chainMap - which maps a chainId to a specific chain
        // entry for master -> exitNode direction
        chainMap[digestArray[0]] = {socket: content.nodeSocket, key: unwrappedKey, chainIdIn: content.chainIdIn, seqNumRead: 1,
          chainIdOut: content.chainIdOut, seqNumWrite: 1, type: "decrypt"};
        // entry for exitNode -> master direction
        chainMap[digestArray[1]] = {
          socket: {address: remoteAddress, port: remotePort},
          key: unwrappedKey,
          chainIdIn: content.chainIdOut,
          seqNumRead: 1,
          chainIdOut: content.chainIdIn,
          seqNumWrite: 1,
          type: "encrypt"
        };

        var buildMessage = {
          commandName: 'build',
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
          content.nodeSocket.address + ":" + content.nodeSocket.port, err, webRTCConnection, content.chainIdIn);
        });
      });
    },

    /**
     * Entry or intermediate node logic: Encrypt and forward message.
     * This logic represents the back-traversal of the message response from exit node to chain master node
     * Schematic representation of the message, which is generated.
     * message = {chainData: E_aesNode(message.chainData, message.iv), iv: <newly generated nonce>]
     * @param message ... the message JSON object received via webRTC
     * @param webRTCConnection
     * @param node
     */
    wrapMessage: function(message, node, webRTCConnection) {
      var iv = cu.generateNonce(),
        dataToEncrypt = {chainData: message.chainData, iv: message.iv};
      console.log("Encrypting and forwarding data to next node: ",node);
      console.log(dataToEncrypt);

      var encWorker = new Worker('onionRouting/encryptionWorker.js');
      encWorker.postMessage({iv:iv, key:node.key, data:JSON.stringify(dataToEncrypt)});

      encWorker.onmessage = function(workerMessage){
        encWorkerListener(workerMessage, webRTCConnection, iv, node, message);
      };

/*
      return cu.encryptAES(JSON.stringify(dataToEncrypt), node.key, iv).then(function(encData) {
        node.seqNumWrite += 1;
        return cu.hash(cu.uInt32Concat(node.chainIdOut, node.seqNumWrite-1)).then(function(digest) {
          var con = webrtc.createConnection(node.socket.address, node.socket.port),
            command = {commandName: message.commandName, chainId: digest, iv: iv, chainData: encData};
          return con.send(command);
        });
      }).catch(function(err) {
        // Send error to next node
        var con = webrtc.createConnection(node.socket.address, node.socket.port);
        con.send({commandName: "error", chainId: node.chainId, errorMessage: {message: "Error while forwarding message at intermediate node", error: err}});
      });*/
    },

    message: function(message, node, webRTCConnection) {
      var iv = objToAb(message.iv);

      var decWorker = new Worker('onionRouting/decryptionWorker.js');
      decWorker.postMessage({iv:iv, key:node.key, data:message.chainData});

      decWorker.onmessage = function(workerMessage){
          decWorkerListener(workerMessage, webRTCConnection, node, message);
      };



    /*return cu.decryptAES(message.chainData, node.key, iv).then(function (decData) {
        var data = JSON.parse(decData),
          // todo: calculate chainId hash for next node
            digest = null;
        var con = webrtc.createConnection(node.socket.address, node.socket.port),
          msg = {commandName: message.commandName, chainData: data.chainData, iv: data.iv, chainId: digest};
        console.log("Sending message to next node: ", {node: node.socket, message: msg});
        delete chainMap[message.chainId];
        return con.send(msg);
      }).catch(function (err) {
        console.log("Error while decrypting: ", err);
        sendError("Error while processing message at node " +
        _localSocket.address + ":" + _localSocket.port, err, webRTCConnection, node.chainId);
      });*/
    },

    remoteMessage: function(message, decData, node) {
      intermediateNode.message(message, decData, node);
    }
  };

  // object containing all exit node logic
  var exitNode = {
    build: function(message, content, unwrappedKey, remoteAddress, remotePort, webRTCConnection) {
      console.log("Received build message as exit node ", content);
      content.chainId = objToAb(content.chainId);
      cu.hashArrayObjects([cu.uInt32Concat(content.chainId, 1), cu.uInt32Concat(content.chainId, 1)]).then(function(digestArray) {
        // Add chainMap entry, since the current node works as exit node in this chain, we only store the mapping for the "previous" node in the chain.
        chainMap[digestArray[0]] = {socket: {address: remoteAddress, port: remotePort}, key: unwrappedKey, chainIdIn: content.chainId, chainIdOut: content.chainId,
          seqNumRead: 1, seqNumWrite: 2, type: "exit"};
        // In order to acknowledge a successful chain build-up we return a build-command message, which contains the encrypted nonce signifying a successful build-up
        var iv = cu.generateNonce();
        return cu.encryptAES(JSON.stringify(content.data), unwrappedKey, iv).then(function (encData) {
          var command = {commandName: 'build', chainId: digestArray[1], iv: iv, chainData: encData};
          console.log("Exit node sending ack command: ", command);
          return webRTCConnection.send(command);
        });
      }).catch(function (err) {
        console.log("Error at exit node", err);
        sendError("Error handling data on exit node " + _localSocket.address + ":" + _localSocket.port,
          err, webRTCConnection, content.chainId);
      });

    },

    message: function(message, node, webRTCConnection) {
      var iv = objToAb(message.iv);

      return cu.decryptAES(message.chainData, node.key, iv).then(function (decData) {
        var data = JSON.parse(decData);
        console.log("Received message through chain ", data);
        var iv = cu.generateNonce();
        return cu.encryptAES("successfully responded to message with content"+JSON.stringify(data), node.key, iv).then(function(encData) {
          // todo: calculate chainId hash for next node
          var digest = null,
            msg = {commandName: message.commandName, chainId: digest, chainData: encData, iv: iv};
          console.log("Sending message: ",msg);
          webRTCConnection.send(msg);
        });
      }).catch(function (err) {
        console.log("Error while decrypting: ", err);
        sendError("Error while processing message at node " +
        _localSocket.address + ":" + _localSocket.port, err, webRTCConnection, node.chainId);
      });
    },

    remoteMessage: function(message, node, content, webRTCConnection) {
      console.log("Received remote message through chain ",content);
      var exitNode = JSON.parse(content),
          con = webrtc.createConnection(exitNode.socket.address, exitNode.socket.port);
      con.send({commandName: message.commandName, chainData: exitNode.message, chainId: exitNode.chainId, mode: "forward"});
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
      sendError("Invalid commandName", null, webRTCConnection);
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
                con.close();
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