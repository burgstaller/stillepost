'use strict';

angular.module('chat.home', ['ngRoute'])

.config(['$routeProvider', function($routeProvider) {
  $routeProvider.when('/home', {
    templateUrl: 'home/home.html',
    controller: 'ChatHomeCtrl'
  });
}])
.controller('ChatHomeCtrl', ['$scope', 'ChatServer', '$interval', '$location', function($scope, ChatServer, $interval, $location) {
  var _chatObject = ChatServer.getChatObject(),
      _chatHistory = {},
      _placeholder = "type message";
  $scope.users = ChatServer.getUsers();
  $scope.username = ChatServer.getUsername();
  $scope.publicKey = ChatServer.getPublicKey();
  $scope.privateKey = "";
  crypto.subtle.exportKey("jwk", ChatServer.getPrivateKey()).then(function (exportKey) {
    $scope.privateKey = JSON.stringify(exportKey);
  });
  $scope.currentChat = {
    messages:[],
    messageText: _placeholder
  };
  $scope.sendMessage = function(){
    _chatObject.sendMessage($scope.currentChat.user, $scope.currentChat.messageText);
    if(typeof(_chatHistory[$scope.currentChat.user.hash]) === "undefined"){
      _chatHistory[$scope.currentChat.user.hash] = [];
    }
    _chatHistory[$scope.currentChat.user.hash].push({
      username:  $scope.username,
      timestamp: Date.now(),
      message: $scope.currentChat.messageText
    });
    $scope.currentChat.messages = _chatHistory[$scope.currentChat.user.hash];
    $scope.currentChat.messageText = "";
  };
  $scope.openChat = function(user){
    $scope.currentChat = {
      user: user,
      messages: _chatHistory[user.hash],
      messageText: "",
      keyInfo: JSON.parse(user.key)
    };
    user.unreadMsgs = 0;
  };

  _chatObject.onReceiveMessage = function(msg, user){
    _chatHistory[user.hash] = typeof(_chatHistory[user.hash]) === "undefined" ? []: _chatHistory[user.hash];
    if(typeof($scope.currentChat.user) === "undefined" || $scope.currentChat.user.hash !== user.hash) {
      user.unreadMsgs = typeof(user.unreadMsgs) === "undefined" ? 1 : user.unreadMsgs+1;
    }
    _chatHistory[user.hash].push({
      username:user.username,
      timestamp: Date.now(),
      message: msg
    });

    console.log("RECEIVED msg :"+msg+" from user "+user.username);
    $scope.$apply();

  };
  _chatObject.onUserListUpdate = function(users){
    //console.log("UPDATED userlist");
    for(var u in users){
      if (users.hasOwnProperty(u)){
        // if user is not registered on server anymore, he disconnected
        if(typeof(users[u].disconnected) !== "undefined" && users[u].disconnected && (typeof(_chatHistory[u].disconnectHandled) === "undefined" || _chatHistory[u].disconnectHandled === false)){
          _chatObject.onReceiveMessage("User disconnected", users[u]);
          _chatHistory[u].disconnectHandled = true;
        }
        if(typeof(users[u].reconnected) !== "undefined" && users[u].reconnected === true){
          _chatObject.onReceiveMessage("User reconnected", users[u]);
          users[u].reconnected = false;
          _chatHistory[u].disconnectHandled = false;
        }
      }
    }
  };


  $interval(function() {
    _chatObject.updateUserList();
  }, 1500);

  $scope.refreshUsers = function(){
    _chatObject.updateUserList();
  };

  $scope.logout = function(){
    ChatServer.logout(function(response){
      logToConsole("successfully logged out", response);
      logToConsole("switching to login");
      $location.path("login");
      $scope.$apply();
      document.dispatchEvent(new CustomEvent("loggedOut"));
    });
  };

  $scope.activeChat = function(){
    return typeof($scope.currentChat.user) !== 'undefined';
  };
  $scope.unreadMsgs = function(user){
    return typeof(user.unreadMsgs) !== 'undefined' && user.unreadMsgs > 0;
  };
  $scope.activeUser = function(user){
    return typeof($scope.currentChat.user) !== 'undefined' && $scope.currentChat.user.hash === user.hash;
  };
  $scope.verify = function(user, verifyKey){
    user.verified = user.key === verifyKey;
  };
  $scope.chatEmpty = function(){
    return typeof($scope.currentChat.messages) === "undefined" || $scope.currentChat.messages.length === 0;
  };
}]);