'use strict';

angular.module('chat.home', ['ngRoute'])

.config(['$routeProvider', function($routeProvider) {
  $routeProvider.when('/home', {
    templateUrl: 'home/home.html',
    controller: 'ChatHomeCtrl'
  });
}])
.controller('ChatHomeCtrl', ['$scope', 'ChatServer', '$interval', function($scope, ChatServer, $interval) {
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
  };


  $interval(function() {
    _chatObject.updateUserList();
  }, 1500);

  $scope.refreshUsers = function(){
    _chatObject.updateUserList();
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

}]);