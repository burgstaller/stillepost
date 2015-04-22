/***
 * This file contains the signaling channel logic
 * It must provide a window.stillepost.signalingChannel object providing a public send(data) function.
 * It must call window.stillepost.webrtc.handleSignalingMessage(message) on receiving a message.
 */

window.stillepost = window.stillepost || {};

window.stillepost.signalingChannel = (function() {
    var public = {};
// WebRTC global configuration variables todo: change to wss after creating https server
    var signalingServerURL = "ws://37.235.60.77:8081/";
    var signalingChannel;

    public.init = function(){
        signalingChannel = new WebSocket(signalingServerURL, 'signaling-protocol');

        signalingChannel.onerror = function () {
            logToConsole('Signaling channel connection Error - could not connect to WebSocket server');
        };

        signalingChannel.onopen = function () {
            logToConsole('Signaling channel opened');
        };

        signalingChannel.onclose = function () {
            logToConsole('Signaling channel closed');
        };

        signalingChannel.onmessage = function (evt) {
            logToConsole("Received signalingChannel message in connection");
            var message = JSON.parse(evt.data);
            window.stillepost.webrtc.handleSignalingMessage(message);
        };

        public.websocket = signalingChannel;
    };

    public.close = function(){
        signalingChannel.close();
    };

  return public;
})();