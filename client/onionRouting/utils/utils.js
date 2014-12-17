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
  var newArray = new Uint8Array(16), i=0;
  for (var key in obj) {
    newArray[i++] = obj[key];
  }
  return newArray;
}