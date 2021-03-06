
function fileDownload(){
    chrome.runtime.getBackgroundPage(function(backgroundPage){
       var fileurl = document.getElementById("fileurl").value;
       backgroundPage.download(fileurl);
    });
};

function setDirectory(){
    chrome.runtime.getBackgroundPage(function(backgroundPage){
        var directoryurl = document.getElementById("directoryurl").value;
        backgroundPage.setDirectory(directoryurl);
    });
};

function off(){
    chrome.runtime.getBackgroundPage(function(backgroundPage){
        backgroundPage.off();
        showOff();
    });
};

function on(){
    chrome.runtime.getBackgroundPage(function(backgroundPage){
        backgroundPage.on();
        showOn();
    });
};

function chat(){
    chrome.tabs.create({'url': chrome.extension.getURL('app/index.html')}, function(tab) {
    });
}

window.onload = function(){
    document.getElementById("on").addEventListener("click",on);
    document.getElementById("off").addEventListener("click",off);
    document.getElementById("filedownload").addEventListener("click",fileDownload);
    document.getElementById("setdirectory").addEventListener("click",setDirectory);
    document.getElementById("chat").addEventListener("click", chat);

    chrome.runtime.getBackgroundPage(function(backgroundPage){
        if(backgroundPage.nodeOn){
            showOn();
        }
        else{
            showOff();
        }
        document.getElementById("directoryurl").value = backgroundPage.stillepost.interfaces.config.directoryServerUrl;
    });
};

function showOff(){
    $(".directory").css('display', 'block');
    $(".download").css('display', 'none');
    document.getElementById("on").style.display = "block";
    document.getElementById("off").style.display = "none";
}

function showOn(){
    $(".directory").css('display', 'none');
    $(".download").css('display', 'block');
    document.getElementById("on").style.display = "none";
    document.getElementById("off").style.display = "block";
}