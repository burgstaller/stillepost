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
          _loggedIn = false,
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
                  _loggedIn = true;
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
              console.log("chat: sendHeartbeat FAILURE, disconnected:");
              console.log(e.target);
              _loggedIn = false;
          };
          xhr.open("put", _chatServerUrl + "/user/"+encodeURIComponent(_publicKeyHash).replace(/%00/g, "customnullbyte")+"?sessionKey="+encodeURIComponent(_sessionKey), true);
          xhr.send();
      }

      function logout(successCallback, errorCallback){
          var xhr = new XMLHttpRequest();
          xhr.onload = function () {
              var response = JSON.parse(this.responseText);
              //console.log("chat: logout SUCCESS");
              _loggedIn = false;
              if(typeof(successCallback) !== "undefined")
                  successCallback(response);
          };
          xhr.onerror = function(e) {
              console.log("chat: logout FAILURE:");
              console.log(e.target);
              if(typeof(errorCallback) !== "undefined")
                  errorCallback(response);
          };
          xhr.open("delete", _chatServerUrl + "/user/"+encodeURIComponent(_publicKeyHash).replace(/%00/g, "customnullbyte")+"?sessionKey="+encodeURIComponent(_sessionKey), true);
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
                      // check for reconnect
                      // a reconnect happened when we witnessed a logout and login (flag disconnected)
                      // or when one of the connection properties changed (address, port, or chainid)
                      if((typeof(_users[u].disconnected) !== "undefined" && _users[u].disconnected === true)||
                        (_users[u].socket.address !== newUsers[u].socket.address ||
                        _users[u].socket.port !== newUsers[u].socket.port ||
                        _users[u].socket.chainid !== newUsers[u].socket.chainid)){
                          _users[u].disconnected = false;
                          _users[u].reconnected = true;
                          _users[u].reestablishConnection = true;
                      }
                      // merge attributes
                      for(var attr in newUsers[u]){
                          if (newUsers[u].hasOwnProperty(attr)){
                              _users[u][attr] = newUsers[u][attr];
                          }
                      }

                  }
              }
          }
          // check for disconnected users
          for(var u in _users){
              if (_users.hasOwnProperty(u)){
                  // if user is not registered on server anymore, he disconnected
                  if(typeof(newUsers[u]) === "undefined"){
                      _users[u].disconnected = true;
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

          getPublicKey: function(){
              return _publicKey;
          },

          getPrivateKey: function(){
              return _privateKey
          },

          logout: logout,
          login: login,

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
              _chatServerUrl = typeof(params.chatServerUrl) !== "string" ? "https://127.0.0.1:42112" : params.chatServerUrl;

              // set vars
              cu = window.stillepost.cryptoUtils;
              oi = window.stillepost.interfaces;
              _chainId = oi.getPublicChainInformation().chainId;
              _socket = oi.getPublicChainInformation().socket;

              // init commands
              oi.setupClientConnections(_privateKey, _publicKey);


              login(function(response){

                  // start heartbeats
                  setInterval(function(){
                          if(_loggedIn){
                              sendHeartbeat();
                          }
                      }, _heartbeatInterval);
                  _chatObject = {
                      // methods
                      updateUserList: function () {

                          if(_loggedIn){
                              getUserList(function(response){
                                  //_users = response.data;
                                  mergeNewUsers(response.data);

                                  _chatObject.onUserListUpdate(_users);
                              });
                          }

                      },
                      sendMessage: function(user, message){
                          if(typeof(_connections[user.hash]) === "undefined" || (typeof(user.reestablishConnection) !== "undefined" && user.reestablishConnection)){
                              _connections[user.hash] = oi.createClientConnection(user.socket.address, user.socket.port, user.chainid, user.key, true);
                              _connections[user.hash].onmessage = function(msg){_chatObject.onReceiveMessage(msg, user);};
                              if(typeof(user.reestablishConnection) !== "undefined"){
                                  user.reestablishConnection = false;
                              }
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
                      },
                      onOnionNotification: function(type, notificationObject){
                          logToConsole("received oninion notificatoin", type, notificationObject);
                          // if renew happened, we have to reregister on server
                          if(type === "renew"){
                              _chainId = notificationObject.data.chainId;
                              _socket = notificationObject.data.socket;
                              logout(function(response){
                                  logToConsole("successfully logged out correctly");
                                  login(function(response){
                                      logToConsole("successfully logged in again");
                                  });
                              }, function(response){
                                  logToConsole("failed to log out, probably timed out in betwen");
                                  login(function(response){
                                      logToConsole("successfully logged in again");
                                  });
                              });
                          }
                      }
                  };
                  oi.onClientConnection = _chatObject.onClientConnected;
                  oi.onionlayer.onnotification = _chatObject.onOnionNotification;
                  if(typeof(successCallback) === "function")
                      successCallback(_chatObject);
              });
          }
      };
  }]);
