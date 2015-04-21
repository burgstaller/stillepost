
window.stillepost = window.stillepost || {};
window.stillepost.chat = (function() {

    var _sessionKey = null,
        _privateKey = null,
        _publicKey = null,
        _publicKeyHash = null,
        _chainId = null,
        _socket = null,
        _username = null,
        _chatServerUrl = null,
        _users = null,
        _connections = {},
        _heartbeatInterval = 3000,
        oi = null,
        cu = null;

    function login(successCallback){
        var xhr = new XMLHttpRequest();
        xhr.onload = function () {
            logToConsole("chat: login SUCCESS");

            var response = JSON.parse(this.responseText);
            _sessionKey = response.data.sessionKey;
            cu.hash(_publicKey).then(function(data){
                _publicKeyHash = data;
                if(typeof(successCallback) !== "undefined")
                    successCallback(response);
            });
        };
        xhr.onerror = function(e) {
            logToConsole("chat: login FAILURE:");
            logToConsole(e.target);
        };
        xhr.open("post", _chatServerUrl + "/user", true);
        xhr.send(JSON.stringify({"key":_publicKey,"username":_username,"chainid":_chainId,"socket":_socket}));
    }

    function getUserList(successCallback){
        var xhr = new XMLHttpRequest();
        xhr.onload = function () {
            var response = JSON.parse(this.responseText);
            logToConsole("chat: getUserList SUCCESS");
            if(typeof(successCallback) !== "undefined")
                successCallback(response);
        };
        xhr.onerror = function(e) {
            logToConsole("chat: getUserList FAILURE:");
            logToConsole(e.target);
        };
        xhr.open("get", _chatServerUrl + "/user?sessionKey="+encodeURIComponent(_sessionKey)+"&keyHash="+encodeURIComponent(_publicKeyHash), true);
        xhr.send();
    }

    function sendHeartbeat(successCallback){
        var xhr = new XMLHttpRequest();
        xhr.onload = function () {
            var response = JSON.parse(this.responseText);
            logToConsole("chat: sendHeartbeat SUCCESS");
            if(typeof(successCallback) !== "undefined")
                successCallback(response);
        };
        xhr.onerror = function(e) {
            logToConsole("chat: sendHeartbeat FAILURE:");
            logToConsole(e.target);
        };
        xhr.open("put", _chatServerUrl + "/user/"+encodeURIComponent(_publicKeyHash)+"?sessionKey="+encodeURIComponent(_sessionKey), true);
        xhr.send();
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
        init: function(params, successCallback){
            // read params
            if(typeof(params) !== "object"){
                logToConsole("chat: INIT FAILURE - no params");
                return
            }
            _username = typeof(params.username) !== "string" ? "test" : params.username;
            if(typeof(params.privateKey) === "undefined" || typeof(params.publicKey) ==="undefined"){
                logToConsole("chat: INIT FAILURE - no keys");
            } else {
                _privateKey = params.privateKey;
                _publicKey = params.publicKey;
            }
            _chatServerUrl = typeof(params.chatServerUrl) !== "string" ? "http://127.0.0.1:42112" : params.chatServerUrl;

            // set vars
            cu = window.stillepost.cryptoUtils;
            oi = window.stillepost.interfaces;
            _chainId = oi.getPublicChainInformation().chainId;
            _socket = oi.getPublicChainInformation().socket;

            // init commands
            oi.setupClientConnections(_privateKey, _publicKey);

            var chatObject = null;
            login(function(response){

                setInterval(sendHeartbeat, _heartbeatInterval);
                chatObject = {
                    // methods
                    updateUserList: function () {
                        getUserList(function(response){
                            _users = response.data;
                            chatObject.onUserListUpdate(_users);
                        });
                    },
                    sendMessage: function(user, message){
                        if(typeof(_connections[user.hash]) === "undefined"){
                            _connections[user.hash] = oi.createClientConnection(user.socket.address, user.socket.port, user.chainid, user.key, true);
                            _connections[user.hash].onmessage = function(msg){chatObject.onReceiveMessage(msg, user);};
                        }
                        _connections[user.hash].send(message, function() {logToConsole('successcallback called');},
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
                                    _users = response.data;
                                    chatObject.onUserListUpdate(_users);
                                    if(typeof(_users[publicKeyHash]) === "undefined"){
                                        logToConsole("chat: onClientConnected FAILURE no such user registered");
                                        return;
                                    }
                                    _connections[publicKeyHash] = connection;
                                    _connections[publicKeyHash].onmessage = function(msg){chatObject.onReceiveMessage(msg, _users[publicKeyHash]);};
                                });
                            } else {
                                // TODO: is this really correct? (probably not)
                                _connections[publicKeyHash] = connection;
                                _connections[publicKeyHash].onmessage = function(msg){chatObject.onReceiveMessage(msg, _users[publicKeyHash]);};
                            }
                        });
                    }
                };
                oi.onClientConnection = chatObject.onClientConnected;
                if(typeof(successCallback) === "function")
                    successCallback(chatObject);
            });
        }
    };
})();
