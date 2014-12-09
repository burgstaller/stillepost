window.stillepost = window.stillepost || {};
window.stillepost.onion = (function() {
  var public = {},
    cu = window.stillepost.cryptoUtils,
    webrtc = window.stillepost.webrtc,
    chainSize = 3,

    //todo: remove static node list - only for test purposes
    nodeList = [],

  //Id of the chain in which this node is the master
  chainIdMaster = null,

  //sym keys of all nodes of the chain in which this node is the master
  masterChain = null,

  //map of all node-neighbours with socket and key info
  chainMap = null,

  //generate RSA keypair and send public key to directory server
  initOnionSetup = function(){
    cu.getGeneratedPublicKey().then(function(pubKey) {
      // todo: send pubKey to server
      console.log("Generated pubKey: "+pubKey);
    }).catch(function(err) {
      console.log("Error generating public RSA Key", err);
    });
  },

  //requests list of nodes from server and chooses nodes
  retrieveNodes = function() {
    //TODO request and choose nodes

    //todo: remove dummy objects - only for testing purposes
    var keyPairPromises = [];
    for(var i = 0; i < chainSize; i++) {
      keyPairPromises.push(cu.getGeneratedRSAKeyPair());
    }
    return Promise.all(keyPairPromises).then(function(keyPairs) {
      console.log('keyPairs: ', keyPairs);
      var nodes = [];
      for (var i = 0; i< keyPairs.length; i++) {
        nodes[i] = {};
        nodes[i].privKey = keyPairs[i].privateKey;
        nodes[i].pubKey = JSON.parse(keyPairs[i].publicKey);
        nodes[i].socket = {peer: "127.0.0.1", port:1337};
      }
      return nodes;
    });
  },

  createLayer = function(key, pubKey, data, pubKeyNextNode, socket) {
    return cu.wrapAESKey(key, pubKey).then(function(keyData) {
      console.log("keyData: " + keyData);
      var iv = cu.generateNonce(),
        dataToEncrypt = null;

      if (pubKeyNextNode) {
        // create intermediate node layer
        dataToEncrypt = JSON.stringify({nodeSocket: socket, nodePubKey: pubKeyNextNode, iv: iv, data: data});
      } else {
        // create exit node layer
        dataToEncrypt = JSON.stringify({iv: iv, data: data});
      }
      console.log("encrypting data: "+dataToEncrypt);
      return cu.encryptAES(dataToEncrypt, key, iv).then(function(encData) {
        return {keyData: keyData, chainData:encData, iv:iv};
      });
    });
  },

  //requests list of nodes, creates 'create' request and sends it to the first node in the chain (waits for ack from exit node)
  createChain = function(){

    return retrieveNodes().then(function(nodes) {
      console.log('nodes: ', nodes);
      nodeList = nodes;
      //generate new sym keys
      return cu.getGeneratedAESKeys(chainSize).then(function(keys) {
        console.log("AES-keys: ", keys);
        masterChain = keys;

        //encrypt build command n-1 times

        // build onion layers of chain build information
        // {commandName: 'build', keyData:E_pn1(sym_key1),
        //      chainData:E_sym_key1(E_pn2(sym_key2) || n2Socket || n2Pub || E_sym_key2(E_pn3(sym_key) || E_pn3(..same same)))}

        // todo: encrypt iv?
        // todo: why does node1 need pubKey of node2? (same with node2 - node3)

        // build innermost layer - exit node
        var dataExitNode = "ensure that this data is the same size as the chainData for other sockets";
        return createLayer(keys[0], nodes[0].pubKey, dataExitNode).then(function(layerDataExit) {
          // build second innermost layer - node2
          // This is the encrypted Exit Node Data which is again encrypted
          var intermediateData = {keyData: layerDataExit.keyData, chainData: layerDataExit.chainData, iv: layerDataExit.iv};
          return createLayer(keys[1], nodes[1].pubKey, intermediateData, nodes[0].pubKey, nodes[0].socket).then(function(layerDataIntermediate) {

            // build third layer - entry node
            var entryNodeData = {keyData: layerDataIntermediate.keyData, chainData: layerDataIntermediate.chainData, iv: layerDataIntermediate.iv};
            return createLayer(keys[2], nodes[2].pubKey, entryNodeData, nodes[1].pubKey, nodes[1].socket).then(function(layerDataEntry) {
              var command = {commandName: 'build', keyData: layerDataEntry.keyData, chainData: layerDataEntry.chainData, iv: layerDataEntry.iv};
              console.log("created command: ", command);

              //todo:remove this line - only for testing purposes - we fake retrieving message from other node in order to validate encryption
              public.handleMessage(command);

              //todo: send via webrtc and wait for response
              //var con = new webrtc.createConnection(nodes[0].socket.peer, nodes[0].socket.port);
              //con.send(command);
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

  //is called when node is intermediate to add another node to the current (to be created) chain
  addNodeToChain = function(){

  };

  //interface function to generically send a new message over the master chain
  public.sendMessage = function(message) {
    // init chain
    if (!masterChain) {
      createChain().then(function () {
        console.log("created Chain");
      }).catch(function(err) {
        //todo error handling
        console.log("error creating chain: ",err);
      });
    } else {
      // send message over chain
    }
  };

  //interface function called by WEBRtc to handle an incoming onion request
  public.handleMessage = function(message) {
    console.log("Handle message: ",message);
    if (message.commandName === 'build') {
      // handle build chain command
      console.log("Handle build message - going to decrypt");

      // Todo: Since we fake being a node while testing - we use test function instead of cu.decryptAES
      cu.testDecryptAES(message.chainData, message.keyData, message.iv, nodeList[2].privKey).then(function(decData) {
        var decryptedJson = JSON.parse(decData);
        console.log("Decrypted data: ", decryptedJson);
        if (decryptedJson.nodeSocket) {
          // send to next socket
          console.log("Sending build command to next node: ",decryptedJson.nodeSocket);
        } else {
          // exit node logic - return "OK"-message?

        }
      }).catch(function(err) {
        // todo: handle error
        console.log("Error decrypting data",err);
      });

    } else if (message.commandName === 'ajaxRequest') {
      // handle AJAX request
    } else {
      // handle invalid message commandName
    }
  };

  initOnionSetup();

  return public;
})();