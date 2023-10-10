const superagent = require('superagent');

function censor(censor) {
  var i = 0;
  
  return function(key, value) {
    if(i !== 0 && typeof(censor) === 'object' && typeof(value) == 'object' && censor == value) 
      return '[Circular]'; 
    
    if(i >= 49) // seems to be a harded maximum of 30 serialized objects?
      return '[Unknown]';
    
    ++i; // so we know we aren't using the original object anymore
    
    return value;  
  }
}

exports.handler = async (event, context) => {
  
  if (event.requestContext.http.method.toLowerCase() === 'options') {
    return {
      statusCode: 200
    };
  }

  let eventData = event.body;

  if (typeof eventData === 'string') {
    eventData = JSON.parse(eventData);
  }
  
  let url = eventData.url;
  if (!url) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing URL parameter' })
    };
  }

  const rd = buildRequestData(eventData);
  
  if (eventData.method.toLowerCase() === 'get') {
    const sg = superagent.get(url).redirects(0);
    if (rd.headers) {
      for (const key of Object.keys(rd.headers)) {
        sg.set(key, rd.headers[key]);
      }
    }
    
    return await sg
      .then(response => {
        return buildResponse(response);
      })
      .catch(error => {
        if (error.status === 302){
          return buildResponse(error.response);
        }
        console.error('Error:', JSON.stringify(error, null, 2));
        return {
          statusCode: 500,
          body: JSON.stringify({ error: 'Internal Server Error', errorObj: error })
        };
      });
  }

  if (eventData.method.toLowerCase() === 'post') {
    const sg = superagent.post(url).redirects(0);
    let sendDataAsForm = true;
    if (rd.headers) {
      for (const key of Object.keys(rd.headers)) {
        sg.set(key, rd.headers[key]);
        if (key.toLowerCase() === 'content-type' && rd.headers[key].toLowerCase().includes('json')) {
          sendDataAsForm = false;
        }
      }
    }
    if (rd.data) {
      if (sendDataAsForm) {
        sg.query(rd.data);
      }
      else {
        sg.send(rd.data);
      }
    }

    return await sg
      .then(response => {
        return buildResponse(response);
      })
      .catch(error => {
        if (error.status === 302){
          return buildResponse(error.response);
        }
        console.error('Error:', error);
        return {
          statusCode: 500,
          body: JSON.stringify({ error: 'Internal Server Error', errorObj: error })
        };
      });
  }
  
  console.error("No methods matched");
}

// This is for axios, but we can still use the data it makes for us
function buildRequestData(eventData) {
  let config = {};
  if (eventData.headers) {
    config.headers = {};
    for (const key of Object.keys(eventData.headers)) {
      if (key !== 'x-c-data') {
        config.headers[key] = eventData.headers[key];
      }
      else {
        // dealing with stupid cookies
        
        const XCData = JSON.parse(eventData.headers['x-c-data']);
        
        let cookieString = "";
        
        for (const cookie of XCData) {
          if (cookieString.length > 0) {
            cookieString += ";";
          }
          cookieString += cookie;
        }
        config.headers.Cookie = cookieString;
      }
    }
  }
  
  if (eventData.data) {
    config.data = eventData.data;
  }
  
  return config;
}

function buildResponse(response){
  // remove any extra cors headers
  delete response.header['access-control-allow-origin'];
  delete response.header['access-control-allow-credentials'];
  delete response.header['access-control-allow-headers'];
  if (response.header['content-encoding'] && response.header['content-encoding'] === 'gzip') {
    delete response.header['content-encoding'];
  }
  
  let responseObj = {
    statusCode: response.status,
    headers: response.header,
    body: response.text
  };
  if (responseObj.statusCode == 302) {
    responseObj.statusCode = 200; // Let's not make the browser follow the redirect, we'll just look for the location header
  }
  let cookieHeader = response.header['set-cookie'];
  if (cookieHeader !== undefined){
    responseObj.headers['x-c-data'] = cookieHeader;
  }
  
  return responseObj;
}

