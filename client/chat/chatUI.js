window.stillepost = window.stillepost || {};

window.stillepost.chatUI = (function(){

    var public = {},
        cu = null,
        oi = null,
        chat = null,
        _publicKey = null,
        _privateKey = null,
        _username = null,
        _chatObject,
        _separator = ": ",
        _linebreak = "\n",
        _usermap = [];

    function init(){
        // vars
        oi = window.stillepost.onion.interfaces;
        chat = window.stillepost.chat;
        cu = window.stillepost.cryptoUtils;
    }

    function createChatWindow(id){
        var chatwindow = '<div class="chatWindow" id="chatWindow'+id+'">' +
            '<div class="chatDiv"><textarea class="chatTA" id="chatTextArea'+id+'"></textarea></div>' +
            '<div class="chatDiv"><textarea class="msgTA" id="messageTextArea'+id+'"></textarea>' +
            '<button class="sendBT" id="sendButton'+id+'">send</button></div></div>';
        $('section').append(chatwindow);
        $('#messageTextArea'+id).keyup({chatId: id}, function(event){
            if(event.keyCode == 13){
                sendMessage(event);
            }
        });
        $('#sendButton'+id).on('click', { chatId: id }, sendMessage);
    }

    function sendMessage(event){
        var input = $('#messageTextArea'+event.data.chatId).val();
        if(input !== '') {
            var msg = _username + _separator + input + _linebreak;
            $('#chatTextArea' + event.data.chatId).append(msg);
            $('#messageTextArea' + event.data.chatId).val('');
        }
        _chatObject.sendMessage(_usermap[event.data.chatId], input);
    }

    // TODO implement incremental updates
    // users need timestamp of login
    // add only users to _usermap that are newer than <datetime>lastChecked
    function updateUserList(users){
        _usermap = [];
        var id = -1;
        for(var user in users){
            id++;
            _usermap[id] = users[user];
            _usermap[id].hash = user;
            $('#chatMembers').append('<li id="'+id+'">'+_usermap[id].username+'</li>');

        }
        $('#chatMembers li').on('click', function(){
            if($('#chatWindow'+id).length === 0) {
                $('.chatWindow').hide();
                createChatWindow(id);
            }
            else{
                $('.chatWindow').hide();
                $('#chatWindow'+id).show();
            }
        });
    }

    function receiveMessage(msg, user){
        var id = 0;
        for(id = 0; id < _usermap.length; id++){
            if(_usermap[id].hash === user.hash)
                break;
        }
        if($('#chatWindow'+id).length === 0) {
            $('.chatWindow').hide();
            createChatWindow(id);
        }
        else{
            $('.chatWindow').hide();
            $('#chatWindow'+id).show();
        }
        $('#chatTextArea'+id).append(user.username+": "+msg+"\n");

    }

    public.login = function(){
        _username = $('#username').val();
        var params = {};
        params.username = _username;
        params.publicKey = _publicKey;
        params.privateKey = _privateKey;
        oi.buildChain().then(function(){
            chat.init(params, function(chatObject){
                _chatObject = chatObject;
                _chatObject.onUserListUpdate = updateUserList;
                _chatObject.onReceiveMessage = receiveMessage;
                //_chatObject.onClientConnected
                $('#loginButton').hide();
                $('#username').hide();
                _chatObject.updateUserList();
            });
        });
    };


    init();

    /*
     testing code
     TODO allow user to specify own keypair + method for extraction
     */
    cu.getGeneratedRSAKeyPair().then(function(keys) {
        _publicKey = keys.publicKey;
        _privateKey = keys.privateKey;
    });

    return public;

})();

