# stillepost

stillepost is a proof-of-concept framework for anonymous communication implemented completely in Javascript.
To accomplish this, the [WebCryptoAPI]  was used to implement onion routing logic on the client side while the necessary backend servers made use of [Node.js].
More specifically, stillepost is made up of the following subcomponents:

## Client
### WebRTC
The foundation of all communication in stillepost is WebRTCs [peer to peer data api] which enables NAT and firewall traversal using a STUN server.
### Onion routing
The onion routing layer is core functionality of stillepost. It uses a directory server to retrieve a random subset of stillepost nodes and randomly chooses three nodes. These three nodes will then be used to build an onion routing chain. The client is now able to retrieve arbitrary data from the internet using this chain, routing the data through an onion network and decreasing the traceability of all communications tremendously.
### Chat
To showcase the functionality of stillepost, an anonymous chat application was implemented using [AngularJS]. The application allows any user visiting the site to register at a chat directory server and communicate with other users through linked onion chains and an additional layer of end-to-end encryption. Furthermore, the user may use his own RSA key pair as a means recognizability for users he trusts.
## Server
### WebRTC signaling
A simple WebRTC signaling server was implemented using [Node.js] and [WebSockets].
### Onion directory server 
To manage all stillepost onion nodes a directory server was implemented using [Node.js] and [restify]. Nodes communicate with the server using a RESTful webservice. They register themselves at the directory server and retrieve lists of nodes to create onion chains.
### Chat directory server
The chat directory server allows stillepost onion clients to register themselves, providing the server with identity information such as a username and a public RSA key, as well as connectivity information such as a the socket of the chain's exit node. Chat clients can then retrieve a list of currently logged in users from the server, enabling the client to connect and chat with other users. The servers implements its functionality as a RESTful webservice and uses [Node.js] and [restify].
## Usage
To make use of the stillepost client side Javascript library, execute the grunt target mini to create a minified version of all necessary onion routing and webrtc dependencies.
By including this file in you web site, you gain access to the onion routing capabilities.

The file **client/interfaces.js** documents all methods exposed by the stillepost client library. It furthermore also specifies various configuration settings.

Before using to library, at least the following configuration variables need to be configured:
- WebRTC signaling server
TODO: expose in interfaces.js
- WebRTC stun server
TODO: expose in interfaces.js
- Onion directory server
```javascript
// default directoryServerUrl
directoryServerUrl: "https://localhost:42111",
```

TODO: actual example code calling initLib



[WebCryptoAPI]:http://www.w3.org/TR/WebCryptoAPI/
[Node.js]: https://nodejs.org/
[peer to peer data api]:https://w3c.github.io/webrtc-pc/#peer-to-peer-data-api
[AngularJS]:https://angularjs.org/
[WebSockets]:http://dev.w3.org/html5/websockets/
[restify]:https://github.com/mcavage/node-restify
