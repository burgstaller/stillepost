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
      _username = ChatServer.getUsername();
  $scope.users = ChatServer.getUsers();
  $scope.currentChat = {
    messages:[],
    messageText: "type message"
  };
  $scope.sendMessage = function(){
    _chatObject.sendMessage($scope.currentChat.user, $scope.currentChat.messageText);
    if(typeof(_chatHistory[$scope.currentChat.user.hash]) === "undefined"){
      _chatHistory[$scope.currentChat.user.hash] = [];
    }
    var timestamp = new Date();
    _chatHistory[$scope.currentChat.user.hash].push({
      username:_username,
      timestamp: timestamp.toISOString(),
      message: $scope.currentChat.messageText
    });
    $scope.currentChat.messages = _chatHistory[$scope.currentChat.user.hash];
  };
  $scope.openChat = function(user){
    $scope.currentChat = {
      user: user,
      messages: _chatHistory[user.hash],
      messageText: ""
    };
  };

  _chatObject.onReceiveMessage = function(msg, user){
    if(typeof(_chatHistory[user.hash]) === "undefined"){
      _chatHistory[user.hash] = [];
    }
    var timestamp = new Date();
    _chatHistory[user.hash].push({
      username:user.username,
      timestamp: timestamp.toISOString(),
      message: msg
    });

    console.log("RECEIVED msg :"+msg+" from user "+user.username);
    $scope.$apply();

  };
  _chatObject.onUserListUpdate = function(users){
    console.log("UPDATED userlist");
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


}]);