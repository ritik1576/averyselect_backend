

function reverseString(str) {
  return str.split("").reverse().join("");
}

// Your Hidden Output
console.log(reverseString("12345"));

try {
  let __fn = null;
  if (typeof module !== 'undefined' && typeof module.exports === 'function') {
    __fn = module.exports;
  } else if (typeof reverseString === 'function') {
    __fn = reverseString;
  }
  
  if (__fn) {
    let args = [ "hello" ];
    const result = __fn(...args);
    if (result !== undefined) {
      process.stdout.write("\n---AGY_RESULT_DELIM---\n" + JSON.stringify(result));
    }
  } else {
    // If no function, assume they are just printing or we gracefully ignore
  }
} catch (e) {
  process.stdout.write(e.toString());
}
