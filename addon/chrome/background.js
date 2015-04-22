var isOn = false;

chrome.browserAction.onClicked.addListener(function() {
    if(isOn){
        isOn = false;
        chrome.browserAction.setIcon({path: 'off.png'});
    }
    else{
        isOn = true;
        chrome.browserAction.setIcon({path: 'on.png'});
    }
    chrome.runtime.getBackgroundPage(function(backgroundPage){
       if(isOn){
           backgroundPage.stillepost.interfaces.initNode();
       }
       else{
           backgroundPage.stillepost.interfaces.close();
       }
    });
});