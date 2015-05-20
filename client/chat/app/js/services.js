'use strict';

/* Services */

var chatServices = angular.module('chatServices', ['ngResource']);

chatServices.factory('ChatServer', ['$resource',
  function ($resource) {
    var _sessionKey = null,
      _privateKey = null,
      _publicKey = null,
      _publicKeyHash = null,
      _chainId = null,
      _socket = null,
      _username = null,
      _chatServerUrl = "https://127.0.0.1:42112",
      _users = {},
      _connections = {},
      _heartbeatInterval = 3000,
      _chatObject = null,
      _loggedIn = false,
      oi = null,
      cu = null;


    /**
     * Sends POST login message to the registered chat server
     *
     * @param successCallback called if the chat server responded confirmative, first parameter is the response of the server
     */
    function login(successCallback) {
      var xhr = new XMLHttpRequest();
      xhr.onload = function () {
        console.log("chat: login SUCCESS");

        var response = JSON.parse(this.responseText);
        _sessionKey = response.data.sessionKey;
        cu.hash(_publicKey).then(function (data) {
          _publicKeyHash = data;
          _loggedIn = true;
          if (typeof(successCallback) !== "undefined")
            successCallback(response);
        });
      };
      xhr.onerror = function (e) {
        console.log("chat: login FAILURE:");
        console.log(e.target);
      };
      xhr.open("post", _chatServerUrl + "/user", true);
      xhr.send(JSON.stringify({"key": _publicKey, "username": _username, "chainid": _chainId, "socket": _socket}));
    }

    /**
     * Sends GET getUserList request to the registered chat server
     *
     * @param successCallback called if the chat server respondend confirmative, first parameter is the response of the server
     */
    function getUserList(successCallback) {
      var xhr = new XMLHttpRequest();
      xhr.onload = function () {
        var response = JSON.parse(this.responseText);
        //console.log("chat: getUserList SUCCESS");
        if (typeof(successCallback) !== "undefined")
          successCallback(response);
      };
      xhr.onerror = function (e) {
        console.log("chat: getUserList FAILURE:");
        console.log(e.target);
      };
      xhr.open("get", _chatServerUrl + "/user?sessionKey=" + encodeURIComponent(_sessionKey) + "&keyHash=" + encodeURIComponent(_publicKeyHash).replace(/%00/g, "customnullbyte"), true);
      xhr.send();
    }

    /**
     * Sends PUT heartbeat notification to the registered chat server
     * If the client does not do this, the server will time out the client and remove him
     * from the registered user list
     *
     * @param successCallback called if the chat server respondend confirmative, first parameter is the response of the server
     */
    function sendHeartbeat(successCallback) {
      var xhr = new XMLHttpRequest();
      xhr.onload = function () {
        var response = JSON.parse(this.responseText);
        //console.log("chat: sendHeartbeat SUCCESS");
        if (typeof(successCallback) !== "undefined")
          successCallback(response);
      };
      xhr.onerror = function (e) {
        console.log("chat: sendHeartbeat FAILURE, disconnected:");
        console.log(e.target);
        _loggedIn = false;
      };
      xhr.open("put", _chatServerUrl + "/user/" + encodeURIComponent(_publicKeyHash).replace(/%00/g, "customnullbyte") + "?sessionKey=" + encodeURIComponent(_sessionKey), true);
      xhr.send();
    }

    /**
     * Sends DELETE logout notification to the registered chat server
     *
     * @param successCallback called if the chat server respondend confirmative, first parameter is the response of the server
     */
    function logout(successCallback, errorCallback) {
      var xhr = new XMLHttpRequest();
      xhr.onload = function () {
        var response = JSON.parse(this.responseText);
        //console.log("chat: logout SUCCESS");
        _loggedIn = false;
        if (typeof(successCallback) !== "undefined")
          successCallback(response);
      };
      xhr.onerror = function (e) {
        console.log("chat: logout FAILURE:");
        console.log(e.target);
        if (typeof(errorCallback) !== "undefined")
          errorCallback(response);
      };
      xhr.open("delete", _chatServerUrl + "/user/" + encodeURIComponent(_publicKeyHash).replace(/%00/g, "customnullbyte") + "?sessionKey=" + encodeURIComponent(_sessionKey), true);
      xhr.send();
    }

    /**
     * Merges the locally stored users with the userlist received from the server
     * Handles user disconnect and reconnect events by setting flags
     *
     * @param newUsers The users that will be merged with the locally registered users
     */
    function mergeNewUsers(newUsers) {
      // loop over all new usres
      for (var u in newUsers) {
        if (newUsers.hasOwnProperty(u)) {
          // if user is new, add him to local object
          // otherwise, merge attributes
          if (typeof(_users[u]) === "undefined") {
            _users[u] = newUsers[u];
          } else {
            // check for reconnect
            // a reconnect happened when we witnessed a logout and login (flag disconnected)
            // or when one of the connection properties changed (address, port, or chainid)
            if ((typeof(_users[u].disconnected) !== "undefined" && _users[u].disconnected === true) ||
              (_users[u].socket.address !== newUsers[u].socket.address ||
              _users[u].socket.port !== newUsers[u].socket.port ||
              _users[u].socket.chainid !== newUsers[u].socket.chainid)) {
              _users[u].disconnected = false;
              _users[u].reconnected = true;
              _users[u].reestablishConnection = true;
            }
            // merge attributes
            for (var attr in newUsers[u]) {
              if (newUsers[u].hasOwnProperty(attr)) {
                _users[u][attr] = newUsers[u][attr];
              }
            }

          }
        }
      }
      // check for disconnected users
      for (var u in _users) {
        if (_users.hasOwnProperty(u)) {
          // if user is not registered on server anymore, he disconnected
          if (typeof(newUsers[u]) === "undefined") {
            _users[u].disconnected = true;
          }
        }
      }
    }

    return {
      getChatObject: function () {
        return _chatObject;
      },
      getUsers: function () {
        return _users;
      },

      getUsername: function () {
        return _username;
      },

      getPublicKey: function () {
        return _publicKey;
      },

      getPrivateKey: function () {
        return _privateKey
      },

      logout: logout,
      login: login,

      /**
       *
       * @param params Parameter object specifying various settings
       *          - username: optional
       *          - privateKey: required
       *          - publicKey: required
       *          - chatServerUrl: optional
       * @param successCallback first parameter is the chatObject, which provides functions to interact with onion layer
       */
      init: function (params, successCallback) {
        // read params
        if (typeof(params) !== "object") {
          console.log("chat: INIT FAILURE - no params");
          return
        }
        _username = typeof(params.username) !== "string" ? "test" : params.username;
        if (typeof(params.privateKey) === "undefined" || typeof(params.publicKey) === "undefined") {
          console.log("chat: INIT FAILURE - no keys");
        } else {
          _privateKey = params.privateKey;
          _publicKey = params.publicKey;
        }
        _chatServerUrl = typeof(params.chatServerUrl) !== "string" ?  _chatServerUrl: params.chatServerUrl;

        // set vars
        cu = window.stillepost.cryptoUtils;
        oi = window.stillepost.interfaces;
        _chainId = oi.getPublicChainInformation().chainId;
        _socket = oi.getPublicChainInformation().socket;

        // init commands
        oi.setupClientConnections(_privateKey, _publicKey);

        login(function (response) {

          // start heartbeats
          setInterval(function () {
            if (_loggedIn) {
              sendHeartbeat();
            }
          }, _heartbeatInterval);
          _chatObject = {
            /**
             * retrieves new users from chat server and calls method "onUserListUpdate" of the chatObject
             */
            updateUserList: function () {

              if (_loggedIn) {
                getUserList(function (response) {
                  //_users = response.data;
                  mergeNewUsers(response.data);

                  _chatObject.onUserListUpdate(_users);
                });
              }

            },
            /**
             * sends a end-to-end encrypted message to a given user
             *
             * @param user The user to which the message will be sent
             * @param message The message to send
             */
            sendMessage: function (user, message) {
              if (typeof(_connections[user.hash]) === "undefined" || (typeof(user.reestablishConnection) !== "undefined" && user.reestablishConnection)) {
                _connections[user.hash] = oi.createClientConnection(user.socket.address, user.socket.port, user.chainid, user.key, true);
                _connections[user.hash].onmessage = function (msg) {
                  _chatObject.onReceiveMessage(msg, user);
                };
                if (typeof(user.reestablishConnection) !== "undefined") {
                  user.reestablishConnection = false;
                }
              }
              _connections[user.hash].send(message, function () {
                  console.log('successcallback called');
                },
                function () {
                  console.error('errorcallback called');
                });
            },

            /**
             * Called whenever new users have been fetched from the server
             *
             * @param users new users fetched from the server
             */
            onUserListUpdate: function (users) {
            },
            /**
             * Called whenever an end-to-end encrypted chat message was received
             *
             * @param msg The received message
             * @param user The user that sent the message
             */
            onReceiveMessage: function (msg, user) {
            },
            /**
             * Called from the onionlayer whenever another client has connected to this client
             * If the user that connected was not previously registered locally, a userlist update to the server is done.
             * If the user is not registered after the update, the connection will be dismissed
             *
             * If the user was locally registered (or fetched by the userlist update) the onReceiveMessage event
             * of the chatObject is setup to allow processing of further messages
             *
             * @param connection object specifying information about the client that has connected
             */
            onClientConnected: function (connection) {
              cu.hash(connection.publicKey).then(function (publicKeyHash) {
                if (typeof(_users[publicKeyHash]) === "undefined") {
                  getUserList(function (response) {
                    //_users = response.data;
                    mergeNewUsers(response.data);
                    _chatObject.onUserListUpdate(_users);
                    if (typeof(_users[publicKeyHash]) === "undefined") {
                      console.log("chat: onClientConnected FAILURE no such user registered");
                      return;
                    }
                    _connections[publicKeyHash] = connection;
                    _connections[publicKeyHash].onmessage = function (msg) {
                      _chatObject.onReceiveMessage(msg, _users[publicKeyHash]);
                    };
                  });
                } else {
                  _connections[publicKeyHash] = connection;
                  _connections[publicKeyHash].onmessage = function (msg) {
                    _chatObject.onReceiveMessage(msg, _users[publicKeyHash]);
                  };
                }
              });
            },
            /**
             * Notification callback for the onion layer
             * if a chain renew occurred (i.e. the chain of the client broke and had to be rebuilt again),
             * the client tries to reregister at the chat server, which has to be done since the
             * chain connection information (chainid, socket) has changed
             *
             * @param type The type of the notification
             * @param notificationObject The notification object containing further information
             */
            onOnionNotification: function (type, notificationObject) {
              logToConsole("received oninion notificatoin", type, notificationObject);
              // if renew happened, we have to reregister on server
              if (type === "renew") {
                _chainId = notificationObject.data.chainId;
                _socket = notificationObject.data.socket;
                logout(function (response) {
                  logToConsole("successfully logged out correctly");
                  login(function (response) {
                    logToConsole("successfully logged in again");
                  });
                }, function (response) {
                  logToConsole("failed to log out, probably timed out in betwen");
                  login(function (response) {
                    logToConsole("successfully logged in again");
                  });
                });
              }
            }
          };
          oi.onClientConnection = _chatObject.onClientConnected;
          oi.onionlayer.onnotification = _chatObject.onOnionNotification;
          if (typeof(successCallback) === "function")
            successCallback(_chatObject);
        });
      }
    };
  }]);
