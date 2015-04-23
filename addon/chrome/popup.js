
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

window.onload = function(){
    document.getElementById("on").addEventListener("click",on);
    document.getElementById("off").addEventListener("click",off);
    document.getElementById("filedownload").addEventListener("click",fileDownload);
    document.getElementById("setdirectory").addEventListener("click",setDirectory);

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
    document.getElementById("directory").style.display = "block";
    document.getElementById("download").style.display = "none";
    document.getElementById("on").style.display = "block";
    document.getElementById("off").style.display = "none";
}

function showOn(){
    document.getElementById("directory").style.display = "none";
    document.getElementById("download").style.display = "block";
    document.getElementById("on").style.display = "none";
    document.getElementById("off").style.display = "block";
}