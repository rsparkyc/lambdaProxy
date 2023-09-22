const axios = require('axios');

function censor(censor) {
  var i = 0;
  
  return function(key, value) {
    if(i !== 0 && typeof(censor) === 'object' && typeof(value) == 'object' && censor == value) 
      return '[Circular]'; 
    
    if(i >= 29) // seems to be a harded maximum of 30 serialized objects?
      return '[Unknown]';
    
    ++i; // so we know we aren't using the original object anymore
    
    return value;  
  }
}

exports.handler = (event, context) => {
  
  if (event.requestContext.http.method.toLowerCase() === 'options') {
    console.log("handling options");
    return {
      statusCode: 200
    };
  }

  let eventData = event.body;

  if (typeof eventData === 'string') {
    eventData = JSON.parse(eventData);
  }


  console.log("EventData:" + JSON.stringify(eventData));

  console.log("Request Type: " + eventData.method.toLowerCase());

  
  let url = eventData.url;
  if (!url) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing URL parameter' })
    };
  }

  console.log("Have valid url");
  // get any headers from the request and add them to the axios request
  if (eventData.headers) {
    axios.defaults.headers.common = eventData.headers;
  }
  
  console.log("Added default axios headers");
  

  console.log("Checking for get");
  if (eventData.method.toLowerCase() === 'get') {
    console.log("Making get request to " + url);
    return axios.get(url)
      .then(response => {
        console.log('Response: ' + JSON.stringify(response, censor(response)));
        // remove any extra cors headers
        delete response.headers['access-control-allow-origin'];
        delete response.headers['access-control-allow-credentials'];
        delete response.headers['access-control-allow-headers'];
        return {
          statusCode: response.status,
          headers: response.headers,
          body: JSON.stringify(response.data)
        };
      })
      .catch(error => {
        console.error('Error:', error);
        return {
          statusCode: 500,
          body: JSON.stringify({ error: 'Internal Server Error' })
        };
      });
  }

  console.log("Checking for post");
  if (eventData.method.toLowerCase() === 'post') {
    console.log("Making post request to " + url);
    return axios.post(url, eventData.data)
      .then(response => {
        // remove any extra cors headers
        delete response.headers['access-control-allow-origin'];
        delete response.headers['access-control-allow-credentials'];
        delete response.headers['access-control-allow-headers'];
        return {
          statusCode: response.statusCode,
          headers: response.headers,
          body: JSON.stringify(response.data)
        };
      })
      .catch(error => {
        console.error('Error:', error);
        return {
          statusCode: 500,
          body: JSON.stringify({ error: 'Internal Server Error' })
        };
      });
  }
  
  console.log("No methods matched");

}

