var nodeOn = false;

function download(url){
    if(nodeOn) {
        chrome.runtime.getBackgroundPage(function (backgroundPage) {
            var promise = backgroundPage.stillepost.interfaces.aFileDown(url);
            chrome.browserAction.setIcon({path: 'download.png'});
            promise.then(function (result) {
                result.saveAs = true;
                chrome.browserAction.setIcon({path: 'on.png'});
                chrome.downloads.download(result);
            }, function (error) {
                chrome.browserAction.setIcon({path: 'on.png'});
            });
        });
    }
};

function off(){
    if(nodeOn){
        chrome.runtime.getBackgroundPage(function(backgroundPage){
            chrome.browserAction.setIcon({path: 'off.png'});
            backgroundPage.stillepost.interfaces.close();
            nodeOn = false;
        });
    }
};

function on(){
    if(!nodeOn){
        chrome.runtime.getBackgroundPage(function(backgroundPage){
            chrome.browserAction.setIcon({path: 'on.png'});
            backgroundPage.stillepost.interfaces.initNode();
            nodeOn = true;
        });
    }
};

function setDirectory(url){
    if(!nodeOn){
        chrome.runtime.getBackgroundPage(function(backgroundPage){
           backgroundPage.stillepost.interfaces.config.directoryServerUrl = url;
        });
    }
}