var WebSocketServer = require('websocket').server;
var https = require('https'),
  http = require('http'),
  crypto = require('crypto'),
  fs = require("fs");

var server = https.createServer({
  key: fs.readFileSync('server-key.pem'),
  cert: fs.readFileSync('server-cert.pem')
}, function(request, response) {
    console.log((new Date()) + ' Received request for ' + request.url);
    response.writeHead(404);
    response.end();
});

server.listen(8081, function() {
    console.log((new Date()) + ' Server is listening on port 8081');
});

var connections = [];

wsServer = new WebSocketServer({
    httpServer: server,
    // You should not use autoAcceptConnections for production
    // applications, as it defeats all standard cross-origin protection
    // facilities built into the protocol and the browser.  You should
    // *always* verify the connection's origin and decide whether or not
    // to accept it.
    autoAcceptConnections: false
});

function originIsAllowed(origin) {
  // put logic here to detect whether the specified origin is allowed.
  return true;
}

wsServer.on('request', function(request) {
    if (!originIsAllowed(request.origin)) {
      // Make sure we only accept requests from an allowed origin
      request.reject();
      console.log((new Date()) + ' Connection from origin ' + request.origin + ' rejected.');
      return;
    }
    console.log("request from " + request.remoteAddress + ":" + request.socket.remotePort);
    var connection = request.accept('signaling-protocol', request.origin);
    connections.push(connection);
    console.log((new Date()) + ' Connection accepted.');
    connection.sendUTF(JSON.stringify({peer:request.socket.remoteAddress, port:request.socket.remotePort}));
    connection.on('message', function(message) {
      if (message.type === 'utf8') {
        console.log('Received Message: ' + message.utf8Data);
        var msg = JSON.parse(message.utf8Data), found = false;
        console.log("message from "+msg.peerOrigin+":"+msg.portOrigin+" to: "+msg.peer+":"+msg.port);
        for (var i = 0; i < connections.length; i++) {
          var conn = connections[i];
          console.log("comparing "+msg.peer+"="+conn.socket.remoteAddress+" && "+msg.port+"="+conn.socket.remotePort);
          if (msg.peer === conn.socket.remoteAddress && msg.port === conn.socket.remotePort) {
            console.log("found target connection - sending data");
            conn.sendUTF(message.utf8Data);
            found = true;
            break;
          }
        }
        // connection partner not found
        if (!found) {
          connection.sendUTF(JSON.stringify({error:"Peer Not found",webRTCConnection:msg.webRTCConnection}));
        }
      }
    });
    connection.on('close', function(reasonCode, description) {
        console.log((new Date()) + ' Peer ' + connection.remoteAddress + ' disconnected.');
        var index = connections.indexOf(connection);
        if (index > -1) {
          console.log("Removed connection");
          connections.splice(index, 1);
        }
    });
});
