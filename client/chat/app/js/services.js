'use strict';

/* Services */

var chatServices = angular.module('chatServices', ['ngResource']);

chatServices.factory('ChatServer', ['$resource',
  function($resource){
          var _sessionKey = null,
          _privateKey = null,
          _publicKey = null,
          _publicKeyHash = null,
          _chainId = null,
          _socket = null,
          _username = null,
          _chatServerUrl = null,
          _users = {},
          _connections = {},
          _heartbeatInterval = 3000,
          _chatObject = null,
          oi = null,
          cu = null;

      function login(successCallback){
          var xhr = new XMLHttpRequest();
          xhr.onload = function () {
              console.log("chat: login SUCCESS");

              var response = JSON.parse(this.responseText);
              _sessionKey = response.data.sessionKey;
              cu.hash(_publicKey).then(function(data){
                  _publicKeyHash = data;
                  if(typeof(successCallback) !== "undefined")
                      successCallback(response);
              });
          };
          xhr.onerror = function(e) {
              console.log("chat: login FAILURE:");
              console.log(e.target);
          };
          xhr.open("post", _chatServerUrl + "/user", true);
          xhr.send(JSON.stringify({"key":_publicKey,"username":_username,"chainid":_chainId,"socket":_socket}));
      }

      function getUserList(successCallback){
          var xhr = new XMLHttpRequest();
          xhr.onload = function () {
              var response = JSON.parse(this.responseText);
              //console.log("chat: getUserList SUCCESS");
              if(typeof(successCallback) !== "undefined")
                  successCallback(response);
          };
          xhr.onerror = function(e) {
              console.log("chat: getUserList FAILURE:");
              console.log(e.target);
          };
          xhr.open("get", _chatServerUrl + "/user?sessionKey="+encodeURIComponent(_sessionKey)+"&keyHash="+encodeURIComponent(_publicKeyHash).replace(/%00/g, "customnullbyte"), true);
          xhr.send();
      }

      function sendHeartbeat(successCallback){
          var xhr = new XMLHttpRequest();
          xhr.onload = function () {
              var response = JSON.parse(this.responseText);
              //console.log("chat: sendHeartbeat SUCCESS");
              if(typeof(successCallback) !== "undefined")
                  successCallback(response);
          };
          xhr.onerror = function(e) {
              console.log("chat: sendHeartbeat FAILURE:");
              console.log(e.target);
          };
          xhr.open("put", _chatServerUrl + "/user/"+encodeURIComponent(_publicKeyHash).replace(/%00/g, "customnullbyte")+"?sessionKey="+encodeURIComponent(_sessionKey), true);
          xhr.send();
      }

      function mergeNewUsers(newUsers){
          // loop over all new usres
          for(var u in newUsers){
              if (newUsers.hasOwnProperty(u)){
                  // if user is new, add him to local object
                  // otherwise, merge attributes
                  if(typeof(_users[u]) === "undefined"){
                      _users[u] = newUsers[u];
                  } else {
                      // merge attributes
                      for(var attr in newUsers[u]){
                          if (newUsers[u].hasOwnProperty(attr)){
                              _users[u][attr] = newUsers[u][attr];
                          }
                      }
                  }
              }
          }
      }

      return {
          /*
           params
           - username: optional
           - privateKey: required
           - publicKey: required
           - chatServerUrl: optional#

           returns chatObject in successCallback: the object with which the ui interacts
           */
          getChatObject: function(){
              return _chatObject;
          },
          getUsers: function(){
              return _users;
          },

          getUsername: function(){
            return _username;
          },

          init: function(params, successCallback){
              // read params
              if(typeof(params) !== "object"){
                  console.log("chat: INIT FAILURE - no params");
                  return
              }
              _username = typeof(params.username) !== "string" ? "test" : params.username;
              if(typeof(params.privateKey) === "undefined" || typeof(params.publicKey) ==="undefined"){
                  console.log("chat: INIT FAILURE - no keys");
              } else {
                  _privateKey = params.privateKey;
                  _publicKey = params.publicKey;
              }
              _chatServerUrl = typeof(params.chatServerUrl) !== "string" ? "http://127.0.0.1:42112" : params.chatServerUrl;

              // set vars
              cu = window.stillepost.cryptoUtils;
              oi = window.stillepost.onion.interfaces;
              _chainId = oi.getPublicChainInformation().chainId;
              _socket = oi.getPublicChainInformation().socket;

              // init commands
              oi.setupClientConnections(_privateKey, _publicKey);


              login(function(response){

                  // start heartbeats
                  setInterval(sendHeartbeat, _heartbeatInterval);
                  _chatObject = {
                      // methods
                      updateUserList: function () {
                          getUserList(function(response){
                              //_users = response.data;
                              mergeNewUsers(response.data);

                              _chatObject.onUserListUpdate(_users);
                          });
                      },
                      sendMessage: function(user, message){
                          if(typeof(_connections[user.hash]) === "undefined"){
                              _connections[user.hash] = oi.createClientConnection(user.socket.address, user.socket.port, user.chainid, user.key, true);
                              _connections[user.hash].onmessage = function(msg){_chatObject.onReceiveMessage(msg, user);};
                          }
                          _connections[user.hash].send(message, function() {console.log('successcallback called');},
                              function() {console.error('errorcallback called');});
                      },

                      // events
                      onUserListUpdate: function(users){},
                      onReceiveMessage: function(msg, user){},

                      // kinda private event TODO refactor
                      onClientConnected: function(connection){
                          cu.hash(connection.publicKey).then(function(publicKeyHash){
                              if(typeof(_users[publicKeyHash]) === "undefined"){
                                  getUserList(function(response){
                                      //_users = response.data;
                                      mergeNewUsers(response.data);
                                      _chatObject.onUserListUpdate(_users);
                                      if(typeof(_users[publicKeyHash]) === "undefined"){
                                          console.log("chat: onClientConnected FAILURE no such user registered");
                                          return;
                                      }
                                      _connections[publicKeyHash] = connection;
                                      _connections[publicKeyHash].onmessage = function(msg){_chatObject.onReceiveMessage(msg, _users[publicKeyHash]);};
                                  });
                              } else {
                                  // TODO: is this really correct? (probably not)
                                  _connections[publicKeyHash] = connection;
                                  _connections[publicKeyHash].onmessage = function(msg){_chatObject.onReceiveMessage(msg, _users[publicKeyHash]);};
                              }
                          });
                      }
                  };
                  oi.onClientConnection = _chatObject.onClientConnected;
                  if(typeof(successCallback) === "function")
                      successCallback(_chatObject);
              });
          }
      };
  }]);
