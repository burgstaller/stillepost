window.stillepost = window.stillepost || {};
window.stillepost.onion = window.stillepost.onion || {};
window.stillepost.onion.interfaces = (function() {
  var public = {},
    onion = window.stillepost.onion.onionRouting,
    exitNode = window.stillepost.onion.exitNode,
    intermediateNode = window.stillepost.onion.intermediateNode,
    messageHandler = window.stillepost.onion.messageHandler,
    clientConnection = window.stillepost.onion.clientConnection;

  public.init = function() {
    onion = window.stillepost.onion.onionRouting;
    exitNode = window.stillepost.onion.exitNode;
    intermediateNode = window.stillepost.onion.intermediateNode;
    messageHandler = window.stillepost.onion.messageHandler;
    clientConnection = window.stillepost.onion.clientConnection;
    onion.init();
    exitNode.init();
    intermediateNode.init();
    clientConnection.init();
    messageHandler.init();
  };

  public.buildChain = function() {
    return onion.createChain();
  };

  public.setupClientConnections = function(privateKey, publicKey) {
    clientConnection.setupClientConnections({privateKey: privateKey, publicKey: publicKey});
  };

  public.createClientConnection = function(address, port, chainId, pubKey) {
    return clientConnection.createClientConnection(address, port, chainId, pubKey);
  };

  public.onClientConnection = clientConnection.onClientConnection;

  public.getPublicChainInformation = function() {
    return onion.getPublicChainInformation();
  };

  public.aajax = function() {
    // todo
  };

  public.aFileDown = function() {
    // todo
  };

  public.aFileUp = function() {
    // todo
  };

  public.cleanUp = function() {
    onion.cleanUp();
  };

  public.init();

  return public;
})();