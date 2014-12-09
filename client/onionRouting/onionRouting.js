sp.onion = (function() {
    var public = {},

    //Id of the chain in which this node is the master
    chainIdMaster:null,

    //sym keys of all nodes of the chain in which this node is the master
    masterChain:null,

    //map of all node-neighbours with socket and key info
    chainMap:null,

    //generate RSA keypair and send public key to directory server
    initOnionSetup: function(){

    },
    
    //requests list of nodes, creates 'create' request and sends it to the first node in the chain (waits for ack from exit node)
    createChain: function(){

    	//TODO request and choose nodes

    	//generate new sym keys

    	//encrypt build command n-1 times


    },

    //is called when node is intermediate to add another node to the current (to be created) chain
    addNodeToChain: function(){

    },

    //interface function to generically send a new message over the master chain
    public.sendMessage = function(){

    }


    //interface function called by WEBRtc to handle an incoming onion request
    public.handleMessage = function(){

    }


    })();