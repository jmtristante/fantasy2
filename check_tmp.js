require('@babel/core').transformFileSync('src/services/rentabilidad.js',{presets:['@babel/preset-react','@babel/preset-env'],filename:'rentabilidad.js'});console.log('OK parse');
