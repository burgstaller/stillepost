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
    _uuid = null,
    _localSocket = {},

  //Id of the chain in which this node is the master
  chainIdMaster = null,

  //sym keys of all nodes of the chain in which this node is the master
  masterChain = null,

  //map of all node-neighbours with socket and key info
  chainMap = {},

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
      if (nodeList[index].socket.address === _localSocket.address && nodeList[index].socket.port === _localSocket.port) {
        continue;
      }
      // Since we need to ensure, that we select a specific node only once, we store already selected nodes in an array
      // and each time check, if the random node was already selected (== is in the array).
      for (var i=0; i < indexArray.length; i++) {
        if (indexArray[i] === index) {
          found = true;
          break;
        }
      }
      if (found)
        continue;
      indexArray.push(index);
      nodes.push(nodeList[index]);
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
          // todo: choose nodes
          nodeList = chooseNodes(nodeList);
          resolve(nodeList);
        } else {
          reject("Server did no responded with OK "+serverMessage.msg);
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
      //generate new sym keys
      return cu.getGeneratedAESKeys(chainSize).then(function(keys) {
        console.log("AES-keys: ", keys);
        masterChain = keys;

        // build onion layers of chain build information
        // {commandName: 'build', keyData:E_pn1(sym_key1),
        //      chainData:E_sym_key1(E_pn2(sym_key2) || n2Socket || E_sym_key2(E_pn3(sym_key) || E_pn3(..same same)))}

        // build innermost layer - exit node
        console.log("creating node layer: ",nodes[0]);
        var dataExitNode = "ensure that this data is the same size as the chainData for other sockets";
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
              var command = {commandName: 'build', keyData: layerDataEntry.keyData, chainData: layerDataEntry.chainData, iv: layerDataEntry.iv,
                chainId: chainIdMaster};
              console.log("created command: ", command);

              var con = new webrtc.createConnection(nodes[2].socket.address, nodes[2].socket.port);
              con.send(command);
              return new Promise(function(resolve,reject) {
                _masterChainCreated = resolve;
                _masterChainError = reject;
                setTimeout(30000,function() {
                  if (!_isMasterChainCreated) {
                    reject("Create chain Timeout");
                  }
                });
              });
            });
          });
        }, function (err) {
          console.log("Error while building layers", err);
        });
      }, function(err) {
        console.log("Error while generating AES keys",err);
      });
    }, function(err) {
      console.log("Error while retrieving nodes",err);
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

  // convert an javascript of type object to type arraybuffer
  objToAb = function(obj) {
    var newArray = new Uint8Array(16), i=0;
    for (var key in obj) {
      newArray[i++] = obj[key];
    }
    return newArray;
  },

  //is called when node is intermediate to add another node to the current (to be created) chain
  addNodeToChain = function(){

  };

  //interface function to generically send a new message over the master chain
  public.sendMessage = function(message) {
    // init chain
    if (!masterChain) {
      createChain().then(function () {
        console.log("created Chain");
        _isMasterChainCreated = true;
      }).catch(function(err) {
        //todo error handling
        console.log("error creating chain: ",err);
      });
    } else {
      // send message over chain
    }
  };

  /**
   * Interface function called by WebRTC to handle an incoming onion request.
   * A message type is identified by the "commandName" attribute.
   * Following commandNames are supported:
   *  - build ... command used for chain build-up (send from chain master to exitNode)
   *  - buildAck ... command used to acknowledge (send from exitNode to chain master)
   *  - ajaxRequest ... command used to send an ajax-Request via the chain
   *  - connect ... command used to connect to a specific node via the chain (The exitNode of the chain initiates a webRTC connection to the specified node)
   * @param message the message that was send via webrtc
   * @param remoteAddress Address of the remote peer who send the message
   * @param remotePort Port of the remote peer who send the message
   */
  public.handleMessage = function(message, remoteAddress, remotePort) {
    console.log("Handle message: ",message);
    if (message.commandName === 'ajaxRequest') {
      // handle AJAX request

    }
    // handle build chain command
    else if (message.commandName === 'build') {
      console.log("Handle build message - going to decrypt");
      var iv = objToAb(message.iv);
      console.log("iv: ",iv);

      cu.unwrapAESKey(message.keyData).then(function(unwrappedKey) {
        return cu.decryptAES(message.chainData, unwrappedKey, iv).then(function(decData) {
            var decryptedJson = JSON.parse(decData);
            console.log("Decrypted data: ", decryptedJson);
            if (decryptedJson.nodeSocket) {
              // send to next socket
              console.log("Sending build command to next node: ",decryptedJson.nodeSocket);
              var chainId = createChainId();
              // add entries to chainMap - which maps a chainId to a specific chain
              // a chain consists of following information:
              //  - node socket ... the socket of the next node in the chain,
              //  - AES-Key ... the key with which data is en- and decrypted (shared with the creator of the chain),
              //  - chainId .. the chainId for the next node in the chain. On Receiving the message, the next needs this chainId in order to be able to get the chain information.
              chainMap[message.chainId] = {socket: decryptedJson.nodeSocket, key: unwrappedKey, chainId: chainId};
              chainMap[chainId] = {socket: {address: remoteAddress, port: remotePort}, key: unwrappedKey, chainId: message.chainId};
              var ivNode1 = objToAb(decryptedJson.data.iv);
              var messageNode1 = {commandName:'build', chainId: chainId, iv: ivNode1, keyData: decryptedJson.data.keyData,
                chainData: decryptedJson.data.chainData};
              console.log("Comman[object Object]d to send: ",messageNode1);
              // Create webrtc connection with next node in the chain and send the data
              var con = webrtc.createConnection(decryptedJson.nodeSocket.address, decryptedJson.nodeSocket.port);
              con.send(messageNode1);
            } else {
              // exit node logic - respond with buildAck message
              console.log("Received build message as exit node");
              // Add chainMap entry, since the current node works as exit node in this chain, we only store the mapping for the "previous" node in the chain.
              chainMap[message.chainId] = {socket: {address: remoteAddress, port: remotePort}, key: unwrappedKey};
              // In order to acknowledge a successful chain build-up we send an buildAck-command, which contains encrypted data signifying a successful build-up
              var data = "success",
                iv = cu.generateNonce();
              cu.encryptAES(data,unwrappedKey,iv).then(function(encData) {
                var con = webrtc.createConnection(remoteAddress, remotePort),
                  command = {commandName:'buildAck', chainId: message.chainId, iv: iv, chainData: encData};
                console.log("Exit node sending ack command: ",command);
                con.send(command);
              });
            }
          });
      }).catch(function(err) {
        // todo: handle error
        console.log("Error decrypting data",err);
      });
    }
    // Handle ack message (return message from exit node as answer to build message)
    // Schematic representation of layered buildAck message
    // E_aesNode1( E_aesNode2( E_aesExitNode(confirmData), IV_exitNode ), IV_node2), IV_node1
    else if(message.commandName === "buildAck") {
      // todo: decrypt and validate content
      console.log("Received buildAck message command");

      // we received ack message as master of the chain - validate content
      if (message.chainId === chainIdMaster) {
        var iv = objToAb(message.iv), data = null;
        cu.decryptAES(message.chainData, masterChain[2], iv).then(function (decDataNode1) {
          data = JSON.parse(decDataNode1);
          iv = objToAb(data.iv);
          console.log("decrypted first layer: ", data);
          return cu.decryptAES(data.chainData, masterChain[1], iv).then(function (decDataNode2) {
            data = JSON.parse(decDataNode2);
            iv = objToAb(data.iv);
            console.log("decrypted 2nd layer: ", data);
            return cu.decryptAES(data.chainData, masterChain[0], iv).then(function (decDataExitNode) {
              // todo: validate decrypted data
              console.log("Received message from exit node: ",decDataExitNode);
              _masterChainCreated();
            });
          });
        }).catch(function(err) {
          //todo: error handling
          console.log("Error decrypting buildAck command at chainMaster: ",err);
          _masterChainError(err);
        });
      }
      // intermediate node logic: encrypt and forward ack message.
      // Schematic representation of the message, which is generated.
      // message = {data: E_aesNode(message.data, message.iv), iv: <newly generated nonce>]
      else {
        // Retrieve the chainMap entry which contains the AES-Key, Socket information of next node, the chainId for the chain node connection
        var node = chainMap[message.chainId],
          iv = cu.generateNonce(),
          dataToEncrypt = {chainData: message.chainData, iv: message.iv};
        console.log("Intermediate node encrypting data: ",dataToEncrypt);
        cu.encryptAES(JSON.stringify(dataToEncrypt), node.key, iv).then(function(encData) {
          var con = webrtc.createConnection(node.socket.address, node.socket.port),
            command = {commandName: "buildAck", chainId: node.chainId, iv: iv, chainData: encData};
          con.send(command);
        });

      }

    } else {
      // handle invalid message commandName
      console.log("Error: Invalid message commandName");
    }
  };

  initOnionSetup();

  return public;
})();