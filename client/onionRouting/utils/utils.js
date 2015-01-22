/**
 * Created by derli on 12/17/14.
 */

// check if the contents of two ArrayBuffer objects are equal
function abEqual(buf1, buf2)
{
  if (buf1.byteLength != buf2.byteLength) return false;
  var dv1 = new Int8Array(buf1);
  var dv2 = new Int8Array(buf2);
  for (var i = 0 ; i != buf1.byteLength ; i++)
  {
    if (dv1[i] != dv2[i]) return false;
  }
  return true;
}

// convert the given value of type Object to type ArrayBuffer
function objToAb(obj) {
  var newArray = new Uint32Array(4), i=0;
  for (var key in obj) {
    newArray[i++] = obj[key];
  }
  return newArray;
}

/**
 * Converts ArrayBuffer object to string object
 * @param buf the ArrayBuffer object
 * @returns {string} the stringified ArrayBuffer object
 */
function ab2str(buf) {
  return String.fromCharCode.apply(null, new Uint8Array(buf));
}

/**
 * Converts ArrayBuffer object to string object
 * @param buf the ArrayBuffer object
 * @returns {string} the stringified ArrayBuffer object
 */
function ab2str32(buf) {
  return JSON.stringify(buf);
  //return String.fromCharCode.apply(null, new Uint32Array(buf));
}

/**
 * Converts string object to ArrayBuffer object
 * @param str the string to be converted to type ArrayBuffer
 * @returns {ArrayBuffer} the ArrayBuffer object
 */
function str2ab32(str) {
  var buf = JSON.parse(str);
  return objToAb(buf);
  //var buf = new ArrayBuffer(str.length*4); // 2 bytes for each char
  //var bufView = new Uint32Array(buf);
  //for (var i=0, strLen=str.length; i < strLen; i++) {
  //  bufView[i] = str.charCodeAt(i);
  //}
  //return buf;
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