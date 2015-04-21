window.stillepost = window.stillepost || {};
window.stillepost.onion = window.stillepost.onion || {};
window.stillepost.interfaces = (function () {
    var public = {},
        onion = window.stillepost.onion.onionRouting,
        exitNode = window.stillepost.onion.exitNode,
        intermediateNode = window.stillepost.onion.intermediateNode,
        messageHandler = window.stillepost.onion.messageHandler,
        clientConnection = window.stillepost.onion.clientConnection;

    // This object contains configuration properties
    var config = {
      // Timeout of aajax messages
      aajaxRequestTimeout: 45000,
      // Timeout of aajax messages
      aFileDownTimeout: 200000,
      // Timeout of creating a chain
      createChainTimeout: 10000,
      // Interval in which heartbeat messages are send to the directory server
      heartbeatInterval: 3000,

      // maximum amount of tries to create a chain
      maxCreateChainTryCount: 15,
      // Chain re-build attempts are done in increasing intervals. This setting is used to define a maximum interval.
      maxCreateChainInterval: 6000,

      // maximum amount of tries to connect to the directory server
      maxDirectoryTryCount: 3,

      // ClientConnection configuration
      // Timeout for client messages
      clientMessageTimeout: 7000,
      // Timeout for the client connection init message
      clientMessageInitTimeout: 8000,
      // Maximum amount of retransmission before an error is thrown
      maxRetransmissionCount: 5,

      // ChunkSize of a message - messages smaller than chunkSize are padded
      chunkSize: 15000
    };

    /**
     * Initialize the library.
     */
    public.initLib = function() {
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

    /**
     * Initializes Node
     */
    public.initNode = function(){
        onion = window.stillepost.onion.onionRouting;
        exitNode = window.stillepost.onion.exitNode;
        intermediateNode = window.stillepost.onion.intermediateNode;
        messageHandler = window.stillepost.onion.messageHandler;
        onion.init();
        exitNode.init();
        intermediateNode.init();
        messageHandler.init();
    };

    /**
     * Turn off Node
     */
    public.turnOff = function(){
        onion.cleanUp();
    };

    /**
     * This function invokes the creation of a onion chain, where the calling node is the owner of the chain.
     * Each node can have its own chain. If the chain breaks, it is automatically rebuild.
     * Public information can be retrieved once the chain was successfully created.
     * @returns Promise, the promise which is resolved, once the chain is successfully created
     */
    public.buildChain = function () {
        return onion.createChain();
    };

    /**
     * Retrieve the public information of this nodes chain. Public information is only available, once the chain
     * is created.
     * Public information contains the properties socket and chainId.
     * Socket it the exit nodes' socket (address and port) of this nodes chain.
     * ChainId is the public chain identifier.
     * This information can be used by other nodes to anonymously connect to this node.
     * @returns object .. the public information
     */
    public.getPublicChainInformation = function () {
        return onion.getPublicChainInformation();
    };

    /**
     * Provide a keyPair to the onion-layer, which is used for end-to-end encryption in client connections.
     * Creating (actively or passively) a client connection requires prior calling of this function.
     * @param privateKey the privateKey
     * @param publicKey the publicKey
     */
    public.setupClientConnections = function (privateKey, publicKey) {
        clientConnection.setupClientConnections({privateKey: privateKey, publicKey: publicKey});
    };

    /**
     * Anonymously create a connection to a client.
     * This function returns a connection object, which allows to handle communication with the remote client.
     * The connection object provides a send(message) function, which can be used to send a message to the remote client.
     * Furthermore, the connection object triggers the onmessage event, for each received message on the underlying connection.
     * By providing an onmessage function to the connection object, received messages can be handled.
     * By providing an onerror function to the connection object, communication errors can be handled.
     * @param address the exit node address of the other clients chain
     * @param port the exit node port of the other clients chain
     * @param chainId the public chainId of the other clients chain
     * @param pubKey the public key of the other client
     * @returns object .. the connection object
     */
    public.createClientConnection = function (address, port, chainId, pubKey, isOrderedAndReliable) {
        return clientConnection.createClientConnection(address, port, chainId, pubKey, isOrderedAndReliable);
    };

    /**
     * This function can be overwritten and is triggered each time a remote client connects to this node.
     * The function takes a connection object parameter, which can be used for communication to the remote client.
     * Example: onClientConnection = function(connection) { connection.send('i am here'); }
     * @type function
     */
    public.onClientConnection = clientConnection.onClientConnection;

    /**
     * Onion layer events - This functions are intended to be overwritten with custom functions, which handle the events.
     */
    public.onionlayer = {
      /**
       * Following error types are supported:.
       * - chainError: Critical error. Onion chain could not be established. Automatic recovery has failed.
       *
       * All error types below are recovered automatically, if possible. If automatic recovery fails, a 'chainError' will be triggered.
       * - buildError: Error while building the chain.
       * - messageError: Error while processing a message.
       * - nodeError: A node in the chain is no longer available.
       * @param type .. the string representation of the error type
       * @param errorThrown .. JSON object which contains error information - consists of following two properties:
       *  - message: the error text message
       *  - error: the error object
       */
      onerror: function (type, errorThrown) {
        console.error('onion layer on error called with ',type, errorThrown);
      },
      /**
       * Following notification types are supported:
       * - renew: Triggered each time after the nodes' chain was successfully rebuild.
       *          The new public chain information is passed as notification.data
       *
       * @param type .. the string representation of the notification type
       * @param notificationText .. JSON object which contains notification information - consists of following two properties:
       *  - message: the notification text message
       *  - data: the notification data
       */
      onnotification: function(type, notification) {
        console.info('onion layer onnotification called with type: ',type,notification);
      }
    };

    /**
     * Performs an anonymous ajax request through the provided onion network
     * This request is sent without any cookies
     * Since this request is sent from an exit node to the server, there is _no_ origin limitation for the URL
     * @param request expects a jquery style parameter for the ajax function
     *  the following fields are supported and handeled in the same way as jquery does:
     *     accepts
     *     contents
     *     contentType
     *     converters
     *     data
     *     dataType
     *     headers
     *     mimeType
     *     processData
     *     responseType
     *     scriptCharset
     *     type
     *     url
     */
    public.aajax = function (request) {
        return onion.aajax(request);
    };

    /**
     * Performs an anonymous filedownload
     * When the function is called the file is requested from an exit node inside the onion network and a promise is
     * returned.
     * As soon as the file is downloaded to the local machine the promise will resolv
     * @param the url to the file which should be downloaded
     * @returns {Promise}
     *  promis.resolv: url: the local objecturl the file can be downloaded from
     *                 name: the full filename (name + extension) of the downloaded file
     */
    public.aFileDown = function (url) {
        return new Promise(function (resolv, reject) {
            var request = {};
            request.url = url;
            request.dataType = 'binary';
            request.responseType = 'arraybuffer';
            request.processData = false;
            request.type = 'GET';
            request.success = function (data) {
                var uInt8Array = str2ab(data);
                var blob = new Blob([uInt8Array], {type: 'application/octet-binary'});
                var filename = url.substring(url.lastIndexOf("/") + 1, url.length);
                resolv({url: URL.createObjectURL(blob), filename: filename});
            };

            request.error = function (jqXHR, textStatus, errorThrown) {
                reject({textStatus: textStatus, errorThrown: errorThrown});
            };

            return onion.aajax(request);
        });
    };

    public.aFileUp = function () {
        // todo
    };

    /**
     * Close the chain of this node. Notifies each node in the chain that the chain is closed.
     * Consequently, each node deletes information of this chain and closes unnessecary webrtc connections.
     * If no chain was created prior to this call no action is performed.
     */
    public.closeChain = function () {
        onion.closeChain();
    };

    /**
     * Closes this nodes' chain, if previously established. Additionally logs out from the directory server.
     * Consequently, this node is no longer part of the onion network.
     */
    public.cleanUp = function () {
        onion.cleanUp();
    };

    public.config = config;

  //  public.initLib();

    return public;
})();