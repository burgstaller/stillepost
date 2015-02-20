//params: data,key,iv
self.onmessage = function(e) {
  var alg = {name: "AES-GCM", iv: e.data.iv};
  if (e.data.additionalData)
    alg.additionalData = convertToAb(e.data.additionalData);
  var buffer = str2ab(e.data.data);
  crypto.subtle.decrypt(alg, e.data.key, buffer).then(function(decData) {
    postMessage({success:true,data: ab2str(decData)});
    close();
  }).catch(function(error){
    postMessage({success:false,data:error.message});
    close();
  });
};

/**
 * Converts ArrayBuffer object to string object
 * @param buf the ArrayBuffer object
 * @returns {string} the stringified ArrayBuffer object
 */
function ab2str(buf) {
  return String.fromCharCode.apply(null, new Uint8Array(buf));
}

/**
 * Converts string object to ArrayBuffer object
 * @param str the string to be converted to type ArrayBuffer
 * @returns {ArrayBuffer} the ArrayBuffer object
 */
function str2ab(str) {
  var buf = new ArrayBuffer(str.length); // 2 bytes for each char
  var bufView = new Uint8Array(buf);
  for (var i=0, strLen=str.length; i < strLen; i++) {
    bufView[i] = str.charCodeAt(i);
  }
  return buf;
}

function convertToAb(data) {
  if (typeof data === 'string')
    return new Uint8Array(str2ab(data));
  else if (typeof data === 'object')
    return new Uint8Array(str2ab(JSON.stringify(data)));
  else
    return data;
}
