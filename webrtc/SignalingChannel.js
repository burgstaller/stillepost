/***
 * This file contains the signaling channel logic
 * It must provide a window.stillepost.signalingChannel object providing a public send(data) function.
 * It must call window.stillepost.webrtc.handleSignalingMessage(message) on receiving a message.
 */

window.stillepost = window.stillepost || {};

window.stillepost.signalingChannel = (function() {
// WebRTC global configuration variables todo: change to wss after creating https server
  var signalingServerURL = "ws://localhost:8081/";
  var signalingChannel = new WebSocket(signalingServerURL, 'signaling-protocol');

  signalingChannel.onerror = function () {
    console.log('Signaling channel connection Error - could not connect to WebSocket server');
  };

  signalingChannel.onopen = function () {
    console.log('Signaling channel opened');
  };

  signalingChannel.onclose = function () {
    console.log('Signaling channel closed');
  };

  signalingChannel.onmessage = function (evt) {
    console.log("Received signalingChannel message in connection");
    var message = JSON.parse(evt.data);
    window.stillepost.webrtc.handleSignalingMessage(message);
  };
  return signalingChannel;
})();