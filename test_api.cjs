const http = require('http');

const options = {
  hostname: 'localhost',
  port: 8000,
  path: '/api/sessions',
  method: 'GET',
  headers: {
    // In a real scenario we'd need a token, but let's see if we can get a 401 or what
  }
};

const req = http.request(options, res => {
  let data = '';
  res.on('data', chunk => { data += chunk; });
  res.on('end', () => {
    console.log(res.statusCode, data);
  });
});
req.end();
